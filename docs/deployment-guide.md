# BeeEVAL 服务器部署指南

## 架构总览

```
                    ┌───────────────────────────────────────────┐
   用户浏览器 ──80──▶│  Nginx (静态前端 + 反向代理)                │
                    │    /      → dist/ (React SPA)             │
                    │    /api/  → api:8004 (FastAPI)            │
                    │    /dr-bee → api:8004/dr-bee              │
                    └───────────┬───────────────────────────────┘
                                │
                    ┌───────────▼───────────────────────────────┐
                    │  API Server (FastAPI + Uvicorn ×2)         │
                    │    - 接收请求, 返回数据                      │
                    │    - 分发视频分析任务到 Celery               │
                    └───────────┬───────────────────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                  ▼
     ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
     │   Redis      │  │  PostgreSQL  │  │   Qdrant     │
     │  (消息队列   │  │  (主数据库)   │  │  (向量库)     │
     │   + 缓存)    │  │              │  │              │
     └──────┬───────┘  └──────────────┘  └──────────────┘
            │
     ┌──────▼───────┐
     │ Celery Worker │
     │  (视频分析    │
     │   ASR + LLM)  │
     └──────────────┘
```

**共 6 个 Docker 容器**，全部通过 `docker-compose` 一键管理。

---

## 服务器要求

| 项目 | 最低 | 推荐 |
|------|------|------|
| CPU | 4 核 | 8 核+ |
| 内存 | 8 GB | 16 GB+ |
| 磁盘 | 40 GB | 100 GB+ (视频临时文件) |
| 系统 | Ubuntu 20.04+ / CentOS 8+ | Ubuntu 22.04 |
| Docker | 20.10+ | 最新版 |
| Docker Compose | v2+ | 最新版 |

---

## 方式一：一键脚本部署（推荐）

### 前置条件

1. 本地已安装 Node.js (npm)、Git、ssh、scp
2. 服务器已安装 Docker 和 Docker Compose
3. 本地可 SSH 到服务器

### 步骤

```bash
# 1. 在项目根目录执行
bash deploy.sh <服务器IP> [SSH用户] [SSH端口]

# 示例
bash deploy.sh 114.215.186.130 root 22
```

脚本会自动完成：构建前端 → 打包 → 上传 → 远程构建镜像 → 启动服务。

> ⚠️ 首次运行前，请编辑 `.env.production` 修改数据库密码！

---

## 方式二：手动部署（逐步）

### Step 1：服务器安装 Docker

```bash
# Ubuntu
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable docker && sudo systemctl start docker

# 将当前用户加入 docker 组（免 sudo）
sudo usermod -aG docker $USER
# 重新登录生效
```

### Step 2：本地构建前端

```bash
# 在项目根目录
npm install
npm run build
# 产出: dist/ 目录
```

### Step 3：准备生产环境配置

在项目根目录创建 `.env.production`：

```env
# ===== PostgreSQL =====
DB_HOST=postgres
DB_PORT=5432
DB_NAME=beeeval
DB_USER=postgres
DB_PASSWORD=你的强密码       # ← 务必修改！

# ===== LLM =====
LLM_API_KEY=sk-9hCFZx9h9H3o1yKAmSf06OARasPMcXbaPiSu7nEWAPaTUitZ
LLM_BASE_URL=https://ai.juguang.chat/v1/chat/completions
LLM_MODEL=[1刀/次]gemini-3-pro-preview-think

# ===== NAS =====
NAS_URL=http://114.215.186.130:8900
NAS_TOKEN=K2z4sxdJXvVD3oEnkf9uHGEIOHAX59wT-1v8pABUMS8
NAS_VIDEO_ROOT=/volume1/beeeval/BeeEval测试视频

# ===== Redis / Celery =====
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/0
USE_CELERY=true

# ===== Qdrant =====
QDRANT_URL=http://qdrant:6333
QDRANT_COLLECTION=beeeval
EMBEDDING_MODEL_PATH=/app/model/bge-base-zh-v1.5
```

