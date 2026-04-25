#!/usr/bin/env bash
# ----------------------------------------------------------------------
# scripts/import-pg-from-dump.sh
#
# 把一份 pg_dump 的备份文件导入到当前 docker compose 跑的
# beeeval-postgres 容器里。
#
# 适用场景：
#   - 旧目录 /data/beeeval 里跑过一套 PG，想把数据搬到新目录
#     /data/beeeval_data_analyze 下新启动的 PG 容器里。
#   - 或者从本机 pg_dump 出来一份 .dump / .sql，复制到服务器 restore。
#
# 用法：
#   ./scripts/import-pg-from-dump.sh /path/to/beeeval.dump
#       支持两种格式：
#         *.dump  -> pg_restore 的 custom format（pg_dump -Fc 出的）
#         *.sql   -> 纯 SQL，用 psql 灌
#
# 前提：
#   - 已经 cd 到 docker-compose.production.yml 所在目录
#   - 容器名固定为 beeeval-postgres / beeeval-api / beeeval-worker
#   - 数据库名 beeeval、用户 postgres
# ----------------------------------------------------------------------
set -euo pipefail

DUMP_FILE="${1:-}"
PG_CONTAINER="${PG_CONTAINER:-beeeval-postgres}"
API_CONTAINER="${API_CONTAINER:-beeeval-api}"
WORKER_CONTAINER="${WORKER_CONTAINER:-beeeval-worker}"
DB_NAME="${DB_NAME:-beeeval}"
DB_USER="${DB_USER:-postgres}"

if [[ -z "${DUMP_FILE}" || ! -f "${DUMP_FILE}" ]]; then
    echo "Usage: $0 <dump-file>"
    echo "  e.g.  $0 ./beeeval.dump"
    exit 1
fi

echo "==> 1/5 检查 PG 容器存活"
if ! docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
    echo "ERROR: 容器 ${PG_CONTAINER} 没在跑，先启动 docker compose。"
    exit 2
fi

echo "==> 2/5 停 api / worker，避免 restore 过程中 schema 抢占"
docker stop "${API_CONTAINER}" "${WORKER_CONTAINER}" 2>/dev/null || true

echo "==> 3/5 复制 dump 文件到容器"
docker cp "${DUMP_FILE}" "${PG_CONTAINER}:/tmp/beeeval.import"

echo "==> 4/5 执行 restore"
case "${DUMP_FILE}" in
    *.sql)
        echo "    （SQL 模式，使用 psql 灌入）"
        docker exec -i "${PG_CONTAINER}" \
            psql -U "${DB_USER}" -d "${DB_NAME}" \
                -v ON_ERROR_STOP=1 \
                -f /tmp/beeeval.import
        ;;
    *)
        echo "    （custom 模式，使用 pg_restore，先 DROP 同名对象再灌入）"
        docker exec "${PG_CONTAINER}" \
            pg_restore \
                -U "${DB_USER}" -d "${DB_NAME}" \
                --clean --if-exists \
                --no-owner --no-acl \
                /tmp/beeeval.import || {
                    echo "WARN: pg_restore 返回非 0，通常是 DROP 不存在对象时的告警，继续。"
                }
        ;;
esac

echo "==> 5/5 校正 SERIAL 序列，避免后续 INSERT 撞 id"
docker exec -i "${PG_CONTAINER}" \
    psql -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
    seq_name TEXT;
    max_id   BIGINT;
BEGIN
    -- 目前只有 evaluation_scores 是 SERIAL，但用通用写法兜住未来新增的。
    FOR seq_name IN
        SELECT pg_get_serial_sequence('evaluation_scores', 'id')
        WHERE pg_get_serial_sequence('evaluation_scores', 'id') IS NOT NULL
    LOOP
        EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM %I',
                       split_part(seq_name, '.', 2)) INTO max_id;
        IF max_id > 0 THEN
            PERFORM setval(seq_name, max_id, true);
            RAISE NOTICE 'setval(%, %, true)', seq_name, max_id;
        ELSE
            PERFORM setval(seq_name, 1, false);
            RAISE NOTICE 'setval(%, 1, false)  -- empty table', seq_name;
        END IF;
    END LOOP;
END $$;
SQL

echo "==> 重启 api / worker"
docker start "${API_CONTAINER}" "${WORKER_CONTAINER}" >/dev/null

echo
echo "完成。建议立刻看一眼："
echo "  docker logs -f --tail 50 ${API_CONTAINER}"
echo "  docker exec -it ${PG_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} \\"
echo "    -c 'SELECT (SELECT count(*) FROM analysis_tasks) tasks,"
echo "                (SELECT count(*) FROM video_results) results,"
echo "                (SELECT count(*) FROM evaluation_scores) scores;'"
