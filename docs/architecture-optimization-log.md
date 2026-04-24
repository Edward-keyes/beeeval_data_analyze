# BeeEVAL 架构级性能优化 - 工作留痕

## 一、概述

本次优化目标：解决后端分析视频时前端页面无法加载的问题。根本原因是 API 请求处理和 CPU 密集型视频分析共享同一个进程的资源。方案分三阶段实施。

---

## 二、阶段二 P0：轻量级优化

### 2.1 `update_progress` 去 DB 化

**文件**: `api/routers/video.py` (行 61-71)

**改动前**: `update_progress()` 每次更新进度都会调用 `supabase.table("video_results").update(...)` 写入 DB，每个视频约产生 ~10 次 DB UPDATE。

**改动后**: 只写内存缓存 `_progress_cache` + Redis（如果可用），仅在视频分析**最终完成/失败时**才写 DB。

**效果**: 每个视频从 ~10 次 DB UPDATE 降为 1 次，DB 连接池压力降低 ~90%。

### 2.2 连接池调参

**文件**: `api/services/local_db_client.py` (行 38-40)

**改动**: `maxconn` 从 10 提到 20，为前端查询留出更多余量。

```python
# Before
ThreadedConnectionPool(minconn=2, maxconn=10, dsn=self._dsn)
# After
ThreadedConnectionPool(minconn=2, maxconn=20, dsn=self._dsn)
```

### 2.3 前端轮询降频 + 智能停止

**文件**: `src/pages/Results.tsx` (行 100-104)

**改动前**: 固定 3 秒轮询，任务完成后仍继续轮询。

**改动后**:
- 轮询间隔从 3s → 5s
- 任务状态为 `completed` 或非 `processing`/`pending` 时自动停止轮询
- 依赖 `data?.task?.status` 变化触发 effect 重新评估

### 2.4 `/results/{task_id}` 合并 Redis 进度缓存

**文件**: `api/routers/video.py`

新增逻辑：查询结果后，合并 Redis/内存缓存中的实时进度数据到 `metadata` 字段，确保前端看到最新进度。

---

## 三、阶段一 P1：Celery + Redis 进程分离

### 3.1 新增配置

**文件**: `.env`
```
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/0
```

**文件**: `api/core/config.py`
- 新增 `REDIS_URL` 和 `CELERY_BROKER_URL` 字段

### 3.2 新建 `api/celery_app.py`

Celery 应用实例定义：
- Broker 和 Result Backend 均使用 Redis
- 任务序列化: JSON
- 时区: Asia/Shanghai
- 默认队列: `video_analysis`
- 自动发现 `api.tasks` 模块中的任务

### 3.3 新建 `api/services/redis_service.py`

Redis 进度服务，核心功能：
- `set_progress(video_result_id, data)`: 写进度到 Redis Hash，TTL 1 小时
- `get_progress(video_result_id)`: 读单个视频进度
- `get_all_progress_for_task(video_result_ids)`: 批量读取（Pipeline 优化）
- `delete_progress(video_result_id)`: 清理已完成的进度
- **优雅降级**: Redis 不可用时自动回退到内存字典

### 3.4 新建 `api/tasks/__init__.py` + `api/tasks/video_tasks.py`

Celery 任务文件，将 `process_video` 逻辑封装为 Celery task:
- `@celery_app.task(bind=True, name="api.tasks.video_tasks.analyze_video")`
- 内部创建独立事件循环运行 async 代码
- 进度写入 Redis 而非内存缓存
- 完整的异常处理和 DB 状态更新

### 3.5 修改 `api/routers/video.py`

**智能调度函数** `dispatch_video_task()`:
- 启动时检测 Redis 是否可用
- Redis 可用 → 使用 `celery_analyze_video.delay(...)` 分发到 Celery Worker
- Redis 不可用 → 回退到原有 `ThreadPoolExecutor + run_async_in_thread`
- 三处 `executor.submit(...)` 调用全部替换为 `dispatch_video_task(...)`

**`/status/{task_id}` 端点**:
- 先从 Redis Pipeline 批量读取进度
- 再 fallback 到内存缓存
- 减少了冗余日志输出

**进度更新双写**:
- `update_progress()` 同时写内存缓存和 Redis
- 视频完成后同时清理内存缓存和 Redis

### 3.6 依赖更新

**文件**: `api/requirements.txt`
```
celery>=5.3.0
redis>=5.0.0
```

### 启动方式

```bash
# 终端 1：Redis
docker run -d --name redis -p 6379:6379 redis:7-alpine

# 终端 2：API（轻量，只处理 HTTP）
uvicorn api.main:app --port 8004

# 终端 3：Worker（重量级，跑视频分析）
celery -A api.celery_app worker --concurrency=2 --pool=prefork -Q video_analysis
```

如果不启动 Redis / Celery Worker，系统自动回退到原有模式，**完全向后兼容**。

---