> **关键区别**：`DB_HOST=postgres`、`REDIS_URL=redis://redis:6379/0`、`QDRANT_URL=http://qdrant:6333`
> 这里用的是 Docker 容器名，不是 `localhost`！

### Step 4：上传文件到服务器

```bash
# 方法 A：rsync（推荐，增量传输）
rsync -avz --progress \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='__pycache__' \
    --exclude='api/venv' \
    --exclude='api/llm_logs' \
    --exclude='temp_files' \
    --exclude='agent-transcripts' \
    --exclude='encrypt' \
    ./ root@你的服务器IP:/opt/beeeval/

# 方法 B：scp 压缩包
tar -czf beeeval.tar.gz \
    api/ public/ model/bge-base-zh-v1.5/ dist/ \
    Dockerfile docker-compose.production.yml nginx.conf .env.production .dockerignore

scp beeeval.tar.gz root@你的服务器IP:/opt/beeeval/
ssh root@你的服务器IP "cd /opt/beeeval && tar -xzf beeeval.tar.gz"
```

### Step 5：服务器上启动

```bash
ssh root@你的服务器IP
cd /opt/beeeval

# 复制生产配置
cp .env.production .env
cp docker-compose.production.yml docker-compose.yml

# 构建镜像（首次约 5-10 分钟）
docker compose build

# 启动所有服务
docker compose up -d

# 查看状态
docker compose ps
```

### Step 6：初始化数据库

首次部署需要建表。在服务器上执行：

```bash
# 进入 PostgreSQL 容器
docker exec -it beeeval-postgres psql -U postgres -d beeeval

# 在 psql 中执行建表 SQL（下面是完整的）
```

```sql
CREATE TABLE IF NOT EXISTS analysis_tasks (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS video_results (
    id SERIAL PRIMARY KEY,
    task_id TEXT REFERENCES analysis_tasks(id),
    video_name TEXT,
    transcript TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    case_id TEXT,
    brand_model TEXT,
    system_version TEXT,
    function_domain TEXT,
    scenario TEXT,
    sequence INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evaluation_scores (
    id SERIAL PRIMARY KEY,
    result_id INTEGER REFERENCES video_results(id),
    criteria TEXT,
    score NUMERIC,
    feedback TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    metric_code TEXT,
    category TEXT,
    selection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_results_task_id ON video_results(task_id);
CREATE INDEX IF NOT EXISTS idx_video_results_status ON video_results((metadata->>'status'));
CREATE INDEX IF NOT EXISTS idx_evaluation_scores_result_id ON evaluation_scores(result_id);
```

```bash
# 退出 psql
\q
```

---

## 验证部署

```bash
# 1. 查看所有容器运行状态
docker compose ps

# 预期输出: 6 个容器全部 Up
# beeeval-api       Up
# beeeval-worker    Up
# beeeval-redis     Up
# beeeval-postgres  Up (healthy)
# beeeval-qdrant    Up
# beeeval-nginx     Up

# 2. 检查 API 健康
curl http://localhost/api/video/status/test

# 3. 查看日志
docker compose logs -f api       # API 日志
docker compose logs -f worker    # Worker 日志
docker compose logs -f nginx     # Nginx 日志

# 4. 浏览器访问
# 前端:   http://服务器IP
# Dr.Bee: http://服务器IP/dr-bee
```

---

## 常用运维命令

