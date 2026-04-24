# P1 优化工作日志：NAS 服务层对接

> 日期：2026-04-09
> 优先级：P1（NAS 视频源对接）
> 状态：已完成
> 依赖：P0（服务端分页 + N+1 消除）

---

## 一、优化目标

1. 对接绿联 NAS 文件服务 API，实现 NAS 视频浏览、搜索、流播放
2. 后端代理转发视频流，隐藏 NAS Token，保障安全
3. 支持从 NAS 下载视频到本地进行 ASR 分析（双源处理）
4. 视频名称解析器兼容 NAS 5 段式命名格式

---

## 二、NAS 环境信息

| 项目 | 值 |
|------|-----|
| NAS 地址 | `114.215.186.130:8900`（内网穿透） |
| 认证方式 | Token 查询参数 |
| 视频根目录 | `/volume1/beeeval/BeeEval测试视频` |
| 目录结构 | 按「日期+车型」组织，如 `20251028理想i8/` |
| 视频命名 | `{case_id}-{brand_model}-{version}-{domain}-{quality_tag}.mp4` |
| 示例 | `1002-理想i8-v8.0.1-车控域-NULL.mp4` |
| 视频数量 | 11 个车型目录，单目录最大 984 个视频 |

### NAS 目录结构

```
/volume1/beeeval/BeeEval测试视频/
├── 20250910奔驰CLA300/
├── 20251022银河m9/
├── 20251028理想i8/          (984 个视频)
├── 20251103小米yu7/
├── 20251105蔚ET5T/
├── 20251110问界M9/
├── 20251113红旗EH7/
├── 20251117凯美瑞/
├── 20251121雷克萨斯/
├── 20260205小米yu7视频/
└── 20260205银河M9视频/
```

---

## 三、改动文件清单

### 3.1 `.env` — 新增 NAS 环境变量

```env
NAS_URL=http://114.215.186.130:8900
NAS_TOKEN=K2z4sxdJXvVD3oEnkf9uHGEIOHAX59wT-1v8pABUMS8
NAS_VIDEO_ROOT=/volume1/beeeval/BeeEval测试视频
```

### 3.2 `api/core/config.py` — 新增 NAS 配置字段

```python
NAS_URL: str = os.getenv("NAS_URL", "")
NAS_TOKEN: str = os.getenv("NAS_TOKEN", "")
NAS_VIDEO_ROOT: str = os.getenv("NAS_VIDEO_ROOT", "/volume1")
```

### 3.3 `api/services/nas_service.py` — 新建文件

**NAS API 客户端**，封装所有 NAS HTTP 接口：

| 方法 | 说明 |
|------|------|
| `browse(path, type_filter, sort, order, offset)` | 浏览 NAS 目录，支持类型过滤和分页 |
| `search(path, keyword, depth, limit)` | 按关键词搜索 NAS 文件 |
| `info(path)` | 获取文件/目录详细信息 |
| `get_stream_url(nas_path)` | 生成带 Token 的 NAS 流 URL（内部使用） |
| `download_to_temp(nas_path)` | 下载视频到本地临时目录，返回本地路径 |
| `cleanup_temp(local_path)` | 分析完成后清理临时文件 |
| `stream_video(nas_path, range_header)` | 流式代理视频，支持 Range 请求 |
| `available` (property) | 检查 NAS 是否已配置 |

**关键设计**：

- 下载使用 5 分钟超时（`read=300s`），支持大文件
- 流式下载，1MB chunk，打印下载进度
- 已存在的临时文件跳过下载（避免重复下载）
- 文件名安全处理：`re.sub(r'[^\w\-_\.]', '_', ...)`
- 清理时校验路径必须在 `TEMP_DIR` 内（防误删）

### 3.4 `api/routers/nas.py` — 新建文件

**NAS API 路由**，前端通过后端代理访问 NAS：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/nas/status` | GET | 检查 NAS 连接状态 |
| `/api/nas/browse` | GET | 浏览 NAS 目录 |
| `/api/nas/search` | GET | 搜索 NAS 文件 |
| `/api/nas/info` | GET | 获取文件信息 |
| `/api/nas/stream` | GET | **代理视频流**（转发 Range 头，隐藏 Token） |
| `/api/nas/scan` | POST | 扫描目录，解析所有视频名称，返回结构化信息 |

**视频流代理关键实现**：

```python
@router.get("/stream")
async def stream_nas_video(path: str, request: Request):
    range_header = request.headers.get("range")
    gen, status_code, headers = await nas_service.stream_video(path, range_header)
    return StreamingResponse(gen, status_code=status_code, headers=headers)
