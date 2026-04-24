# BeeEVAL 后端架构优化清单

> 目标：支撑上百台车 x 1000+ 用例（10 万+ 视频）的大规模评测场景，对接 NAS 视频源。

---

## 一、数据模型重构

### 1.1 当前问题

- 没有「车辆」和「用例」的独立实体，用例维度全靠视频文件名解析
- 一个用例可能包含多个问题（上下文记忆场景），当前模型无法结构化表达
- 三级标签体系无处存储，只能在 `function_domain` 一个字段里塞

### 1.2 新增表设计

```sql
-- 车辆表：每台被测车辆
CREATE TABLE vehicles (
    id TEXT PRIMARY KEY,
    brand TEXT NOT NULL,              -- 品牌（理想、蔚来、小鹏...）
    model TEXT NOT NULL,              -- 型号（i8、ET7、P7...）
    system_version TEXT,              -- 系统版本（v8.0.1）
    description TEXT,                 -- 备注
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用例表：每条测试用例
CREATE TABLE test_cases (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,            -- 用例编号（如 1002）
    vehicle_id TEXT REFERENCES vehicles(id),
    
    -- 三级标签
    tag_level1 TEXT,                  -- 一级标签（功能域：车控域、导航域、娱乐域...）
    tag_level2 TEXT,                  -- 二级标签（子场景：空调控制、车窗控制...）
    tag_level3 TEXT,                  -- 三级标签（细分：上下文记忆、多轮对话...）
    
    -- 用例内容
    question_count INTEGER DEFAULT 1, -- 问题数量（>1 表示多问题/上下文记忆用例）
    is_context_memory BOOLEAN DEFAULT FALSE,  -- 是否上下文记忆类用例
    questions JSONB,                  -- 问题列表 [{"index":1,"text":"打开空调"},{"index":2,"text":"调到26度"}]
    expected_behavior TEXT,           -- 预期行为描述
    
    -- 视频关联
    video_name TEXT,                  -- 视频文件名
    video_nas_path TEXT,              -- NAS 上的完整路径
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_test_cases_vehicle ON test_cases(vehicle_id);
CREATE INDEX idx_test_cases_tags ON test_cases(tag_level1, tag_level2, tag_level3);
CREATE INDEX idx_test_cases_case_id ON test_cases(case_id);
```

### 1.3 现有表调整

```sql
-- video_results 新增外键
ALTER TABLE video_results ADD COLUMN vehicle_id TEXT REFERENCES vehicles(id);
ALTER TABLE video_results ADD COLUMN test_case_id TEXT REFERENCES test_cases(id);
ALTER TABLE video_results ADD COLUMN video_source TEXT DEFAULT 'local';  -- 'local' | 'nas'
ALTER TABLE video_results ADD COLUMN video_nas_path TEXT;                -- NAS 路径

CREATE INDEX idx_video_results_vehicle ON video_results(vehicle_id);
CREATE INDEX idx_video_results_test_case ON video_results(test_case_id);
```

### 1.4 实体关系

```
vehicles (1) ──< test_cases (N)
test_cases (1) ──< video_results (N)    -- 同一用例可在不同版本/批次中重复测试
video_results (1) ──< evaluation_scores (N)

analysis_tasks 保持不变，作为「一次批量分析操作」的记录
```

### 1.5 从视频名自动填充

当前 `video_name_parser` 已能从文件名解析出 `case_id`、`brand_model`、`system_version`、`function_domain`。优化为：

1. 解析视频名 → 查 `vehicles` 表是否已存在该 `brand + model + system_version` → 不存在则自动创建
2. 查 `test_cases` 表是否已存在该 `case_id + vehicle_id` → 不存在则自动创建（`tag_level1` 从 `function_domain` 映射）
3. 视频分析完成后，LLM 返回的 `cases` 数组长度 > 1 → 自动标记 `is_context_memory = true`，回填 `questions` 字段

---

## 二、NAS 服务层

### 2.1 新增 `api/services/nas_service.py`

封装 NAS File API Server 的所有接口：