```bash
cd /opt/beeeval

# ───── 启动 / 停止 / 重启 ─────
docker compose up -d              # 启动
docker compose down               # 停止（保留数据）
docker compose restart api        # 重启单个服务
docker compose restart worker     # 重启 Worker

# ───── 日志 ─────
docker compose logs -f --tail=100 api      # 跟踪 API 日志
docker compose logs -f --tail=100 worker   # 跟踪 Worker 日志

# ───── 更新部署 ─────
# 1. 本地修改代码后，重新上传文件
# 2. 在服务器上:
docker compose build              # 重新构建镜像
docker compose up -d              # 滚动更新

# ───── 仅更新前端（无需重建镜像）─────
# 本地 npm run build 后，上传 dist/ 到服务器
rsync -avz dist/ root@服务器:/opt/beeeval/dist/
docker compose restart nginx

# ───── 数据库备份 ─────
docker exec beeeval-postgres pg_dump -U postgres beeeval > backup_$(date +%Y%m%d).sql

# ───── 数据库恢复 ─────
cat backup_20260409.sql | docker exec -i beeeval-postgres psql -U postgres beeeval

# ───── 清理磁盘 ─────
docker system prune -f            # 清理无用镜像/容器
docker volume prune -f            # 清理无用 volume（谨慎！）

# ───── 查看资源占用 ─────
docker stats                      # 实时 CPU/内存

# ───── Worker 并发调整 ─────
# 修改 docker-compose.yml 中 worker 的 CMD:
#   --concurrency=3  →  --concurrency=5
docker compose up -d worker       # 生效

# ───── 进入容器调试 ─────
docker exec -it beeeval-api bash
docker exec -it beeeval-postgres psql -U postgres -d beeeval
docker exec -it beeeval-redis redis-cli
```

---

## 故障排查

### 容器启动失败

```bash
# 查看具体错误
docker compose logs api
docker compose logs worker

# 常见原因:
# - .env 配置错误（DB_HOST 写了 localhost）
# - 端口被占用（80、5432、6333）
# - 磁盘空间不足
```

### API 返回 502 Bad Gateway

```bash
# Nginx 能启动但 API 还没就绪
docker compose logs api
# 等 API 完全启动后再访问（通常 10-30 秒）
```

### Worker 不处理任务

```bash
# 检查 Worker 是否注册了任务
docker compose logs worker | grep "tasks"
# 应看到: [tasks] . api.tasks.video_tasks.analyze_video

# 检查 Redis 连接
docker exec -it beeeval-redis redis-cli ping
# 应返回: PONG
```

### 数据库连接失败

```bash
# 检查 PostgreSQL 是否健康
docker compose ps postgres
# 应显示: (healthy)

# 手动测试连接
docker exec -it beeeval-postgres psql -U postgres -d beeeval -c "SELECT 1;"
```

---

## PostgreSQL 大版本升级（与本机对齐，例如 16 → 17）

**原则**：PostgreSQL **不能把旧主版本的数据目录**直接挂给新主版本的 `postgres` 进程启动（`PG_VERSION` 不匹配会拒绝启动）。Docker 里换 `image: postgres:17-alpine` 时，要么 **新卷空库**，要么走官方 **`pg_upgrade`**（运维成本高，一般不必）。

**推荐流程（已有数据要保留）**：

1. **先备份**（在旧版本还在跑时，从本机或服务器做一次逻辑备份）  
   - 本机：`pg_dump` / `migrate-data.ps1`  
   - 或服务器：`docker compose exec postgres pg_dump -U postgres -Fc beeeval > beeeval.dump`

2. **停栈**  
   ```bash
   cd /data/beeeval
   docker compose down
   ```

3. **删掉旧 PG 数据卷**（**会清空该卷内所有库数据**，确认备份已就绪）  
   ```bash
   docker volume rm beeeval_pgdata
   ```
   若卷名不同：`docker volume ls | grep pgdata`。

4. **更新仓库里的 `docker-compose.production.yml`**（或服务器上的 compose）把 `postgres` 镜像改为与本机一致的主版本，例如 `postgres:17-alpine`，重新 `docker compose up -d`。

5. **把备份还原进新库**  
   ```bash
   docker compose cp beeeval.dump postgres:/tmp/beeeval.dump
   docker compose exec -T postgres pg_restore -U postgres -d beeeval --clean --if-exists /tmp/beeeval.dump
   ```
   逻辑备份来自 **同主版本或更低** 的 `pg_dump` 时，`pg_restore` 最省心；本机已是 17、服务器也升到 17 后，可直接用 **`-Fc` 自定义格式** 迁移，不必再绕 Plain SQL。