```

- 前端 `<video src="/api/nas/stream?path=...">` 即可播放 NAS 视频
- 支持 HTTP Range（拖拽进度条）
- NAS Token 完全隐藏，前端无感知

### 3.5 `api/routers/video.py` — 改造

**新增端点** `POST /api/video/analyze-nas`：

```python
class NasAnalyzeRequest(BaseModel):
    nas_paths: list[str]           # NAS 视频完整路径列表
    analysis_config: Optional[dict]
    asr_model: Optional[str] = "funasr"
```

**`process_video()` 改造为双源处理**：

```python
async def process_video(..., source: str = "local"):
    nas_temp_path = None
    try:
        actual_path = video_path
        if source == "nas":
            update_progress("Downloading from NAS", 5)
            nas_temp_path = await nas_service.download_to_temp(video_path)
            actual_path = nas_temp_path

        # 后续 extract_audio / capture_frame 使用 actual_path
        audio_path = per_request_video_service.extract_audio(actual_path)
        ...
    finally:
        if nas_temp_path:
            await nas_service.cleanup_temp(nas_temp_path)
```

**改动要点**：

| 改动 | 说明 |
|------|------|
| 新增 `source` 参数 | `"local"` 或 `"nas"` |
| NAS 下载步骤 | 分析前下载到 `temp_files/nas_xxx.mp4` |
| `actual_path` 替代 `video_path` | 所有文件操作（extract_audio, capture_frame）使用实际本地路径 |
| finally 清理 | NAS 临时文件分析完成后自动删除 |
| task folder_path | NAS 任务显示 `[NAS] /volume1/beeeval/...` 前缀 |
| metadata.video_source | NAS 视频结果标记 `"nas"` |

### 3.6 `api/core/video_name_parser.py` — 增强

**新增 5 段格式支持**：

| 格式 | 示例 | 说明 |
|------|------|------|
| 6 段（原有） | `1002-理想 i8-v8.0.1-车控域-NULL-1.mp4` | 含序号 |
| 5 段（NAS） | `1002-理想i8-v8.0.1-车控域-NULL.mp4` | 含质量标记，无序号 |

**新增字段** `quality_tag`：5 段格式的第 5 段（如 `NULL`、`Bad`）

**解析优先级**：6 段 → 5 段 → 回退分割

**扩展视频后缀支持**：`.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`

### 3.7 `api/main.py` — 注册新路由

```python
from api.routers import video, system, chat, translation, rag, nas
app.include_router(nas.router)
```

---

## 四、新增 API 接口速查

### NAS 浏览

```bash
# 检查 NAS 状态
curl http://localhost:8004/api/nas/status

# 浏览默认根目录（BeeEval测试视频）
curl "http://localhost:8004/api/nas/browse"

# 浏览指定目录，只看视频
curl "http://localhost:8004/api/nas/browse?path=/volume1/beeeval/BeeEval测试视频/20251028理想i8&type=video"

# 搜索视频
curl "http://localhost:8004/api/nas/search?keyword=1002&path=/volume1/beeeval/BeeEval测试视频"

# 播放 NAS 视频（前端用）
<video src="http://localhost:8004/api/nas/stream?path=/volume1/beeeval/BeeEval测试视频/20251028理想i8/1002-理想i8-v8.0.1-车控域-NULL.mp4" controls />
```

### NAS 目录扫描

```bash
curl -X POST http://localhost:8004/api/nas/scan \
  -H "Content-Type: application/json" \
  -d '{"nas_path": "/volume1/beeeval/BeeEval测试视频/20251028理想i8"}'