```python
class NASService:
    """
    封装 NAS HTTP API（browse/download/stream/search/info）。
    NAS_URL 和 NAS_TOKEN 从 config 读取。
    """
    
    def __init__(self):
        self.base_url = settings.NAS_URL      # e.g. http://nas-ip:8900
        self.token = settings.NAS_TOKEN
    
    async def browse(self, path: str = "", type_filter: str = "video",
                     sort: str = "name", order: str = "asc", 
                     offset: int = 0) -> dict:
        """浏览 NAS 目录，支持 type=video 过滤"""
    
    async def download_to_temp(self, nas_path: str) -> str:
        """下载视频到本地临时目录，返回本地路径（供 ASR 分析用）"""
    
    def get_stream_url(self, nas_path: str) -> str:
        """生成前端可直接用的 NAS 流播放 URL"""
    
    async def search(self, path: str, keyword: str, 
                     depth: int = 5, limit: int = 100) -> list:
        """搜索 NAS 文件"""
    
    async def info(self, path: str) -> dict:
        """获取文件/目录信息"""
    
    async def cleanup_temp(self, local_path: str):
        """分析完成后清理临时文件"""
```

### 2.2 配置新增（`config.py` + `.env`）

```python
# config.py
NAS_URL: str = os.getenv("NAS_URL", "")
NAS_TOKEN: str = os.getenv("NAS_TOKEN", "")
NAS_VIDEO_ROOT: str = os.getenv("NAS_VIDEO_ROOT", "/volume1")  # NAS 视频根目录
```

```env
# .env
NAS_URL=http://192.168.x.x:8900
NAS_TOKEN=your_nas_token
NAS_VIDEO_ROOT=/volume1/evaluation-videos
```

### 2.3 新增路由 `api/routers/nas.py`

```python
# 前端通过后端代理访问 NAS，避免暴露 NAS Token
router = APIRouter(prefix="/api/nas", tags=["nas"])

GET  /api/nas/browse?path=&type=video      # 浏览 NAS 目录
GET  /api/nas/search?path=&keyword=         # 搜索视频
GET  /api/nas/stream?path=                  # 代理视频流（转发 NAS stream）
POST /api/nas/scan                          # 扫描目录，批量注册车辆+用例
```

### 2.4 视频流代理

```python
@router.get("/stream")
async def proxy_nas_stream(path: str, request: Request):
    """
    代理 NAS 视频流到前端。
    - 转发 Range 请求头（支持拖拽进度条）
    - 前端无需知道 NAS Token
    """
    nas_stream_url = nas_service.get_stream_url(path)
    headers = {}
    if "range" in request.headers:
        headers["Range"] = request.headers["range"]
    
    async with httpx.AsyncClient() as client:
        nas_response = await client.get(nas_stream_url, headers=headers)
        return StreamingResponse(
            nas_response.aiter_bytes(),
            status_code=nas_response.status_code,
            headers=dict(nas_response.headers)
        )
```

---

## 三、视频分析流水线改造

### 3.1 双源视频处理

```python
async def process_video(task_id, video_result_id, video_path, video_name, config, asr_model, source="local"):
    """
    source = "local": 直接用本地路径（当前逻辑）
    source = "nas":   先 download_to_temp → 分析 → cleanup_temp
    """
    actual_path = video_path
    if source == "nas":
        actual_path = await nas_service.download_to_temp(video_path)
    
    try:
        # ... 现有分析逻辑（extract_audio → ASR → screenshot → LLM）...
    finally:
        if source == "nas":
            await nas_service.cleanup_temp(actual_path)
```

### 3.2 批量扫描与自动注册

新增端点 `POST /api/nas/scan`：

```
请求：{ "nas_path": "/volume1/evaluation-videos/理想i8-v8.0.1" }

流程：
1. 调用 NAS browse API 列出所有视频
2. 对每个视频名调用 video_name_parser 解析
3. 自动创建/更新 vehicles 记录
4. 自动创建/更新 test_cases 记录（video_nas_path 存 NAS 路径）
5. 返回：新增车辆数、新增用例数、跳过（已存在）数
```