**若当前服务器上还是空库 / 可丢弃**：直接 `docker compose down` → `docker volume rm beeeval_pgdata` → 改镜像为 17 → `up -d`，再用 `migrate-data.ps1` 从本机灌数据即可。

项目默认镜像已与「本机 PG17 + `-Fc` 迁移」对齐，见根目录 [docker-compose.production.yml](../docker-compose.production.yml) 中 `postgres` 服务。

---

## 安全建议

1. **修改默认密码**：`.env` 中的 `DB_PASSWORD` 务必改为强密码
2. **防火墙**：只开放 80 端口（Nginx），Redis/PostgreSQL/Qdrant 不暴露外网
3. **HTTPS**：生产环境建议配置 SSL 证书（可用 Certbot + Let's Encrypt）
4. **LLM API Key**：确认 Key 不会泄露到前端

---

## HTTPS 配置（可选）

```bash
# 安装 Certbot
sudo apt install -y certbot

# 申请证书（需要域名指向服务器）
sudo certbot certonly --standalone -d your-domain.com

# 修改 nginx.conf 添加 SSL 配置
# 修改 docker-compose.yml 映射 443 端口
# 详细步骤见 Nginx SSL 配置文档
```

---

# 第二章：混合部署（数据集中模式）

## 场景

- **服务器**跑 PostgreSQL / Redis / Qdrant **+ 一套 API/Worker**，对外只暴露 Nginx 80
- **本机**再起一套 Celery Worker（可选再起 uvicorn 做调试），通过 **SSH Tunnel** 连服务器的数据库/队列
- 两边 Worker **同时抢**服务器 Redis 上 `video_analysis` 队列的任务，算力叠加
- 前端用户永远访问 `http://服务器/`，不需要连本机

**Redis 在本项目里只存：Celery 队列 + 视频进度缓存（1h 过期）。零业务数据**，可以随时清空。所以两边共用一个 Redis 不会丢数据。

## 架构图

```
用户浏览器
    │
    ▼
┌────────────────────────────────────────────────────┐
│           服务器（对外仅 Nginx:80）                  │
│                                                    │
│   Nginx → API(容器) ─┬─→ PostgreSQL (127.0.0.1)    │
│          Worker(容器)├─→ Redis      (127.0.0.1)    │
│                      └─→ Qdrant     (127.0.0.1)    │
└────────────────────────────────────────────────────┘
     ▲          ▲           ▲
     │ SSH 隧道 │ SSH 隧道  │ SSH 隧道
     │ (5432)   │ (6379)    │ (6333)
┌────────────────────────────────────────────────────┐
│               本机（开发/扩算力）                    │
│   Celery Worker(本机) → localhost:5432/6379/6333    │
└────────────────────────────────────────────────────┘
```

---

## 部署清单（其它服务器复现）

### A. 服务器侧

1. **准备 `.env.production`**（从 `.env.production` 模板复制）：
   ```bash
   # 填这三个强随机密码
   DB_PASSWORD=$(openssl rand -base64 24)
   REDIS_PASSWORD=$(openssl rand -base64 24)
   QDRANT_API_KEY=$(openssl rand -base64 32)
   ```
   同时填 `LLM_API_KEY` / `NAS_TOKEN`。

2. **部署**（本机执行）：
   ```powershell
   .\deploy.ps1 -ServerIP <服务器IP> -User <ssh用户> -Port <ssh端口>
   ```

3. **验证端口只绑 127.0.0.1**（登服务器）：
   ```bash
   ss -tlnp | grep -E '5432|6379|6333'
   # 期望每行都是 127.0.0.1:xxxx，如果看到 0.0.0.0:xxxx 就是泄露了
   ```

4. **验证容器**：
   ```bash
   cd /data/beeeval
   docker compose ps           # 6 个容器都 Up
   docker compose logs api     # API 启动无错
   docker compose logs worker  # Worker 注册了 analyze_video 任务
   curl http://localhost/api/health
   ```

### B. 数据迁移（从本机现有数据 -> 服务器空库）

**如果你是第一次部署，且本机有历史数据想保留**：

