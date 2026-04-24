# 配置指南

## 快速配置

### 前端配置 (`src/config.ts`)

修改 `SERVER_URL` 来更改后端服务器地址：

```typescript
// 默认配置（使用 Vite 代理）
export const BASE_URL = '/api';
export const SERVER_URL = 'http://localhost:8000';
```

**生产环境部署：**
```typescript
// 直接访问后端服务器
export const BASE_URL = 'https://your-api-domain.com/api';
export const SERVER_URL = 'https://your-api-domain.com';
```

### 测试脚本配置 (`test_analyze.py`)

修改 `BASE_URL` 来更改后端服务器地址：

```python
BASE_URL = "http://localhost:8000"
API_PREFIX = "/api/video"
```

## 配置文件位置

| 文件 | 用途 | 配置项 |
|------|------|--------|
| `src/config.ts` | 前端 API 配置 | `BASE_URL`, `SERVER_URL` |
| `test_analyze.py` | 测试脚本配置 | `BASE_URL`, `API_PREFIX` |
| `.env` | 后端环境变量 | `LLM_API_KEY`, `SUPABASE_URL` 等 |

## API 端点常量

所有 API 端点都在 `src/config.ts` 中集中管理：

```typescript
export const API_ENDPOINTS = {
    LIST_VIDEOS: '/video/list',
    ANALYZE_VIDEOS: '/video/analyze',
    GET_RESULTS: '/video/results',
    GET_STATUS: '/video/status',
    GET_TASKS: '/video/tasks',
    GET_ALL_RESULTS: '/video/all-results',
    UPDATE_RESULT: '/video/result',
    DELETE_RESULT: '/video/result',
    DELETE_RESULTS_BATCH: '/video/results/batch',
    DELETE_TASKS_BATCH: '/video/tasks/batch',
    CHAT_QUERY: '/chat/query',
    TRANSLATE: '/translate',
    STREAM_VIDEO: '/video/stream',
    SYSTEM_LOGS: '/system/logs',
} as const;
```

## 辅助函数

`src/config.ts` 提供了以下辅助函数：

| 函数 | 用途 | 示例 |
|------|------|------|
| `getApiUrl(endpoint)` | 获取 API 完整 URL | `getApiUrl('/video/list')` |
| `getServerUrl(path)` | 获取服务器完整 URL | `getServerUrl('/screenshots/1.jpg')` |
| `getVideoStreamUrl(path)` | 获取视频流 URL | `getVideoStreamUrl('C:/video.mp4')` |
| `getScreenshotUrl(path)` | 获取截图 URL | `getScreenshotUrl('/screenshots/1.jpg')` |

## 迁移指南

### 从硬编码迁移

之前硬编码在代码中的 URL：

```typescript
// ❌ 旧方式
<img src={`http://localhost:8000${row.metadata.screenshot_path}`} />

// ✅ 新方式
<img src={getScreenshotUrl(row.metadata.screenshot_path)} />
```

### 修改已更新的文件

以下文件已更新为使用配置：
- `src/api.ts` - API 调用封装
- `src/pages/Database.tsx` - 数据库视图
- `src/pages/Results.tsx` - 结果详情页
- `test_analyze.py` - Python 测试脚本

## 环境变量

后端的 `.env` 文件配置：

```env
# Supabase 数据库（可选）
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key

# LLM API 配置
LLM_API_KEY=your_api_key
LLM_BASE_URL=https://ai.juguang.chat/v1/chat/completions
LLM_MODEL=gemini-3-pro-preview-thinking

# Moonshine ASR 模型
MOONSHINE_MODEL_PATH=C:/Users/YourName/AppData/Local/moonshine_voice/...
MOONSHINE_MODEL_ARCH=1
```