```

返回：
```json
{
  "nas_path": "/volume1/beeeval/BeeEval测试视频/20251028理想i8",
  "total_files": 984,
  "video_files": 984,
  "parsed_videos": [
    {
      "video_name": "1002-理想i8-v8.0.1-车控域-NULL.mp4",
      "nas_path": "/volume1/beeeval/BeeEval测试视频/20251028理想i8/1002-理想i8-v8.0.1-车控域-NULL.mp4",
      "size": 14011204,
      "case_id": "1002",
      "brand_model": "理想i8",
      "system_version": "v8.0.1",
      "function_domain": "车控域",
      "quality_tag": "NULL",
      "parsed": true
    },
    ...
  ]
}
```

### NAS 视频分析

```bash
curl -X POST http://localhost:8004/api/video/analyze-nas \
  -H "Content-Type: application/json" \
  -d '{
    "nas_paths": [
      "/volume1/beeeval/BeeEval测试视频/20251028理想i8/1002-理想i8-v8.0.1-车控域-NULL.mp4",
      "/volume1/beeeval/BeeEval测试视频/20251028理想i8/1003-理想i8-v8.0.1-车控域-NULL.mp4"
    ],
    "asr_model": "funasr"
  }'
```

---

## 五、验证方式

### 5.1 NAS 连通性

```bash
curl http://localhost:8004/api/nas/status
# 应返回 {"available": true, "root": "/volume1/beeeval/BeeEval测试视频", "roots": [...]}
```

### 5.2 NAS 浏览

```bash
curl "http://localhost:8004/api/nas/browse"
# 应返回 11 个车型目录