### 3.3 LLM 结果回填用例信息

在 `process_video` 完成后新增回填步骤：

```python
# LLM 返回 cases 数组后
if len(cases) > 1:
    # 更新 test_cases 表
    supabase.table("test_cases").update({
        "is_context_memory": True,
        "question_count": len(cases),
        "questions": [{"index": i+1, "text": c.get("user_question","")} for i, c in enumerate(cases)]
    }).eq("id", test_case_id).execute()
```

---

## 四、查询性能优化

### 4.1 服务端分页

所有列表接口统一分页参数：

```python
class PaginationParams(BaseModel):
    offset: int = 0
    limit: int = 20
    sort_by: str = "created_at"
    sort_order: str = "desc"      # "asc" | "desc"
```

改造关键接口：

| 接口 | 当前问题 | 优化方案 |
|------|----------|----------|
| `GET /api/video/all-results` | 一次返回全部 + N+1 查询 | 分页 + JOIN |
| `GET /api/video/tasks` | 一次返回全部 | 分页 |
| `GET /api/video/results/{task_id}` | N+1 查 evaluation_scores | JOIN 或子查询 |

### 4.2 消除 N+1 查询

当前代码（`video.py` 的 `get_all_results`）：

```python
# 当前：每条 result 单独查一次 scores（N+1 问题）
for result in res.data:
    scores_res = supabase.table("evaluation_scores").select("*").eq("result_id", result['id']).execute()
```

优化方向：在 `local_db_client.py` 的链式 API 中新增 `join()` 支持，或改为原生 SQL：

```sql
SELECT vr.*, 
       json_agg(es.*) FILTER (WHERE es.id IS NOT NULL) AS evaluation_scores
FROM video_results vr
LEFT JOIN evaluation_scores es ON es.result_id = vr.id
WHERE vr.task_id = %s
GROUP BY vr.id
ORDER BY vr.created_at DESC
LIMIT %s OFFSET %s
```

### 4.3 新增 `local_db_client` 能力

当前链式 API 缺少的操作，按优先级补充：

| 方法 | 用途 | 优先级 |
|------|------|--------|
| `.limit(n)` | 分页 | P0 |
| `.offset(n)` | 分页 | P0 |
| `.count()` | 总数统计（分页必需） | P0 |
| `.raw_sql(sql, params)` | 复杂 JOIN 查询 | P0 |
| `.neq(col, val)` | 不等于筛选 | P1 |
| `.like(col, pattern)` | 模糊搜索 | P1 |
| `.gte(col, val)` / `.lte(col, val)` | 范围筛选（分数、日期） | P1 |
| `.is_(col, val)` | NULL 检查 | P2 |

### 4.4 筛选与搜索接口

新增通用筛选参数：

```python
class VideoResultFilter(BaseModel):
    vehicle_id: Optional[str] = None
    brand_model: Optional[str] = None
    system_version: Optional[str] = None
    function_domain: Optional[str] = None
    tag_level1: Optional[str] = None
    tag_level2: Optional[str] = None
    tag_level3: Optional[str] = None
    is_context_memory: Optional[bool] = None
    status: Optional[str] = None          # completed / failed
    search: Optional[str] = None          # 模糊搜索 video_name / transcript
    score_min: Optional[float] = None     # 分数范围
    score_max: Optional[float] = None
```

---

## 五、并发与性能

### 5.1 ASR 模型单例

当前问题：`process_video` 中每次 `VideoService(asr_model=selected_asr)` 都新建实例，可能重复加载模型到内存。

```python
# 优化：模型管理器维护单例
class ASRModelManager:
    _instances = {}
    _lock = threading.Lock()
    
    @classmethod
    def get(cls, model_type: ASRModel) -> VideoService:
        with cls._lock:
            if model_type not in cls._instances:
                cls._instances[model_type] = VideoService(asr_model=model_type)
            return cls._instances[model_type]
```

### 5.2 可配置线程池

