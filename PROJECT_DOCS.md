# BeeEVAL 项目文档

## 项目概述

BeeEVAL 是一个智能座舱 AI 评测系统，用于分析车载语音助手的交互表现。系统通过视频分析、语音转写、LLM 评估和 RAG 检索增强生成，提供全面的评测能力。

**开发时间**: 2026 年 2 月 - 4 月
**技术栈**: FastAPI + React + TypeScript + Qdrant + SQLite

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 (React + TypeScript)                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │  Home.tsx   │ │Database.tsx │ │AskBeeEval.tsx│ │VectorMgr │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP (axios)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    后端 (FastAPI + Python)                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │ video.py    │ │  rag.py     │ │ system.py   │ │  chat.py  │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │video_service│ │ rag_service │ │ llm_service │ │ embed_svc │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │  SQLite  │   │ Qdrant   │   │ Gemini   │
        │(本地数据库)│   │(向量数据库)│   │ (LLM API)│
        └──────────┘   └──────────┘   └──────────┘
```

---

## 核心功能模块

### 1. 视频分析模块 (`api/routers/video.py`)

**功能**: 分析视频文件，提取音频 → 语音转写 → LLM 评估

**流程**:
```
视频文件 → 提取音频 → ASR 转写 → 截图 → LLM 分析 → 存储结果
```

**并发控制**: 线程池限制为 3 个并发任务（`ThreadPoolExecutor(max_workers=3)`）

**ASR 模型支持**:
- `funasr` (默认) - 中文识别效果最佳
- `whisper` - 多语言支持
- `moonshine` - 快速推理

**关键配置**:
```python
# api/routers/video.py:22
executor = ThreadPoolExecutor(max_workers=3)
```

### 2. RAG 检索增强模块 (`api/routers/rag.py`)

**功能**: 基于向量库的智能问答，提供有观点、有数据、有案例的专业回答

**核心特性**:
1. **语言自动检测**: 中文提问→中文回答，英文提问→英文回答
2. **结构化输出**:
   - 观点先行（一句话结论）
   - 数据支撑（"根据 X 个案例显示..."）
   - 案例佐证（带视频链接）
   - Markdown 层次结构
3. **向量检索**: 使用 bge-base-zh 模型生成 768 维向量
4. **动态视频路径**: 从数据库查询视频实际路径，前端可点击播放

**Prompt 结构**:
```python
system_instruction = """
【回答要求】
1. 观点先行：开头用一句话清晰表达核心观点/结论
2. 数据支撑：观点必须基于向量库中的统计结果
3. 案例佐证：引用 1-2 个典型案例，包含视频链接
4. 语言匹配：用户用什么语言提问就用什么语言回答
5. 结构清晰：使用 Markdown 格式（## 标题、### 子标题、**加粗**、列表、引用）
"""
```

### 3. 数据库模块

#### SQLite (`api/services/local_db_client.py`)

**表结构**:
```sql
-- 分析任务表
analysis_tasks (
    id, folder_path, status, total_videos,
    completed_videos, created_at
)

-- 视频结果表
video_results (
    id, task_id, video_name, transcript, metadata,
    case_id, brand_model, system_version,
    function_domain, scenario, sequence,  -- 结构化字段
    created_at
)

-- 评估分数表
evaluation_scores (
    id, result_id, criteria, score, feedback,
    metric_code, category, selection_reason  -- 多案例支持
)
```

#### Qdrant (`api/services/rag_service.py`)

**集合**: `beeeval`
**向量维度**: 768 (bge-base-zh)
**距离度量**: COSINE

**API 变更** (Qdrant Client 新版本):
```python
# 旧版本
results = client.search(collection_name, query_vector, limit)

# 新版本 (v1.9+)
results = client.query_points(collection_name, query=query_vector, limit).points
```

### 4. 前端页面

#### Home 页面 (`src/pages/Home.tsx`)

**功能**: 视频分析控制台
- 文件夹选择（从盘符开始浏览）
- 视频列表展示
- ASR 模型选择
- 实时进度显示
- 批量分析

#### Database 页面 (`src/pages/Database.tsx`)

**功能**: 视频结果管理
- 4 个结构化字段显示（Case ID、Brand/Model、System Version、Function Domain）
- 多条件筛选
- 列排序
- 批量删除
- 编辑功能

**关键修复**: 解决了 `filteredResults` 循环引用问题
```typescript
// 修复前（循环引用）
const sortedResults = [...filteredResults].sort(...)
const filteredResults = sortedResults.filter(...)