```powershell
.\scripts\migrate-data.ps1 `
    -ServerIP <服务器IP> -User <ssh用户> -SshPort <ssh端口>
```

**Windows 本机没有 `pg_dump` 时**：脚本会依次尝试——PATH →`C:\Program Files\PostgreSQL\*\bin\pg_dump.exe`→ 若只有一个名字里带 `postgres` 的运行中容器则自动 `docker exec` 导出；仍失败可显式指定：

```powershell
.\scripts\migrate-data.ps1 ... -PgDumpExe "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"
# 或数据库跑在本机 Docker 里：
.\scripts\migrate-data.ps1 ... -PgDumpDockerContainer "你的postgres容器名"
```

**若服务器 `pg_restore` 报 `unsupported version (1.xx) in file header`**：说明本机 PostgreSQL **主版本高于** 服务器镜像里的版本（例如本机 17、服务器 `postgres:16`）。请用 **纯 SQL 导出** 再导入：

```powershell
.\scripts\migrate-data.ps1 ... -PgDumpDockerContainer "my-postgres" -PgDumpFormat Plain
```

迁移脚本在 Plain 模式下会自动去掉 **`SET transaction_timeout`** 等 PG17 才有、PG16 不认识的会话参数行，避免 `psql` 在文件前几行报错。若还遇到其它 `unrecognized configuration parameter`，把报错里的参数名发出来再扩展清洗规则，或把服务器 Postgres 升到与本机同主版本。

**大文件 `scp` 中途断开**（`Connection closed`）：多为链路不稳定、NAT 超时或 `sshd` 限制长会话。脚本已对 `scp`/`ssh` 加了 keepalive、**`-C` 压缩**与**多次重试**（可用 `-ScpRetryCount` 调整）。若仍失败：只迁 Qdrant 时加 `-SkipPg`；用 `rsync -avP -e "ssh -p 端口 -o ServerAliveInterval=30 ..."` 把本机 `beeeval.snapshot` 传到服务器数据目录后，再运行 **`.\scripts\migrate-data.ps1 ... -SkipPg -SkipLocalQdrantSnapshot -SkipSnapshotScp -ServerQdrantApiKey "..."`**（避免重新打快照覆盖本机文件、跳过 `scp`，只跑服务器 `curl` 恢复）。**不要**只用 `-SkipSnapshotScp` 而不加 `-SkipLocalQdrantSnapshot`，否则脚本会重新下载快照，本机与服务器文件可能不一致。

**Qdrant `snapshots/recover` 返回 HTTP 500**：日志里若出现 `Wal error: ... first-index file: expected value at line 1`，多为 **Docker 快照 + `file://` recover** 的已知问题（见 [qdrant#7956](https://github.com/qdrant/qdrant/issues/7956)）。迁移脚本已改为 **`POST .../snapshots/upload`（multipart）** 从 `api` 容器上传恢复，避免该路径。

**大快照上传**：Qdrant 默认 **`max_request_size_mb: 32`**，超过约 32MB 的 multipart 会直接失败。生产 compose 已设置 `QDRANT__SERVICE__MAX_REQUEST_SIZE_MB=1024` 与 `QDRANT__SERVICE__HTTP_CLIENT_REQUEST_TIMEOUT_SEC=7200`，部署后需 **`docker compose up -d qdrant`** 使配置生效。

**排查**：`docker compose logs qdrant --tail 80`；`bash` 里多命令请用换行或分号，勿写成 `cd /data/beeevaldocker compose ...`。

脚本会：
1. `pg_dump` 本机 `beeeval` 数据库 → `scp` 到服务器 → 进容器 `pg_restore`
2. 调用本机 Qdrant API 创建 `beeeval` collection 的 snapshot → `scp` 到服务器 → 调服务器 Qdrant `PUT .../collections/beeeval/snapshots/recover`
3. 重启服务器 API/Worker，触发 `ON DELETE CASCADE` 迁移（`[api/services/local_db_client.py](../api/services/local_db_client.py)` 里的启动检查）