```python
# config.py
MAX_WORKERS: int = int(os.getenv("MAX_WORKERS", "3"))

# .env
MAX_WORKERS=5  # 根据机器配置调整
```

### 5.3 长远：任务队列

当数据量进一步增长（持续批量分析），可引入 Celery + Redis：

```
优先级：低（当前 ThreadPoolExecutor 足够应对单次批量分析）
时机：当需要多机分布式处理、任务调度、失败重试时引入
```

---

## 六、数据统计接口

### 6.1 新增统计端点

```python
router = APIRouter(prefix="/api/stats", tags=["stats"])

GET /api/stats/overview
# 返回：总车辆数、总用例数、总视频数、已分析数、平均分

GET /api/stats/by-vehicle?vehicle_id=xxx
# 返回：该车的用例分布（按域/标签）、评分分布、通过率

GET /api/stats/by-domain
# 返回：各功能域的平均分、用例数、问题分布

GET /api/stats/compare?vehicle_ids=id1,id2
# 返回：多车对比数据（同一用例在不同车上的评分对比）

GET /api/stats/score-distribution
# 返回：分数段分布直方图数据
```

### 6.2 聚合查询示例

```sql
-- 按车辆 + 功能域统计平均分
SELECT v.brand, v.model, v.system_version,
       tc.tag_level1 AS domain,
       COUNT(DISTINCT vr.id) AS video_count,
       ROUND(AVG(es.score), 2) AS avg_score
FROM vehicles v
JOIN test_cases tc ON tc.vehicle_id = v.id
JOIN video_results vr ON vr.test_case_id = tc.id
JOIN evaluation_scores es ON es.result_id = vr.id
WHERE vr.metadata->>'status' = 'completed'
GROUP BY v.brand, v.model, v.system_version, tc.tag_level1
ORDER BY avg_score DESC;
```

---

## 七、文件结构变更

```
api/
├── core/
│   ├── config.py              # + NAS_URL, NAS_TOKEN, MAX_WORKERS
│   └── video_name_parser.py   # 不变
├── routers/
│   ├── video.py               # 改：分页、双源处理、回填用例
│   ├── nas.py                 # 新：NAS 浏览/搜索/流代理/批量扫描
│   ├── stats.py               # 新：统计接口
│   ├── vehicles.py            # 新：车辆 CRUD
│   ├── test_cases.py          # 新：用例 CRUD + 标签管理
│   ├── chat.py                # 不变
│   ├── rag.py                 # 不变
│   └── system.py              # 不变
├── services/
│   ├── nas_service.py         # 新：NAS API 封装
│   ├── local_db_client.py     # 改：新增 limit/offset/count/raw_sql/like 等
│   ├── video_service.py       # 改：ASR 单例管理
│   └── ...                    # 其他不变
└── main.py                    # 改：注册新路由
```

---

## 八、实施优先级

| 阶段 | 内容 | 预计工作量 |
|------|------|-----------|
| **P0 - 基础能力** | local_db_client 补充 limit/offset/count/raw_sql；服务端分页改造 all-results/tasks；消除 N+1 | 1-2 天 |
| **P1 - NAS 对接** | nas_service + nas router + 视频流代理 + 双源 process_video | 1-2 天 |
| **P2 - 数据模型** | vehicles/test_cases 建表 + 自动填充 + video_results 关联 | 1-2 天 |
| **P3 - 批量扫描** | NAS 目录扫描 → 自动注册车辆/用例 + LLM 结果回填 | 1 天 |
| **P4 - 统计接口** | stats router + 聚合查询 | 1 天 |
| **P5 - 性能** | ASR 单例、可配线程池、临时文件清理 | 0.5 天 |

---

## 九、配置清单汇总

### `.env` 新增项

```env
# NAS
NAS_URL=http://192.168.x.x:8900
NAS_TOKEN=your_nas_token
NAS_VIDEO_ROOT=/volume1/evaluation-videos

# Performance
MAX_WORKERS=3
```

### `requirements.txt` 确认项

```
# 已有，无需新增（httpx 用于 NAS 代理请求）
httpx
psycopg2-binary>=2.9.9
```