// 修复后
const filteredThenSortedResults = [...results]
    .filter(r => { /* filter logic */ })
    .sort((a, b) => { /* sort logic */ })
```

#### AskBeeEval 组件 (`src/components/AskBeeEval.tsx`)

**功能**: RAG 智能问答
- Markdown 渲染（react-markdown）
- 视频链接点击播放
- 中英文自动切换
- 向量库状态显示

---

## 视频名称解析

**格式**: `{用例 ID}-{品牌车型}-{系统版本}-{功能域}-{场景描述}-{序号}.mp4`

**示例**: `1002-理想 i8-v8.0.1-车控域-NULL-1.mp4`

**解析器**: `api/core/video_name_parser.py`
```python
def parse_video_name(video_name: str) -> Dict[str, Optional[str]]:
    """
    解析视频名称，提取结构化信息
    返回：case_id, brand_model, system_version, function_domain, scenario, sequence, parsed
    """
```

---

## 配置说明

### 后端配置 (`api/core/config.py`)

```python
QDRANT_URL = "http://localhost:6333"
QDRANT_COLLECTION = "beeeval"
GEMINI_API_KEY = "your-key-here"  # 用于翻译服务
```

### 前端配置 (`src/config.ts`)

```typescript
export const BASE_URL = '/api';
export const SERVER_URL = 'http://localhost:8000';
```

### Vite 代理 (`vite.config.ts`)

```typescript
proxy: {
    '/api': {
        target: 'http://localhost:8004',  // 后端端口
        changeOrigin: true,
    },
}
```

---

## 启动指南

### 环境要求
- Python 3.12+
- Node.js 18+
- Qdrant (Docker 或本地)
- FFmpeg

### 后端启动

```bash
# 1. 激活虚拟环境
cd D:\data\project_IntelliJ\BeeEVAL
api\venv\Scripts\activate

# 2. 启动 Qdrant (如未运行)
docker run -p 6333:6333 qdrant/qdrant

# 3. 启动 FastAPI 后端
python -m uvicorn api.main:app --host 127.0.0.1 --port 8004 --reload
```

**后端端口**: 8004

### 前端启动

```bash
# 1. 安装依赖（首次）
npm install

# 2. 启动开发服务器
npm run dev

# 端口：3000 (如被占用自动切换到 3001/3002)
```

**访问地址**: `http://localhost:3000`

---

## 关键修复记录

### 1. Database 页面空白修复
- **问题**: `filteredResults` 与 `sortedResults` 循环引用
- **修复**: 合并为 `filteredThenSortedResults`，先 filter 后 sort
- **文件**: `src/pages/Database.tsx`

### 2. RAG 接口 404 修复
- **问题**: 请求路径重复 `/api` (`/api/api/rag/...`)
- **修复**:
  - `src/api.ts` 中 RAG 路径去掉 `/api` 前缀
  - `vite.config.ts` 代理端口改为 8004
- **文件**: `src/api.ts`, `vite.config.ts`

### 3. Qdrant API 兼容性修复
- **问题**: `QdrantClient.search()` 方法在新版本中已移除
- **修复**: 改用 `client.query_points(...).points`
- **文件**: `api/services/rag_service.py`

### 4. 并发处理数调整
- **问题**: 4 个并发视频处理导致卡顿
- **修复**: 线程池 `max_workers` 从 4 改为 3
- **文件**: `api/routers/video.py`

---

## 文件结构

