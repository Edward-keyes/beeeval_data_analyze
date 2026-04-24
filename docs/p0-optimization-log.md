# P0 优化工作日志：分页 + 消除 N+1 查询

> 日期：2026-04-09
> 优先级：P0（所有后续功能的基础）
> 状态：已完成

---

## 一、优化目标

1. `local_db_client.py` 链式 API 能力不足，缺少分页、计数、模糊搜索等基础操作
2. `GET /api/video/all-results` 一次返回全部数据，10 万+ 条时浏览器崩溃
3. `GET /api/video/tasks` 同样无分页
4. `get_all_results` 和 `get_results` 存在经典 N+1 查询问题（每条 video_result 单独查 evaluation_scores）

---

## 二、改动文件清单

### 2.1 `api/services/local_db_client.py`

**改动类型**：重构

**新增链式方法：**

| 方法 | 签名 | 用途 |
|------|------|------|
| `limit(n)` | `.limit(20)` | 限制返回行数 |
| `offset(n)` | `.offset(40)` | 跳过前 N 行（配合 limit 实现分页） |
| `count()` | `.count().execute()` → `.count` | 只返回总数，不返回数据 |
| `neq(col, val)` | `.neq("status", "deleted")` | 不等于筛选 |
| `like(col, pattern)` | `.like("video_name", "%空调%")` | 模糊搜索（ILIKE，不区分大小写） |
| `gte(col, val)` | `.gte("score", 3.0)` | 大于等于 |
| `lte(col, val)` | `.lte("score", 5.0)` | 小于等于 |
| `is_(col, val)` | `.is_("deleted_at", None)` | IS NULL 检查 |

**新增实例方法：**

| 方法 | 用途 |
|------|------|
| `raw_sql(sql, params)` | 执行原生 SQL，返回 `_Result` 对象（用于 JOIN 等复杂查询） |
| `raw_sql_count(sql, params)` | 执行 COUNT SQL，直接返回 `int` |

**内部重构：**

- WHERE 条件从单一 `_where_clause` + `_in_clause` 合并为统一的 `_where_parts: List[str]` 列表
- `_build_where()` 方法统一拼接所有 WHERE 条件
- DELETE 操作改用 `_is_delete` 标记，不再依赖 `_where_clause` 的隐式判断
- 返回对象从 `type('obj', ...)` 改为 `_Result` 类（带 `data` 和 `count` 属性）
- `insert` 自动生成 ID 支持新增的 `vehicles` 和 `test_cases` 表

**代码对比（WHERE 构建）：**

```python
# 改动前：只支持单个 eq + 单个 in_
self._where_clause: Optional[str] = None    # 只能放一个条件
self._in_clause: Optional[tuple] = None     # 单独处理

# 改动后：支持任意数量条件组合
self._where_parts: List[str] = []           # 多条件列表
# eq/neq/like/gte/lte/is_/in_ 全部 append 到列表中
# _build_where() 用 AND 连接
```

---

### 2.2 `api/routers/video.py`

**改动类型**：功能增强

#### `GET /api/video/all-results` — 服务端分页 + JOIN + 筛选

**改动前：**
```python
# 一次返回全部 + N+1 查询
res = supabase.table("video_results").select("*").order(...).execute()
for result in res.data:
    scores_res = supabase.table("evaluation_scores").select("*").eq("result_id", ...).execute()
return results_with_scores  # 平铺列表
```

**改动后：**
```python
# 服务端分页 + LEFT JOIN 一次性获取
GET /api/video/all-results?offset=0&limit=20&sort_by=created_at&sort_order=desc
    &function_domain=车控域&search=空调&brand_model=理想i8

# 返回格式
{
  "data": [...],      // 当前页数据（含 evaluation_scores 数组）
  "total": 1200,      // 总记录数
  "offset": 0,
  "limit": 20
}
```

**新增查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `offset` | int | 偏移量，默认 0 |
| `limit` | int | 每页条数，默认 20 |
| `sort_by` | string | 排序字段（created_at/video_name/case_id/brand_model/function_domain/system_version） |
| `sort_order` | string | asc / desc |
| `vehicle_id` | string | 按车辆 ID 筛选 |
| `function_domain` | string | 按功能域筛选 |
| `brand_model` | string | 按品牌车型筛选 |
| `system_version` | string | 按系统版本筛选 |
| `status` | string | 按分析状态筛选（completed / failed） |
| `search` | string | 模糊搜索 video_name 和 transcript |

**核心 SQL（消除 N+1）：**

```sql
SELECT vr.*,
       COALESCE(
           json_agg(
               json_build_object(
                   'id', es.id, 'result_id', es.result_id,
                   'criteria', es.criteria, 'score', es.score,
                   'feedback', es.feedback, 'details', es.details,
                   'metric_code', es.metric_code, 'category', es.category,
                   'selection_reason', es.selection_reason
               )
           ) FILTER (WHERE es.id IS NOT NULL),
           '[]'::json
       ) AS evaluation_scores
FROM video_results vr
LEFT JOIN evaluation_scores es ON es.result_id = vr.id
WHERE ...
GROUP BY vr.id
ORDER BY vr.created_at DESC
LIMIT 20 OFFSET 0
```

#### `GET /api/video/tasks` — 服务端分页

**改动前：** 返回全部任务平铺列表
**改动后：** 分页响应 `{ data, total, offset, limit }`

#### `GET /api/video/results/{task_id}` — JOIN 消除 N+1

**改动前：** 先查 video_results，再逐条查 evaluation_scores
**改动后：** 一条 LEFT JOIN SQL 完成，评分数据聚合为 JSON 数组

