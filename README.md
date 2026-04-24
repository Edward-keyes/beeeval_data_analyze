# BeeEVAL - AI 智能座舱视频分析工具

一个专门用于分析 AI 在汽车智能座舱中应用表现的视频分析工具。

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Python](https://img.shields.io/badge/python-3.9+-green)
![Node.js](https://img.shields.io/badge/node-18+-green)
![License](https://img.shields.io/badge/license-MIT-green)

## 功能特性

- 📁 批量上传视频文件
- 🎤 自动语音转文本（Moonshine ASR - 比 Whisper 快 10 倍）
- 🤖 AI 综合评估（准确性、响应速度、用户体验、UI/UX）
- 📊 生成评估报告
- 📜 历史记录管理
- 🖼️ 智能关键帧截图
- 🗄️ 本地 SQLite 数据库（支持 Supabase 云端同步）
- 视频分析流程：上传视频 → 提取音频 → 转录（Moonshine ASR）→ LLM 评估 → 保存结果（包括评估分数）

## Docker 快速部署（推荐，拉下来即可用）

适用于已有一台 Linux 服务器、希望整套服务（`api` / `worker` / `postgres` / `redis` / `qdrant` / `nginx`）一起跑的场景。**注意**：嵌入模型 `model/bge-base-zh-v1.5`（~400 MB）不在 git 仓库里，需要额外用脚本下载；`public/screenshots/` 里视频关键帧也不入库，属于运行产物。

```bash
# 1. 拉代码
git clone <your-repo-url> BeeEVAL
cd BeeEVAL

# 2. 下载嵌入模型（~400MB，不在 git 里，脚本会拉到 model/bge-base-zh-v1.5/）
# Windows (PowerShell)
.\scripts\download-model.ps1              # 国外网络
.\scripts\download-model.ps1 -UseMirror   # 国内走 hf-mirror.com
# Linux / macOS
./scripts/download-model.sh
HF_ENDPOINT=https://hf-mirror.com ./scripts/download-model.sh   # 国内镜像

# 3. 配环境变量（绝对不要把填好密钥的 .env.production 提交回 git！）
cp .env.production.example .env.production
# 用编辑器把里面所有 <REPLACE_ME_*> 改成真实值：
#   DB_PASSWORD / REDIS_PASSWORD / QDRANT_API_KEY / LLM_API_KEY / NAS_TOKEN ...

# 4. 部署（在本机，脚本会 npm build + tar + scp + 服务器 docker compose build/up）
# Windows (PowerShell)
.\deploy.ps1 -ServerIP x.x.x.x -User your_user -Port 22
# Linux / macOS
./deploy.sh x.x.x.x your_user 22
```

部署完成后：

- 前端：`http://<服务器IP>`
- API：`http://<服务器IP>/api`
- Dr.Bee：`http://<服务器IP>/dr-bee`

> 如果你是「本机 API + 服务器 Postgres/Redis/Qdrant」的混合部署，参考 `.env.hybrid.example` 和 `start-tunnel.ps1`；完整说明见 [docs/deployment-guide.md](docs/deployment-guide.md)。

## 本地开发快速开始

### 前置要求

- Python 3.9+
- Node.js 18+
- FFmpeg

### 1. 安装 FFmpeg

**Windows:**
```bash
# 下载 ffmpeg.exe 并添加到系统 PATH
# 或放置到项目 bin/ 目录
```

**macOS:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt-get install ffmpeg
```

### 2. 安装前端依赖

```bash
cd D:\data\project_IntelliJ\BeeEVAL
npm install
npm run dev
```

### 3. 安装后端依赖

```bash
# 进入 api 目录
cd api

# 创建虚拟环境
python -m venv venv

# 激活虚拟环境
# Windows PowerShell:
.\venv\Scripts\Activate.ps1
# Windows cmd:
# venv\Scripts\activate.bat

# 安装依赖
pip install -r requirements.txt
```

**核心依赖:**
```
loguru
moviepy>=2.0
pydantic-settings
python-multipart
diskcache
google-generativeai
ffmpeg-python
```

### 4. 下载 Moonshine 模型

```bash
# 下载中文语音识别模型
python download_moonshine_model.py --language zh --size small
```

### 5. 配置环境变量

复制 `.env.example` 到 `.env`：

```env
# Supabase 数据库（可选，默认使用本地 SQLite）
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key

# LLM API 配置
LLM_API_KEY=your_api_key
LLM_BASE_URL=https://ai.juguang.chat/v1/chat/completions
LLM_MODEL=gemini-3-pro-preview-thinking

# Moonshine ASR 模型路径（下载后自动填写）
MOONSHINE_MODEL_PATH=C:/Users/YourName/AppData/Local/moonshine_voice/...
MOONSHINE_MODEL_ARCH=1
```

### 6. 启动服务

```bash
# 终端 1 - 启动后端
cd api
.\venv\Scripts\Activate
uvicorn api.main:app --reload --port 8000

# 终端 2 - 启动前端
npm run dev
```

### 7. 访问应用

浏览器打开：http://localhost:5173

---

## 目录结构

```
BeeEVAL/
├── src/                    # 前端源码
│   ├── pages/              # 页面组件
│   │   ├── Home.tsx        # 首页（视频上传）
│   │   ├── History.tsx     # 历史记录
│   │   ├── Database.tsx    # 数据库视图
│   │   └── Settings.tsx    # 设置
│   ├── components/         # 公共组件
│   ├── contexts/           # React Context
│   └── hooks/              # 自定义 Hooks
├── api/                    # 后端源码
│   ├── routers/            # API 路由
│   │   ├── video.py        # 视频分析接口
│   │   ├── chat.py         # 智能查询接口
│   │   ├── system.py       # 系统接口
│   │   └── translation.py  # 翻译接口
│   ├── services/           # 业务服务
│   │   ├── video_service.py    # 视频处理/Moonshine ASR
│   │   ├── llm_service.py      # LLM 评估
│   │   ├── local_db_client.py  # 本地 SQLite 客户端
│   │   └── supabase_client.py  # Supabase 客户端
│   ├── core/               # 核心模块
│   │   ├── config.py       # 配置管理
│   │   └── logger.py       # 日志管理
│   └── download_moonshine_model.py  # 模型下载脚本
├── CHANGELOG/              # 更新日志
├── memory/                 # 项目记忆
├── public/                 # 静态资源
│   └── screenshots/        # 视频截图
├── temp_files/             # 临时文件
├── beeeval.db              # 本地数据库
├── .env                    # 环境变量
├── package.json            # 前端依赖
└── README.md               # 本文件
```

---

## API 端点

### 视频分析

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/video/list` | 列出文件夹中的视频文件 |
| POST | `/api/video/analyze` | 开始视频分析任务 |
| GET | `/api/video/status/:task_id` | 获取分析任务状态 |
| GET | `/api/video/results/:task_id` | 获取完整分析结果 |
| PUT | `/api/video/result/:result_id` | 更新视频结果 |
| DELETE | `/api/video/result/:result_id` | 删除视频结果 |
| DELETE | `/api/video/results/batch` | 批量删除结果 |

### 任务管理

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/video/tasks` | 获取所有任务列表 |
| DELETE | `/api/video/tasks/batch` | 批量删除任务 |

### 智能查询

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/chat/query` | 智能数据查询 |

### 系统

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/system/logs` | 获取系统日志 |
| GET | `/api/video/stream` | 流式播放视频 |

---

## 技术栈

**前端:**
- React 18 + TypeScript
- Vite 6
- Tailwind CSS
- React Router
- Zustand (状态管理)
- React Query

**后端:**
- FastAPI
- Moonshine ASR (语音识别)
- Supabase / SQLite (数据库)
- OpenAI SDK / Gemini (LLM 调用)
- FFmpeg (音视频处理)
- moviepy (视频处理)

---

## 数据库 Schema

### analysis_tasks
```sql
CREATE TABLE analysis_tasks (
    id TEXT PRIMARY KEY,
    folder_path TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    total_videos INTEGER DEFAULT 0,
    completed_videos INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);
```

### video_results
```sql
CREATE TABLE video_results (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    video_name TEXT,
    transcript TEXT,
    metadata TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES analysis_tasks(id)
);
```

### evaluation_scores
```sql
CREATE TABLE evaluation_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    result_id TEXT NOT NULL,
    criteria TEXT NOT NULL,
    score REAL,
    feedback TEXT,
    FOREIGN KEY (result_id) REFERENCES video_results(id)
);
```

---

## 开发指南

### 运行测试

```bash
# 前端测试
npm run test

# 后端测试
pytest api/tests/
```

### 构建

```bash
# 前端构建
npm run build

# 后端安装
cd api
pip install -e .
```

### 数据库迁移

```bash
# 添加新字段示例
sqlite3 beeeval.db "ALTER TABLE analysis_tasks ADD COLUMN completed_at TIMESTAMP;"
```

---

## 常见问题

### Moonshine 模型下载失败
```bash
# 检查网络连接
# 手动下载模型后指定路径
python download_moonshine_model.py --help
```

### 端口被占用
```bash
# 修改启动端口
uvicorn api.main:app --reload --port 8001
```

### 视频分析失败
1. 检查 FFmpeg 是否正确安装：`ffmpeg -version`
2. 检查视频文件路径是否包含特殊字符
3. 查看后端日志：`api/logs/`

### 中文乱码问题
- 确保数据库使用 UTF-8 编码
- 视频文件名中的中文字符已正确处理

---

## 更新日志

详见 [CHANGELOG/CHANGELOG.md](CHANGELOG/CHANGELOG.md)

### v1.0.0 (2026-03)
- ✨ 集成 Moonshine ASR，语音识别速度提升 10 倍
- 🐛 修复 video_analysis API 完整流程
- 📝 完善项目文档

---

## 许可证

MIT License

---

## 贡献

欢迎提交 Issue 和 Pull Request！



------

260318：

视频分析进度跟踪问题 - 会话总结

  问题背景

  用户需要在视频分析功能中实现实时进度跟踪，让前端进度条显示每个处理步骤（上传视频 → 提取音频 → 转录 → LLM
  评估 → 保存结果），而不是直接从 0% 跳到 100%。

---
  已完成修改

  1. 前端 src/pages/Home.tsx

  - 轮询逻辑优化：添加了立即获取状态的逻辑，然后每 200ms 轮询一次
  - 添加了 isUnmounted 标志：防止组件卸载后继续更新状态
  - 进度状态类型：添加了 current_phase?: string 到 progressMap 类型定义

  // 关键修改：立即获取状态 + 定期轮询
  const fetchAndSetStatus = async () => {
      const status = await getAnalysisStatus(analysisTaskId);
      // 更新进度状态并记录日志
  };

  // 启动时立即执行一次，然后每 200ms 轮询
  fetchAndSetStatus();
  pollInterval = setInterval(fetchAndSetStatus, 200);

  2. 后端 api/routers/video.py

  - 添加了 update_progress() 函数：在每个处理阶段更新数据库
  - 进度阶段：
    - "Initializing Analysis" (5%)
    - "Extracting Audio from Video" (10%)
    - "Audio Extraction Complete" (20%)
    - "Transcribing Audio ({model} ASR)" (30%)
    - "Transcription Complete" (45%)
    - "Capturing System Screenshot" (50%)
    - "Screenshot Captured" (55%)
    - "Sending to LLM for AI Analysis" (60%)
    - "LLM Analysis Complete" (80%)
    - "Saving Results to Database" (90%)
    - "Completed" (100%)
  - 错误处理改进：失败时将 progress 设置为 100（表示处理完成），而不是重置为 0

  3. 前端 src/i18n.ts

  - 添加了所有进度阶段的中英文翻译

---
  当前存在的问题

  核心问题：前端无法捕捉到中间进度状态

  现象：
  - 控制台只显示 [Polling] video.mp4: Failed (100%) - status: failed
  - 没有中间进度日志（如 5%、10%、30% 等）

  已排查原因：
  1. ~~旧 Python 进程占用资源~~ ✅ 已解决（已杀死所有旧进程并重启）
  2. ~~轮询间隔太慢~~ ✅ 已调整为 200ms
  3. ~~前端类型定义错误~~ ✅ 已添加 current_phase 字段

  待排查原因：

  1. 视频处理速度太快：在第一次轮询前（200ms 内）就完成了大部分步骤

    - 需要验证：添加人工延迟或检查处理时间
  2. 数据库更新未生效：update_progress() 中的 supabase.table().update() 可能因为 local_db_client
    的兼容性问题没有实际执行

    - 需要验证：检查 local_db_client.py 的 UPDATE 逻辑
  3. 前端获取的是旧数据：数据库中可能复用了之前失败的任务记录

    - 需要验证：每次分析前清理旧记录或使用唯一标识
  4. LLM 服务不可用：之前返回 503 错误（system disk overloaded），导致任务快速失败

    - 需要验证：检查 LLM 服务状态
  5. 后台任务未执行：任务创建后，background_tasks.add_task() 可能没有实际执行

    - 需要验证：检查 uvicorn 后台任务配置

---
  下次会话需要继续的工作

  1. 验证后端 [PROGRESS] 日志：在处理视频时，后端日志中是否有类似输出：
    [PROGRESS] video.mp4: Initializing Analysis (5%)
    [PROGRESS] video.mp4: Extracting Audio from Video (10%)
  2. 检查数据库实时更新：在视频处理过程中，直接查询数据库确认 metadata 是否更新
  3. 测试新任务：确保不是复用旧的任务记录，而是创建全新的任务和视频结果记录
  4. LLM 服务状态：确认 LLM 服务是否可用，如果不可用需要修复或添加降级处理
  5. 考虑添加人工延迟：在 update_progress() 调用后添加短暂延迟（如 100ms），确保前端能捕捉到状态变化

---
  关键文件位置

  - 前端：D:\data\project_IntelliJ\BeeEVAL\src\pages\Home.tsx
  - 后端：D:\data\project_IntelliJ\BeeEVAL\api\routers\video.py
  - 数据库：D:\data\project_IntelliJ\BeeEVAL\beeeval.db
  - 后端日志：C:\Users\cloud\AppData\Local\Temp\claude\D--data-project-IntelliJ-BeeEVAL\tasks\ban1w29ee.output