```
BeeEVAL/
├── api/
│   ├── core/                    # 核心模块
│   │   ├── config.py           # 配置
│   │   ├── logger.py           # 日志
│   │   ├── ssl_patch.py        # SSL 补丁
│   │   └── video_name_parser.py # 视频名称解析器
│   ├── routers/                 # API 路由
│   │   ├── video.py            # 视频分析
│   │   ├── rag.py              # RAG 问答
│   │   ├── system.py           # 系统接口
│   │   ├── chat.py             # 聊天接口
│   │   └── translation.py      # 翻译接口
│   └── services/                # 服务层
│       ├── video_service.py    # 视频处理服务
│       ├── llm_service.py      # LLM 服务
│       ├── rag_service.py      # RAG 服务
│       ├── embed_service.py    # 嵌入服务
│       ├── local_db_client.py  # SQLite 客户端
│       └── supabase_client.py  # Supabase 客户端
├── src/
│   ├── pages/
│   │   ├── Home.tsx            # 首页（分析控制台）
│   │   ├── Database.tsx        # 数据库页面
│   │   ├── VectorManager.tsx   # 向量库管理
│   │   └── ...
│   ├── components/
│   │   ├── AskBeeEval.tsx      # RAG 问答组件
│   │   └── ...
│   ├── api.ts                   # API 调用封装
│   ├── config.ts                # 前端配置
│   └── types.ts                 # TypeScript 类型定义
├── model/                       # 本地 AI 模型
│   └── bge-base-zh-v1.5/       # 中文嵌入模型
├── logs/                        # 日志目录
├── public/                      # 静态资源
└── backups/                     # 数据备份
```

---

## API 端点

### 视频分析
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/video/list` | POST | 列出文件夹中的视频 |
| `/api/video/analyze` | POST | 开始分析视频 |
| `/api/video/status/{task_id}` | GET | 获取分析进度 |
| `/api/video/results/{task_id}` | GET | 获取分析结果 |
| `/api/video/asr-models` | GET | 获取 ASR 模型列表 |

### RAG 问答
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/rag/vectorize` | POST | 向量化评估结果 |
| `/api/rag/query` | POST | RAG 检索问答 |
| `/api/rag/stats` | GET | 获取向量库统计 |
| `/api/rag/video/{video_name}` | DELETE | 删除视频向量 |

### 数据库管理
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/video/all-results` | GET | 获取所有结果 |
| `/api/video/result/{id}` | PUT | 更新结果 |
| `/api/video/result/{id}` | DELETE | 删除结果 |
| `/api/video/results/batch` | DELETE | 批量删除 |

---

## 开发注意事项

### 1. 端口冲突
- 后端默认端口: 8004
- 前端默认端口: 3000 (自动递增)
- Qdrant 端口: 6333

### 2. 路径格式
- Windows 路径使用双反斜杠 `\\` 或原始字符串 `r"path"`
- 前端 API 调用使用相对路径 `/api/...`

### 3. 日志查看
```bash
# 后端日志
tail -f logs/beeeval.log

# 前端控制台直接查看
```

### 4. 数据库备份
```bash
# 备份 SQLite 数据库
cp data/beeeval.db backups/beeeval_$(date +%Y%m%d).db
```

---

## 扩展开发指南

### 添加新的 API 端点

1. 在 `api/routers/` 下创建新路由文件
2. 在 `api/main.py` 中注册路由
3. 在 `src/api.ts` 中添加前端调用函数

### 添加新的数据库字段

1. 修改 `api/services/local_db_client.py` 的表结构
2. 更新 `src/types.ts` 的类型定义
3. 更新相关组件的字段处理逻辑

### 修改 RAG Prompt

1. 编辑 `api/routers/rag.py` 的 `system_instruction`
2. 调整 `temperature` 和 `max_tokens` 参数
3. 重启后端服务测试

---

## 常见问题

### Q: 视频分析卡住不动
**A**: 检查：
1. 后端日志是否有错误
2. FFmpeg 是否正常工作
3. ASR 模型是否加载成功
4. 并发数是否过高（建议 ≤3）

### Q: RAG 问答返回 500 错误
**A**: 检查：
1. Qdrant 服务是否运行
2. 向量库是否有数据
3. LLM API 密钥是否有效
4. 后端日志查看详细错误

### Q: 前端页面空白
**A**: 检查：
1. 浏览器控制台是否有 JS 错误
2. 端口是否正确（3000 vs 3002）
3. 后端服务是否可访问

---

## 版本历史

- **v1.0** - 基础视频分析功能
- **v1.1** - 添加 RAG 检索增强问答
- **v1.2** - 视频名称解析与结构化存储
- **v1.3** - 前端筛选排序与多案例支持
- **v1.4** - RAG 输出结构化优化（本次）

---

## 联系与维护

本项目由 Claude (Anthropic) 协助开发维护。
下次开发前请阅读此文档以快速了解项目结构和关键配置。

**最后更新**: 2026-04-07