curl "http://localhost:8004/api/nas/browse?path=/volume1/beeeval/BeeEval测试视频/20251028理想i8&type=video"
# 应返回 984 个视频文件
```

### 5.3 视频流代理

浏览器直接访问：
```
http://localhost:8004/api/nas/stream?path=/volume1/beeeval/BeeEval测试视频/20251028理想i8/1002-理想i8-v8.0.1-车控域-NULL.mp4
```
应能在浏览器中播放视频，且支持拖拽进度条。

### 5.4 NAS 分析（端到端）

1. 调用 `POST /api/video/analyze-nas` 提交 1-2 个 NAS 视频
2. 用 `GET /api/video/status/{task_id}` 轮询进度
3. 进度应显示 "Downloading from NAS" → "Extracting Audio" → "Transcribing" → "LLM Analysis" → "Completed"
4. 完成后在 Database 页面查看结果

---

## 六、安全说明

| 措施 | 说明 |
|------|------|
| Token 隐藏 | NAS Token 只在后端使用，前端通过 `/api/nas/*` 代理访问 |
| 路径校验 | NAS API Server 自身有 `allowed_roots` 白名单 |
| 临时文件清理 | 分析完成后自动删除，cleanup_temp 校验路径在 TEMP_DIR 内 |
| 超时保护 | 连接 10s、读取 30s（浏览）/ 300s（下载）/ 120s（流） |

---

## 七、前端适配改动（2026-04-09）

### 7.1 `src/config.ts`

新增 NAS API 端点常量 + NAS 视频流 URL 生成函数：

```typescript
// 新增端点
NAS_STATUS: '/nas/status',
NAS_BROWSE: '/nas/browse',
NAS_SEARCH: '/nas/search',
NAS_INFO: '/nas/info',
NAS_STREAM: '/nas/stream',
NAS_SCAN: '/nas/scan',
ANALYZE_NAS: '/video/analyze-nas',

// 新增函数
export const getNasStreamUrl = (nasPath: string): string => {
    return `${SERVER_URL}${API_ENDPOINTS.NAS_STREAM}?path=${encodeURIComponent(nasPath)}`;
};
```

### 7.2 `src/api.ts`

新增 NAS 相关 API 函数：

| 函数 | 说明 |
|------|------|
| `getNasStatus()` | 检查 NAS 连接状态 |
| `browseNas(params)` | 浏览 NAS 目录 |
| `searchNas(params)` | 搜索 NAS 文件 |
| `scanNasDirectory(nasPath)` | 扫描目录解析视频 |
| `analyzeNasVideos(nasPaths, asrModel)` | 提交 NAS 视频分析 |
| `getNasVideoUrl(nasPath)` | 生成 NAS 视频流 URL |

新增类型：`NasItem`, `NasBrowseResponse`

### 7.3 `src/pages/NASBrowser.tsx` — 新建

**NAS 浏览器页面**，完整功能：

| 功能 | 说明 |
|------|------|
| 目录浏览 | 点击文件夹进入，面包屑导航 + 返回上级 |
| 类型过滤 | 全部 / 仅视频 / 仅文件夹 |
| 排序切换 | 按名称排序，可切换 asc/desc |
| 文件搜索 | 关键词搜索当前目录，Enter 触发 |
| 视频预览 | 点击播放按钮弹出模态框播放 NAS 视频 |
| 批量选择 | 勾选视频 → 选择 ASR 模型 → 开始分析 |
| 分析跳转 | 提交后自动跳转到 Results 页面 |
| NAS 状态检测 | 不可用时显示友好提示 + 重试按钮 |
| 中英文支持 | 全部文案通过 i18n |

### 7.4 `src/App.tsx`

新增路由：`/nas` → `<NASBrowser />`

### 7.5 `src/components/Sidebar.tsx`

新增菜单项：`NAS 浏览器`（`HardDrive` 图标），位于「测试用例」和「向量管理」之间。

### 7.6 `src/i18n.ts`

中英文各新增 17 个 NAS 相关翻译键。

### 7.7 `src/pages/TestCases.tsx`

视频播放自动判断数据源：
```typescript
src={result.metadata?.video_source === 'nas'
    ? getNasVideoUrl(result.metadata.path)
    : getVideoUrl(result.metadata.path)}
```

---

## 八、前端验证方式

### 8.1 NAS 浏览器
1. 点击侧边栏「NAS 浏览器」→ 应显示 11 个车型目录
2. 点击任意车型目录 → 应显示视频文件列表
3. 点击视频右侧播放按钮 → 弹出模态框播放 NAS 视频
4. 勾选视频 → 选择 ASR 模型 → 点击「开始分析」→ 跳转到结果页

### 8.2 NAS 状态检测
1. 如果 NAS 不可用 → 应显示「NAS 不可用」提示页
2. 点击重试 → 重新检测

### 8.3 现有页面兼容
1. Database / TestCases → 本地视频结果正常播放
2. NAS 分析完成后 → Database/TestCases 中 NAS 视频也能播放

---

## 九、Bug 修复：NAS 视频播放失败

### 9.1 问题现象
NAS 浏览器中点击视频播放按钮，弹窗正常显示，但视频无法加载播放。

### 9.2 根因分析
`src/config.ts` 中存在两个配置错误：

| 问题 | 原值 | 正确值 |
|------|------|--------|
| `SERVER_URL` 端口错误 | `http://localhost:8000` | `http://localhost:8004` |
| 直连 URL 缺少 `/api` 前缀 | `SERVER_URL + '/nas/stream'` | `SERVER_URL + '/api/nas/stream'` |

导致 `<video src>` 请求发到了错误的地址。此外，Vite proxy 无法正确转发 `StreamingResponse`（返回 502），因此视频流必须直连后端，不能走 Vite 代理。

### 9.3 修复内容

**文件：`src/config.ts`**
```typescript
// 修复 1：SERVER_URL 端口
export const SERVER_URL = 'http://localhost:8004';

// 修复 2：视频流 URL 加 /api 前缀（直连后端，绕过 Vite proxy）
export const getVideoStreamUrl = (path: string): string => {
    return `${SERVER_URL}/api${API_ENDPOINTS.STREAM_VIDEO}?path=${encodeURIComponent(path)}`;
};

export const getNasStreamUrl = (nasPath: string): string => {
    return `${SERVER_URL}/api${API_ENDPOINTS.NAS_STREAM}?path=${encodeURIComponent(nasPath)}`;
};
```

### 9.4 验证结果
- 直连 `http://localhost:8004/api/nas/stream?path=...` → 200 OK，Content-Type: video/mp4
- Range 请求 → 206 Partial Content，Content-Range 正确
- 前端 HMR 热更新无编译错误

---

## 十、分页优化（三页面）

### 10.1 问题清单

| 页面 | 问题 | 影响 |
|------|------|------|
| NAS 浏览器 | NAS API 单次最多 500 条，全选只有 500 但总计 984 | 无法查看/操作后续文件 |
| 测试用例 | 硬编码 `limit:1000` 全量加载 | 大数据量卡顿 |
| Analysis Results | 单任务全部结果一次返回 | 大批量分析时响应慢 |

### 10.2 NAS 浏览器分页

**文件：`src/pages/NASBrowser.tsx`**
- 新增 `page` / `pageSize` 状态，`browse()` 接受 `offset` 参数
- 底部 footer 区域加入 `← 1-500 / 984 →` 翻页控件
- 切换目录时重置 `page = 0`

### 10.3 测试用例页面分页

**后端：`api/routers/video.py`**
- 新增 `GET /api/video/filter-options` 接口，返回 `brand_models`、`function_domains`、`system_versions` 的 DISTINCT 值
- 前端筛选下拉框数据来源从"前端遍历全量数据"改为"后端一次查询"

**前端：`src/pages/TestCases.tsx`**
- `PAGE_SIZE = 30`，服务端分页 + 筛选参数传后端
- 筛选器改为后端返回选项 + 搜索输入框
- 底部加翻页控件

**前端：`src/config.ts` / `src/api.ts`**
- 新增 `FILTER_OPTIONS` 端点和 `getFilterOptions()` API 函数

### 10.4 Analysis Results 页面分页

**后端：`api/routers/video.py`**
- `GET /api/video/results/{task_id}` 新增 `offset` / `limit` 参数（默认 20 条/页）
- 返回新增 `total` / `offset` / `limit` 字段
- 保留 `task` 元数据（进度计算不受分页影响）

**前端：`src/pages/Results.tsx`**
- `PAGE_SIZE = 20`
- 新增 `page` / `total` 状态，`fetchData` 传 `offset/limit`
- 表格底部添加翻页控件
- 轮询间隔从 2s 调整为 3s（分页后查询更轻量）

**前端：`src/api.ts`**
- `getResults()` 签名扩展支持 `{ offset, limit }` 参数

### 10.5 验证方式

1. **NAS 浏览器**：进入含 984 个视频的目录 → 底部显示 `1-500 / 984`，点击 `→` 翻到 `501-984`
2. **测试用例**：页面加载显示 `30` 条卡片 + 底部分页 `1 / N`，筛选后页数相应变化
3. **Analysis Results**：开始分析后每页显示 20 条，可翻页查看更多

---

## 十一、向量库管理功能

### 11.1 背景
原有向量管理页面只能「向量化入库」和查看统计，无法浏览/删除已入库的向量数据。

### 11.2 后端改动

**文件：`api/services/rag_service.py`**
- `scroll_vectors()`: 基于 Qdrant scroll API 分页浏览向量，支持按 `video_name`、`brand_model`、`function_domain` 筛选
- `get_point()`: 获取单条向量完整 payload
- `clear_collection()`: 删除并重建集合
- `get_payload_facets()`: 获取 video_name / brand_model / function_domain 的去重列表（供筛选器下拉框）

**文件：`api/routers/rag.py`**
- `GET /api/rag/vectors`: 分页浏览向量数据（offset/limit + 筛选参数）
- `GET /api/rag/vectors/{point_id}`: 获取单条向量详情
- `GET /api/rag/facets`: 获取筛选选项列表
- `POST /api/rag/vectors/delete-batch`: 批量按 ID 删除向量
- `POST /api/rag/vectors/clear`: 清空并重建向量集合（二次确认）

### 11.3 前端改动

**文件：`src/config.ts`**
- 新增 `RAG_VECTORS`、`RAG_FACETS`、`RAG_VECTORS_DELETE_BATCH`、`RAG_VECTORS_CLEAR` 端点

**文件：`src/api.ts`**
- 新增 `VectorPoint` 接口定义
- 新增 `listVectors()`、`getVectorFacets()`、`deleteVectorsBatch()`、`clearVectors()` API 函数

**文件：`src/pages/VectorManager.tsx`**
- 新增 `VectorBrowser` 子组件，嵌入原页面底部
- 功能：
  - **分页浏览**：Qdrant scroll 分页，每页 20 条
  - **三级筛选**：车型 / 功能域 / 视频名 下拉过滤
  - **勾选 + 批量删除**：支持全选当前页 + 批量删除
  - **清空向量库**：二次确认（输入"清空"）后清空并重建集合
  - **详情弹窗**：点击查看每条向量的完整 payload（视频名、问题、回复、评分、结构化字段等）
  - **实时联动**：删除/清空后自动刷新统计卡片

### 11.4 导出功能

**后端：`api/services/rag_service.py`**
- `export_all(with_vectors)`: 逐批 scroll 获取全部向量数据，`with_vectors=True` 时包含 embedding 向量

**后端：`api/routers/rag.py`**
- `GET /api/rag/export?with_vectors=true`: 导出为 JSON 文件下载，Content-Disposition attachment

**导出文件格式：**
```json
{
  "exported_at": "2026-04-09T...",
  "collection_name": "beeeval",
  "dimension": 768,
  "total_vectors": 123,
  "with_vectors": true,
  "points": [
    { "id": "...", "vector": [0.01, ...], "payload": { "video_name": "...", ... } }
  ]
}
```

**前端：`src/pages/VectorManager.tsx`**
- 向量浏览器 header 右侧新增「导出」按钮（`<a href="/api/rag/export" download>`）
- 向量库为空时按钮置灰

### 11.5 编辑功能

**后端：`api/services/rag_service.py`**
- `update_point_payload(point_id, new_payload, re_embed)`:
  - `re_embed=False` 时，调用 `set_payload` 仅更新元数据（向量不变）
  - `re_embed=True` 时，根据新内容重新生成 embedding 后 upsert（保证语义检索准确性）

**后端：`api/routers/rag.py`**
- `PUT /api/rag/vectors/{point_id}`: 编辑向量 payload，请求体包含全部可编辑字段 + `re_embed` 标志

**前端：`src/pages/VectorManager.tsx`**
- 详情弹窗增加「编辑」按钮，点击后所有文本字段变为可编辑
- 语义字段（user_question / system_response / summary）标记为 `semantic`，修改后自动启用 re_embed
- 修改语义字段时弹出黄色提示：「保存时将自动重新生成 embedding 向量」
- 「保存」/ 「取消」按钮控制编辑状态
- 评估指标列表保持只读

### 11.6 验证方式

1. 进入「向量库管理」页面 → 下方出现「向量数据浏览器」区域
2. 如已入库 → 显示向量列表，可翻页、筛选
3. 勾选 → 点击「删除」→ 确认后删除 → 统计数自动更新
4. 点击眼睛图标 → 弹出详情弹窗，展示完整 payload
5. 点击「清空向量库」→ 输入"清空"确认 → 集合清空重建 → 统计归零

---

## 十二、后续计划

- **P2**：数据模型重构（vehicles / test_cases 表 + 自动填充）
- **P3**：NAS 批量扫描 → 自动注册车辆/用例
- **前端增强**：NAS 目录扫描预览组件、批量分析进度条

---

## XIV. 500 视频批量分析错误修复

### 14.1 问题描述

一次性分析 500 个 NAS 视频时出现 6 类错误：

| # | 错误信息 | 出现次数 |
|---|---------|---------|
| 1 | `duplicate key value violates unique constraint "evaluation_scores_pkey"` Key (id)=(1027) | 1 |
| 2 | `peer closed connection without sending complete message body` (132MB/138MB) | 1 |
| 3 | `duplicate key value violates unique constraint "evaluation_scores_pkey"` Key (id)=(1026) | 1 |
| 4 | `peer closed connection without sending complete message body` (151MB/261MB) | 1 |
| 5 | `Server error '500 Internal Server Error'` for NAS download URL | 1 |
| 6 | `All connection attempts failed` | 1 |

### 14.2 根因分析

归纳为 **3 个根因**：

**根因 A — PostgreSQL SERIAL 序列失同步（错误 1、3）**
`evaluation_scores` 表使用 `SERIAL PRIMARY KEY`。之前数据迁移或手动操作插入了带显式 id 的记录，但序列计数器未同步，导致自增 id 冲突。

**根因 B — NAS 下载无重试 + 并发压力（错误 2、4、5）**
500 个视频并发下载导致 NAS 服务器过载，连接被主动断开或返回 500。`download_to_temp` 方法无重试机制，且失败后不清理不完整的临时文件（导致后续请求命中损坏缓存）。

**根因 C — 数据库无连接池（错误 6）**
`_get_connection()` 每次调用都新建 `psycopg2.connect()` 连接。500 视频处理过程中频繁建连/断连，耗尽 PostgreSQL `max_connections` 或 OS 资源。

### 14.3 修复方案与代码改动

#### Fix 1：修复序列失同步 + INSERT 排除 id 字段

**文件**：`api/services/local_db_client.py`

改动内容：
1. 在 `_ensure_tables()` 末尾添加序列重置 SQL：
   ```sql
   SELECT setval('evaluation_scores_id_seq',
          COALESCE((SELECT MAX(id) FROM evaluation_scores), 0))
   ```
   每次服务启动时自动将序列同步到当前最大 id，杜绝未来冲突。

2. INSERT 逻辑中新增 `serial_pk_tables = {'evaluation_scores'}`，对该表的 INSERT 自动剥离 `id` 字段，完全依赖 SERIAL 自增：
   ```python
   if self.table_name in serial_pk_tables:
       record = {k: v for k, v in record.items() if k != 'id'}
   ```

#### Fix 2：NAS 下载增加重试、不完整文件清理、大小校验

**文件**：`api/services/nas_service.py`

改动内容：
1. `download_to_temp` 增加 `max_retries=3` 参数，引入 `asyncio` 做指数退避等待（2s, 4s, 8s）
2. 每次下载失败后 **立即删除不完整的临时文件**，防止下次命中损坏缓存
3. 下载完成后 **校验文件大小** 与 `Content-Length` 是否一致，不一致视为失败触发重试
4. 缓存命中逻辑增加 `file_size > 0` 检查，空文件直接删除重新下载
5. 下载超时从 `read=300s` 提升至 `read=600s`，连接超时从 `10s` 提升至 `15s`

#### Fix 3：引入数据库连接池

**文件**：`api/services/local_db_client.py`

改动内容：
1. 新增 `import psycopg2.pool`
2. `__init__` 中创建 `ThreadedConnectionPool(minconn=2, maxconn=10)` 替代每次新建连接
3. `_get_connection()` 改为从连接池获取 (`self._pool.getconn()`)
4. 新增 `_put_connection(conn)` 方法用于归还连接 (`self._pool.putconn(conn)`)
5. 全部 `conn.close()` 替换为 `self._put_connection(conn)` / `self.db._put_connection(conn)`，包括：
   - `raw_sql()` 和 `raw_sql_count()` 的 finally 块
   - `_ensure_tables()` 的 finally 块
   - `Table.execute()` 中 INSERT / COUNT / SELECT / UPDATE / DELETE / Fallback / Exception 7 处

### 14.4 修改文件清单

| 文件 | 改动摘要 |
|------|---------|
| `api/services/local_db_client.py` | 引入 `ThreadedConnectionPool`；添加序列重置；INSERT 排除 id；全部 conn.close → putconn |
| `api/services/nas_service.py` | `download_to_temp` 3次重试 + 指数退避 + 不完整文件清理 + 大小校验 |

### 14.5 验证方式

1. **序列修复验证**：重启后端服务，检查日志输出 `PostgreSQL connection pool created` 和 `PostgreSQL database tables initialized`
2. **连接池验证**：批量分析时观察 PostgreSQL 活跃连接数不超过 10（`SELECT count(*) FROM pg_stat_activity WHERE datname='beeeval'`）
3. **NAS 重试验证**：分析大量 NAS 视频，观察日志中出现 `Retrying in Xs...` 的重试信息，最终下载成功
4. **主键冲突验证**：批量分析不再出现 `duplicate key value violates unique constraint` 错误

---

## XV. 失败视频筛选与重试功能

### 15.1 需求背景

批量分析 500 个视频时，部分视频因 NAS 下载失败、LLM 超时等原因分析失败。即使增加了重试机制，仍可能有少量视频最终失败。用户需要：
1. 在任务详情页（Analysis Results）快速筛选出失败的视频
2. 一键重新分析所有失败视频

### 15.2 后端改动

**文件**：`api/routers/video.py`

1. **`GET /api/video/results/{task_id}` 增加 `status` 筛选参数**
   - 新增可选 query 参数 `status`（取值：`completed` / `failed` / `processing` / `pending`）
   - 通过 `metadata->>'status'` 进行 JSONB 字段过滤
   - 响应新增 `failed_count` 字段，始终返回该任务中失败视频总数

2. **新增 `POST /api/video/retry-failed/{task_id}` 端点**
   - 查询指定任务中所有 `metadata->>'status' = 'failed'` 的 video_results
   - 将这些记录的 metadata 重置为 `pending` 状态
   - 删除这些记录关联的旧 evaluation_scores（避免重复数据）
   - 将任务状态改回 `processing`
   - 自动判断视频来源（NAS / 本地）并以正确的 `source` 参数重新提交到线程池
   - 返回 `{ retried: N, task_id, message }`

### 15.3 前端改动

**文件**：`src/config.ts`
- 新增 `RETRY_FAILED: '/video/retry-failed'` API 端点

**文件**：`src/api.ts`
- `getResults` 参数增加可选 `status?: string`
- 返回类型增加 `failed_count: number`
- 新增 `retryFailedVideos(taskId, asrModel)` 函数

**文件**：`src/pages/Results.tsx`
- 新增 `StatusFilter` 类型和 `STATUS_OPTIONS` 常量（全部 / 已完成 / 失败 / 分析中 / 排队中）
- Header 区域新增状态筛选按钮栏，每个按钮带对应图标和颜色
- "失败" 筛选按钮右侧显示红色计数徽章
- 当存在失败视频时，右侧显示橙色"重新分析失败视频 (N)" 按钮
- 点击重试按钮弹出确认对话框，确认后调用 `retryFailedVideos` API
- 重试后自动切换回"全部"筛选并刷新数据

### 15.4 修改文件清单

| 文件 | 改动摘要 |
|------|---------|
| `api/routers/video.py` | `GET /results/{task_id}` 增加 status 筛选 + failed_count；新增 `POST /retry-failed/{task_id}` |
| `src/config.ts` | 新增 `RETRY_FAILED` 端点 |
| `src/api.ts` | `getResults` 增加 status 参数；新增 `retryFailedVideos` 函数 |
| `src/pages/Results.tsx` | 状态筛选栏 + 重试按钮 UI |

### 15.5 验证方式

1. 打开任意已完成的任务详情页，确认筛选栏显示"全部 / 已完成 / 失败 / 分析中 / 排队中"5 个按钮
2. 如果有失败视频，"失败"按钮旁显示红色数字徽章，右侧显示橙色重试按钮
3. 点击"失败"按钮，表格仅显示失败的视频
4. 点击"重新分析失败视频"按钮，确认后失败视频状态变为 pending → processing，开始重新分析
5. 分析完成后刷新页面，确认之前失败的视频现在有正确的分析结果

---

## XVI. Dr. Bee 独立页面

### 16.1 需求背景

将 RAG 问答功能（项目内称 Dr. Bee）抽取为一个**零依赖的独立 HTML 页面**，后端部署到服务器后，测试人员通过浏览器直接访问 `http://<server>:8004/dr-bee` 即可使用，无需安装前端环境。

### 16.2 实现方案

- 单 HTML 文件 `public/dr-bee.html`，内嵌 CSS + JS，无任何外部依赖
- 通过 FastAPI 路由 `GET /dr-bee` 直接 serve 该页面
- 页面顶部可配置后端地址（自动记忆到 localStorage），支持部署后远程访问

### 16.3 功能清单

| 功能 | 说明 |
|------|------|
| 后端地址配置 | 顶部输入框，实时检测连接状态（绿/黄/红灯） |
| RAG 开关 | 支持开启/关闭向量检索增强，显示向量数量徽章 |
| 聊天对话 | 支持多轮对话、Enter 发送、Shift+Enter 换行 |
| Markdown 渲染 | 标题、加粗、斜体、代码、引用、列表等格式 |
| 参考来源展示 | RAG 模式下展示检索到的案例卡片（Case ID、品牌车型、系统版本、功能域、相似度） |
| 快捷问题建议 | 欢迎页提供 4 个常用问题按钮，点击即填充 |
| 错误处理 | 请求失败时显示红色气泡 + 顶部 Toast 提示 |
| 移动端适配 | 响应式布局，手机浏览器可用 |

### 16.4 改动文件清单

| 文件 | 改动摘要 |
|------|---------|
| `public/dr-bee.html` | **新建**：Dr. Bee 独立聊天页面（单文件，零依赖） |
| `api/main.py` | 新增 `GET /dr-bee` 路由，serve HTML 页面；新增 `FileResponse` import |

### 16.5 访问方式

- 本地开发：`http://localhost:8004/dr-bee`
- 服务器部署后：`http://<服务器IP>:8004/dr-bee`
- 页面首次打开会自动检测后端连接，顶部显示绿灯表示就绪