---

## 三、性能对比

| 场景 | 改动前 | 改动后 |
|------|--------|--------|
| 292 条结果 + 1200 评分 | 1 + 292 = **293 次查询** | **2 次查询**（1 次 COUNT + 1 次 JOIN） |
| 10 万条结果 | 全量加载 ~500MB JSON | 每页 20 条 ~50KB |
| 带筛选 | 前端 `filter()` | PostgreSQL WHERE 索引查询 |

---

## 四、向后兼容说明

### 前端需适配的变更

`GET /api/video/all-results` 返回格式从**平铺数组**变为**分页对象**：

```typescript
// 改动前
const results: VideoResult[] = await getAllResults();

// 改动后
const { data, total, offset, limit } = await getAllResults({ offset: 0, limit: 20 });
```

`GET /api/video/tasks` 同理：

```typescript
// 改动前
const tasks: AnalysisTask[] = await getTasks();

// 改动后
const { data, total } = await getTasks({ offset: 0, limit: 20 });
```

> 注意：前端在适配分页之前，可以临时传 `?limit=10000` 来兼容旧行为。

---

## 五、前端适配改动（2026-04-09）

### 5.1 `src/api.ts`

**改动类型**：接口签名重构

新增分页响应类型 + 改造两个核心函数签名：

```typescript
export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    offset: number;
    limit: number;
}

// getTasks：新增可选 offset/limit 参数，返回 PaginatedResponse
export const getTasks = async (params?: {
    offset?: number; limit?: number;
}): Promise<PaginatedResponse<AnalysisTask>> => { ... };

// getAllResults：新增分页、排序、筛选参数，返回 PaginatedResponse
export const getAllResults = async (params?: {
    offset?: number; limit?: number;
    sort_by?: string; sort_order?: 'asc' | 'desc';
    brand_model?: string; system_version?: string;
    function_domain?: string; search?: string;
    ...
}): Promise<PaginatedResponse<any>> => { ... };
```

---

### 5.2 `src/pages/Database.tsx`

**改动类型**：服务端分页 + 分页控件

| 改动点 | 说明 |
|--------|------|
| 新增状态 | `total`, `currentPage`, `searchDebounced`, `PAGE_SIZE=20` |
| `fetchData()` | 改为 `useCallback`，组装 `offset/limit/sort_by/sort_order/search/brand_model/system_version/function_domain` 参数调用 `getAllResults(params)` |
| 搜索防抖 | `search` 输入后 400ms 触发 `searchDebounced` → 自动重新请求 |
| 前端过滤简化 | 仅保留 `case_id`（视频名前缀）和 `score_min/score_max` 在前端过滤，其余由服务端 WHERE 处理 |
| 排序/筛选/搜索切页 | 变更时自动 `setCurrentPage(1)` 回到首页 |
| 底部分页栏 | 新增 `ChevronLeft/ChevronRight` 翻页按钮 + 页码按钮（最多显示 5 页，自动窗口滑动） |

**底部分页栏效果**：`Showing 20 of 1200 records (Page 1/60)  [< 1 2 3 4 5 >]`

---

### 5.3 `src/pages/History.tsx`

**改动类型**：服务端分页 + 分页控件

| 改动点 | 说明 |
|--------|------|
| 新增状态 | `total`, `currentPage`, `PAGE_SIZE=20` |
| `fetchTasks()` | 改为 `useCallback`，传递 `offset/limit` |
| 批量删除后 | 改为 `await fetchTasks()` 重新拉取服务端数据 |
| 底部分页栏 | 与 Database 页面一致的分页控件 |

---

### 5.4 其他页面兼容适配

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/pages/TestCases.tsx` | `getAllResults()` → `getAllResults({ limit: 1000 })` + 取 `res.data` | 测试用例库需要全量数据做前端级联筛选 |
| `src/components/AskBeeEval.tsx` | `getAllResults()` → `getAllResults({ limit: 5000 })` + 取 `res.data` | 构建 video_name → path 映射表 |
| `src/pages/VectorManager.tsx` | `getTasks()` → `getTasks({ limit: 1000 })` + 取 `res.data` | 向量管理需要全量任务列表 |

---

## 六、验证方式

### 6.1 Database 页面验证
1. 打开 Database 页面 → 应只加载 20 条数据（看底部状态栏）
2. 点击底部翻页按钮 → 数据刷新
3. 搜索框输入关键词 → 自动防抖后刷新（400ms 延迟）
4. 展开 Filters → 输入 Brand/Model 或 Function Domain → 服务端筛选
5. 打开浏览器 DevTools → Network → 确认每次请求带有 `offset`/`limit` 参数

### 6.2 History 页面验证
1. 打开 History 页面 → 底部显示分页信息
2. 翻页 → 数据刷新
3. 批量删除 → 自动重新拉取当前页

### 6.3 其他页面
1. TestCases → 正常显示用例卡片
2. AskBeeEval → 聊天功能正常，视频链接可点击
3. VectorManager → 任务列表正常加载

### 6.4 API 直接验证
```bash
# 分页
curl "http://localhost:8004/api/video/all-results?offset=0&limit=5"

# 搜索
curl "http://localhost:8004/api/video/all-results?search=空调&limit=5"

# 筛选
curl "http://localhost:8004/api/video/all-results?function_domain=车控域&limit=5"

# 任务分页
curl "http://localhost:8004/api/video/tasks?offset=0&limit=5"
```

---

## 七、后续计划

- P1：NAS 服务层对接
- P2：批量扫描 + 自动注册车辆/用例
- P3：Zustand 全局状态管理替代 useState