只想迁一个库：加 `-SkipPg` 或 `-SkipQdrant`。

**如果你不需要迁移**（新环境/不要旧数据）：跳过这步，新部署的 PG 自动初始化空表，Qdrant 自动建空 collection。

### C. 本机 SSH Tunnel（持久开着）

1. **关掉本机本地的 PG/Redis/Qdrant 容器**（否则 5432/6379/6333 端口冲突）：
   ```powershell
   docker ps                        # 先找出占用这三个端口的容器
   docker stop <container_name>     # 停掉它们；数据仍在 volume 里，不丢
   ```
   如果你**不想停**本机容器，编辑 `[start-tunnel.ps1](../start-tunnel.ps1)`，把 3 个 `-L` 的本机端口改成 15432/16379/16333，同时本机 `.env` 的 `DB_PORT` / `REDIS_URL` / `QDRANT_URL` 端口也跟着改。

2. **起隧道**（开一个 PowerShell 窗口，保持不关）：
   ```powershell
   .\start-tunnel.ps1 -ServerIP <服务器IP> -User <ssh用户> -Port <ssh端口>
   ```
   窗口里一直是 ssh 的阻塞进程，看不到任何输出 = 正常。看到 `ExitOnForwardFailure` 或 `bind failed` 就是端口冲突。

### D. 本机 `.env`

从模板复制一份并填 4 个密码（和服务器上**完全一致**）：
```powershell
cp .env.hybrid.example .env
# 然后用编辑器把 <SAME_AS_SERVER_...> 替换成真实值
```

### E. 启本机服务

```powershell
# Terminal 1：隧道（已在 C 步骤起好）
# Terminal 2（可选，调前端时才要）：
uvicorn api.main:app --reload --port 8000

# Terminal 3：Worker（是混合部署的真正意义所在）
cd api
..\api\venv\Scripts\Activate
celery -A api.celery_app worker --pool=threads --concurrency=3 -Q video_analysis --loglevel=info
```

### F. 验证分布式算力

1. 浏览器打开 `http://<服务器IP>/`
2. NAS Browser 选一批视频，点"开始分析"
3. **同时观察两个地方**：
   - 服务器：`docker compose logs -f worker` → 打印 `Received task ...` + 视频处理日志
   - 本机：Terminal 3 里的 Celery worker → 也打印 `Received task ...` 处理不同视频

两边同时处理 = 成功。只有一边处理 = 检查隧道是否挂了 / 本机 Celery 是否连对了 `CELERY_BROKER_URL`。

---

## 故障排查（混合模式）

### 本机 Worker 启动时报 "Error 10061 connection refused"（连 localhost:6379）

- 隧道没开 → `.\start-tunnel.ps1`
- 隧道窗口里 `Warning: remote port forwarding failed for listen port` → 服务器 sshd 禁了 forwarding，在 `/etc/ssh/sshd_config` 加 `AllowTcpForwarding yes`

### 本机 Worker 报 `WRONGPASS invalid username-password pair or user is disabled`

本机 `.env` 的 `REDIS_URL` 密码对不上服务器的 `REDIS_PASSWORD`。把服务器 `.env` 里的 `REDIS_PASSWORD` 复制过来。

### 本机 API / Worker 调 Qdrant 报 401

`QDRANT_API_KEY` 没填 / 填错。检查本机和服务器 `.env` 两边值**完全一致**。

### 两台 Worker 没并行，只一边在跑

- 确认 Celery 启动带了 `--pool=threads --concurrency=3`（默认 `solo` 是串行）
- 两台 Worker 都监听**同一队列**：`-Q video_analysis`
- 服务器 Redis 里有没有积压任务：
  ```bash
  docker exec -it beeeval-redis redis-cli -a '<REDIS_PASSWORD>' LLEN video_analysis
  ```

### 从本机 psql 能连上但插入报 "relation does not exist"

pg_restore 在服务器还没完整跑完 / API 还没触发 CASCADE 迁移。重启：
```bash
docker compose restart api worker
```