## 四、阶段三 P2：Docker 化部署

### 4.1 新建 `Dockerfile`

多阶段构建：
- `base`: Python 3.12-slim + ffmpeg + 依赖安装
- `api`: uvicorn --workers 2
- `worker`: celery worker --concurrency=3

### 4.2 新建 `docker-compose.yml`

服务编排（6 个容器）：

| 服务 | 镜像 | 说明 |
|------|------|------|
| `api` | 自建 (target: api) | FastAPI API 服务，仅处理 HTTP |
| `worker` | 自建 (target: worker) | Celery Worker，跑视频分析 |
| `redis` | redis:7-alpine | 任务队列 + 进度缓存 |
| `postgres` | postgres:16-alpine | 数据库，max_connections=100 |
| `qdrant` | qdrant/qdrant | 向量检索 |
| `nginx` | nginx:alpine | 反向代理 + 前端静态资源 |

关键配置:
- PostgreSQL healthcheck 确保启动顺序
- 共享 volumes: temp_files, screenshots
- Worker 只读挂载 embedding 模型
- 环境变量覆盖 `.env` 中的 localhost 为容器服务名

### 4.3 新建 `nginx.conf`

- `/` → 前端 SPA (`try_files` 支持 client-side routing)
- `/api/` → 反向代理到 API 容器 (proxy_read_timeout 600s)
- `/dr-bee` → Dr. Bee 独立页面
- `/screenshots/` → 截图静态文件
- `client_max_body_size 500M`

### 4.4 新建 `.dockerignore`

排除 node_modules、.git、model、encrypt 等大文件目录。

### 部署步骤

```bash
# 1. 构建前端
npm run build

# 2. 启动所有服务
docker-compose up -d --build

# 3. 查看日志
docker-compose logs -f api worker
```

访问地址:
- 前端: http://server-ip
- Dr. Bee: http://server-ip/dr-bee
- API: http://server-ip/api/...

---

## 五、文件变更汇总

| 文件 | 操作 | 说明 |
|------|------|------|
| `api/routers/video.py` | 修改 | 去 DB 进度写入、Redis 集成、Celery 调度 |
| `api/services/local_db_client.py` | 修改 | 连接池 maxconn 10→20 |
| `api/core/config.py` | 修改 | 新增 REDIS_URL、CELERY_BROKER_URL |
| `.env` | 修改 | 新增 Redis/Celery 配置 |
| `api/requirements.txt` | 修改 | 新增 celery、redis |
| `src/pages/Results.tsx` | 修改 | 轮询 3s→5s，智能停止 |
| `api/celery_app.py` | 新建 | Celery 应用实例 |
| `api/services/redis_service.py` | 新建 | Redis 进度缓存服务 |
| `api/tasks/__init__.py` | 新建 | 任务包初始化 |
| `api/tasks/video_tasks.py` | 新建 | Celery 视频分析任务 |
| `Dockerfile` | 新建 | 多阶段 Docker 构建 |
| `docker-compose.yml` | 新建 | 6 容器编排 |
| `nginx.conf` | 新建 | Nginx 反向代理配置 |
| `.dockerignore` | 新建 | Docker 构建排除规则 |
| `docs/architecture-optimization-log.md` | 新建 | 本文档 |

---

## 六、补充：僵尸任务恢复功能

### 问题场景

1. **卡在 "Downloading from NAS"**：NAS 下载超时或进程异常终止后，视频永远停在 `processing` 状态
2. **关机导致的孤儿视频**：服务器关机/重启后，ThreadPoolExecutor 中的线程死亡，排队中（`pending`）的视频永远不会被处理

### 6.1 后端新增 `POST /api/video/recover-stuck/{task_id}`

**文件**: `api/routers/video.py`

- 查询该任务下所有 `status = 'pending'` 或 `status = 'processing'` 的视频
- 将它们全部重置为 `pending` + `"Queued (Recovered)"`
- 清除旧的 evaluation_scores
- 重新通过 `dispatch_video_task()` 提交分析
- 将任务状态重置为 `processing`

`GET /api/video/results/{task_id}` 也新增返回 `stuck_count`（pending + processing 数量）。

### 6.2 前端恢复按钮

**文件**: `src/pages/Results.tsx`

- 新增 `stuckCount` 状态和 `handleRecoverStuck` 处理函数
- 当 `stuckCount > 0` 时显示琥珀色"恢复僵尸视频"按钮
- 点击后弹出确认框，确认后调用 `recoverStuckVideos(taskId)` API

**文件**: `src/api.ts` — 新增 `recoverStuckVideos()` 函数
**文件**: `src/config.ts` — 新增 `RECOVER_STUCK` 端点

### 6.3 前端路径修复

**文件**: `src/api.ts` (行 33)

`'/api/video/asr-models'` → `'/video/asr-models'`，修复 axios baseURL 拼接导致的 `/api/api/` 双重路径 404 问题。
