#!/usr/bin/env bash
# ----------------------------------------------------------------------
# scripts/find-old-pg-data.sh
#
# 一键诊断：扫描宿主机上还有没有可用的旧 PostgreSQL 数据，
# 并打印出对应的 dump / restore 命令。
#
# 不会写任何东西，只读。安全可重复运行。
#
# 用法：
#   ./scripts/find-old-pg-data.sh
# ----------------------------------------------------------------------
set -u

NEW_PG="${NEW_PG:-beeeval-postgres}"
DB_NAME="${DB_NAME:-beeeval}"
DB_USER="${DB_USER:-postgres}"
WORK_DIR="${WORK_DIR:-$(pwd)}"

ok()   { printf '\033[32m[OK]\033[0m   %s\n' "$*"; }
warn() { printf '\033[33m[WARN]\033[0m %s\n' "$*"; }
err()  { printf '\033[31m[ERR]\033[0m  %s\n' "$*"; }
info() { printf '\033[36m[..]\033[0m   %s\n' "$*"; }
step() { printf '\n\033[1m===== %s =====\033[0m\n' "$*"; }

step "0. 当前新 PG 状态"
if docker ps --format '{{.Names}}' | grep -q "^${NEW_PG}$"; then
    ok "${NEW_PG} 在跑"
    counts=$(docker exec "${NEW_PG}" psql -U "${DB_USER}" -d "${DB_NAME}" -tA -c \
        "SELECT
            (SELECT count(*) FROM analysis_tasks) || '|' ||
            (SELECT count(*) FROM video_results) || '|' ||
            (SELECT count(*) FROM evaluation_scores)" 2>/dev/null || echo "?|?|?")
    IFS='|' read -r ct cv ce <<< "${counts}"
    info "新库行数:  analysis_tasks=${ct}  video_results=${cv}  evaluation_scores=${ce}"
    if [[ "${ct}" == "0" && "${cv}" == "0" && "${ce}" == "0" ]]; then
        warn "新库三张表全空，确实需要从旧数据迁移。"
    else
        warn "新库已有数据，再次导入会被 --clean 清掉重灌，确认后再继续。"
    fi
else
    err "${NEW_PG} 没在跑，先 docker compose up -d 起来再说。"
fi

step "1. 扫所有 postgres 容器（包含已停止）"
mapfile -t pg_containers < <(docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' \
    | awk -F'\t' 'tolower($2) ~ /postgres/ || tolower($1) ~ /postgres|pgdata|beeeval/')

if [[ ${#pg_containers[@]} -eq 0 ]]; then
    info "没找到任何 postgres 容器（除了新的）"
else
    for line in "${pg_containers[@]}"; do
        name=$(awk -F'\t' '{print $1}' <<< "${line}")
        [[ "${name}" == "${NEW_PG}" ]] && continue
        echo "  - ${line}"
    done

    OLD_PG=""
    for line in "${pg_containers[@]}"; do
        name=$(awk -F'\t' '{print $1}' <<< "${line}")
        [[ "${name}" == "${NEW_PG}" ]] && continue
        OLD_PG="${name}"
        break
    done

    if [[ -n "${OLD_PG}" ]]; then
        ok "发现可能的旧 PG 容器: ${OLD_PG}"
        is_running=$(docker inspect -f '{{.State.Running}}' "${OLD_PG}" 2>/dev/null || echo false)
        echo
        echo "  ---- 推荐做法（情况 A）----"
        if [[ "${is_running}" != "true" ]]; then
            echo "  docker start ${OLD_PG}"
        fi
        echo "  docker exec ${OLD_PG} pg_dump -U ${DB_USER} -d ${DB_NAME} -Fc -f /tmp/old.dump"
        echo "  docker cp ${OLD_PG}:/tmp/old.dump ${WORK_DIR}/old.dump"
        echo "  ls -lh ${WORK_DIR}/old.dump"
        echo "  ${WORK_DIR}/scripts/import-pg-from-dump.sh ${WORK_DIR}/old.dump"
        echo
    fi
fi

step "2. 扫所有 docker 卷（找旧 pgdata）"
mapfile -t pg_volumes < <(docker volume ls --format '{{.Name}}' \
    | grep -Ei 'pgdata|postgres' \
    | grep -v "$(docker inspect -f '{{ range .Mounts }}{{ if eq .Type "volume" }}{{ .Name }}{{ end }}{{ end }}' "${NEW_PG}" 2>/dev/null | tr -d '\n')")

if [[ ${#pg_volumes[@]} -eq 0 ]]; then
    info "没找到其它 PG 数据卷。"
else
    for v in "${pg_volumes[@]}"; do
        size=$(docker run --rm -v "${v}":/d alpine du -sh /d 2>/dev/null | awk '{print $1}')
        echo "  - ${v}  (${size:-?})"
    done

    OLD_VOL="${pg_volumes[0]}"
    ok "发现可能的旧 PG 数据卷: ${OLD_VOL}"
    pgver=$(docker run --rm -v "${OLD_VOL}":/d alpine cat /d/PG_VERSION 2>/dev/null || echo "?")
    info "数据卷里的 PG 版本: ${pgver}"
    img="postgres:${pgver}-alpine"
    [[ "${pgver}" == "?" ]] && img="postgres:17-alpine"

    echo
    echo "  ---- 推荐做法（情况 B：临时挂卷起一次性 PG 来 dump）----"
    cat <<EOF
  docker run --rm \\
    -v ${OLD_VOL}:/var/lib/postgresql/data \\
    -v ${WORK_DIR}:/backup \\
    -e POSTGRES_PASSWORD=dummy \\
    --entrypoint bash \\
    ${img} -c '
      chown -R postgres:postgres /var/lib/postgresql/data &&
      su postgres -c "pg_ctl -D /var/lib/postgresql/data -o \"-p 5433\" -l /tmp/pg.log start" &&
      sleep 2 &&
      su postgres -c "pg_dump -h /var/run/postgresql -p 5433 -d ${DB_NAME} -Fc -f /backup/old.dump" &&
      su postgres -c "pg_ctl -D /var/lib/postgresql/data stop"
    '
  ls -lh ${WORK_DIR}/old.dump
  ${WORK_DIR}/scripts/import-pg-from-dump.sh ${WORK_DIR}/old.dump
EOF
fi

step "3. 扫宿主机上现成的 dump 文件"
mapfile -t dump_files < <(
    {
        find /data/beeeval         -maxdepth 3 -type f \( -iname '*.sql' -o -iname '*.dump' -o -iname '*.sql.gz' -o -iname '*.dump.gz' \) 2>/dev/null
        find /data/beeeval_data_analyze -maxdepth 2 -type f \( -iname '*.sql' -o -iname '*.dump' -o -iname '*.sql.gz' -o -iname '*.dump.gz' \) 2>/dev/null
        find ~                     -maxdepth 3 -type f \( -iname 'beeeval*.sql' -o -iname 'beeeval*.dump' \) 2>/dev/null
    } | sort -u
)

if [[ ${#dump_files[@]} -eq 0 ]]; then
    info "没找到现成的 .sql / .dump 备份文件。"
else
    ok "发现现成的备份文件:"
    for f in "${dump_files[@]}"; do
        ls -lh "${f}" 2>/dev/null | awk '{printf "  - %-12s %s\n", $5, $9}'
    done
    pick="${dump_files[0]}"
    echo
    echo "  ---- 推荐做法（情况 C：直接用现成备份）----"
    case "${pick}" in
        *.gz)
            echo "  gunzip -c ${pick} > ${WORK_DIR}/old.${pick##*.gz}"
            ;;
        *)
            echo "  cp ${pick} ${WORK_DIR}/old.${pick##*.}"
            ;;
    esac
    echo "  ${WORK_DIR}/scripts/import-pg-from-dump.sh ${WORK_DIR}/old.*"
fi

step "4. 扫宿主机文件系统上的 PG data 目录（bind mount）"
candidates=(
    /data/beeeval/postgres_data
    /data/beeeval/pgdata
    /data/beeeval/postgresql
    /data/beeeval/data/postgres
    /var/lib/postgresql
)
found_dir=""
for d in "${candidates[@]}"; do
    if [[ -f "${d}/PG_VERSION" ]]; then
        ver=$(cat "${d}/PG_VERSION" 2>/dev/null)
        size=$(du -sh "${d}" 2>/dev/null | awk '{print $1}')
        ok "发现宿主机 PG 数据目录: ${d}  (PG_VERSION=${ver}, ${size})"
        found_dir="${d}"
        break
    fi
done

if [[ -n "${found_dir}" ]]; then
    img="postgres:${ver}-alpine"
    echo
    echo "  ---- 推荐做法（情况 B'：bind mount 版）----"
    cat <<EOF
  docker run --rm \\
    -v ${found_dir}:/var/lib/postgresql/data \\
    -v ${WORK_DIR}:/backup \\
    -e POSTGRES_PASSWORD=dummy \\
    --entrypoint bash \\
    ${img} -c '
      chown -R postgres:postgres /var/lib/postgresql/data &&
      su postgres -c "pg_ctl -D /var/lib/postgresql/data -o \"-p 5433\" -l /tmp/pg.log start" &&
      sleep 2 &&
      su postgres -c "pg_dump -h /var/run/postgresql -p 5433 -d ${DB_NAME} -Fc -f /backup/old.dump" &&
      su postgres -c "pg_ctl -D /var/lib/postgresql/data stop"
    '
  ls -lh ${WORK_DIR}/old.dump
  ${WORK_DIR}/scripts/import-pg-from-dump.sh ${WORK_DIR}/old.dump
EOF
fi

step "总结"
echo "请把上面【推荐做法】里的命令复制下来执行。如果 1/2/3/4 全没找到，"
echo "说明旧 PG 数据已经丢失，无法迁移；只能从新空库继续往前用。"
