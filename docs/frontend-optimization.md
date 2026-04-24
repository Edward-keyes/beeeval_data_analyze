# BeeEVAL 前端架构优化清单

> 目标：支撑 10 万+ 级别视频结果的浏览、筛选与分析，对接 NAS 视频源，提供车辆/用例维度的层级导航。

---

## 一、当前架构问题诊断

| 问题 | 现状 | 影响 |
|------|------|------|
| 全量加载 | `getAllResults()` 一次拉全部数据，前端 `filter/sort` | 10 万条数据浏览器直接崩溃 |
| 无全局状态 | 各页面 `useState` 孤岛，无 store | 跨页面数据不共享，重复请求 |
| 视频源单一 | 只支持本地路径 `FileResponse` | 无法播放 NAS 视频 |
| 无车辆维度 | 数据扁平展示，无按车筛选 | 上百台车混在一起，无法对比 |
| 无用例结构 | 用例信息散落在 `video_name` 解析中 | 无法按标签体系筛选、无法看多问题展开 |
| 分页缺失 | Database/TestCases/History 无服务端分页 | 数据量大时白屏或极慢 |
| 端口不一致 | `config.ts` 中 `SERVER_URL` 写死 8000，实际后端 8004 | 视频流/截图 URL 可能 404 |

---

## 二、全局状态管理

### 2.1 引入 Zustand

当前无全局 store，跨页面数据（如当前选中的车辆、筛选条件）无法共享。

```
src/stores/
├── useVehicleStore.ts    -- 车辆列表、当前选中车辆
├── useTestCaseStore.ts   -- 用例列表、标签筛选条件
├── useResultStore.ts     -- 分析结果、分页状态
├── useNASStore.ts        -- NAS 浏览状态、当前路径
└── useAppStore.ts        -- 全局：语言、侧边栏折叠等
```

### 2.2 核心 Store 示例

```typescript
// useVehicleStore.ts
interface VehicleStore {
  vehicles: Vehicle[];
  currentVehicle: Vehicle | null;
  loading: boolean;
  fetchVehicles: () => Promise<void>;
  selectVehicle: (v: Vehicle) => void;
}

// useResultStore.ts
interface ResultStore {
  results: VideoResult[];
  total: number;
  page: number;
  pageSize: number;
  filters: ResultFilter;
  loading: boolean;
  fetchResults: () => Promise<void>;
  setPage: (page: number) => void;
  setFilters: (filters: Partial<ResultFilter>) => void;
}
```

### 2.3 React Query 配合

保留 `@tanstack/react-query` 做数据缓存和请求去重，Zustand 管理 UI 状态（选中项、筛选条件、分页）：

```
React Query: 服务端数据缓存（GET 请求、分页数据、统计数据）
Zustand:     UI 状态（当前选中车辆、筛选条件、侧边栏状态）
```

---

## 三、服务端分页改造

### 3.1 统一分页组件

```typescript
// src/components/Pagination.tsx
interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  pageSizeOptions?: number[];    // [20, 50, 100]
  onChange: (page: number, pageSize: number) => void;
}
```

### 3.2 各页面改造清单

| 页面 | 当前方式 | 改造为 |
|------|----------|--------|
| Database | `getAllResults()` + 前端 filter/sort | `GET /api/video/all-results?offset=&limit=&sort_by=&filters=` |
| TestCases | `getAllResults()` + 前端派生 | `GET /api/test-cases?offset=&limit=&tag_level1=&...` |
| History | `getTasks()` 全量 | `GET /api/video/tasks?offset=&limit=` |
| Results | 单任务结果（量可控） | 保持不变，但 JOIN 消除 N+1 |
| VectorManager | 前端 slice 分页 | 数据量不大，保持前端分页即可 |

### 3.3 API 层改造

```typescript
// src/api.ts 新增分页参数
interface PaginatedResponse<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
}

export const getAllResults = async (params: {
  offset?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  vehicle_id?: string;
  function_domain?: string;
  search?: string;
}): Promise<PaginatedResponse<VideoResult>> => {
  const response = await api.get(API_ENDPOINTS.GET_ALL_RESULTS, { params });
  return response.data;
};
```

### 3.4 虚拟滚动（可选增强）

当单页显示 100+ 条时，引入 `@tanstack/react-virtual` 做虚拟滚动，只渲染可视区域的 DOM：

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';
// 适用于 Database 表格和 TestCases 卡片列表
```

---

## 四、NAS 视频浏览器

### 4.1 替换本地文件夹选择器

当前 Home 页通过 `POST /api/system/list-dirs` 浏览本地目录。新增 NAS 浏览模式：

```typescript
// src/components/NASBrowser.tsx
// 树形目录浏览器，调用 /api/nas/browse 接口
// 支持：
//   - 目录导航（面包屑 + 文件夹列表）
//   - 视频类型过滤（type=video）
//   - 搜索（调用 /api/nas/search）
//   - 选中视频后显示缩略信息（文件大小、修改时间）
```

### 4.2 Home 页改造

```
当前流程：选本地文件夹 → 列出视频 → 开始分析
新增流程：选 NAS 目录  → 列出视频 → 开始分析（后端自动下载→分析→清理）

UI：Tab 切换「本地文件」和「NAS 视频」两种模式
```

### 4.3 视频源切换

```typescript
// 视频播放 URL 生成
export const getVideoUrl = (result: VideoResult): string => {
  if (result.video_source === 'nas' && result.video_nas_path) {
    // 通过后端代理播放 NAS 视频（避免暴露 Token）
    return `${BASE_URL}/nas/stream?path=${encodeURIComponent(result.video_nas_path)}`;
  }
  // 本地视频（兼容现有逻辑）
  return getVideoStreamUrl(result.metadata?.path || '');
};
```

---

## 五、车辆维度

### 5.1 新增车辆管理页

```
路由：/vehicles
功能：
  - 车辆列表（卡片或表格）：品牌、型号、版本、用例总数、已分析数、平均分
  - 点击车辆 → 进入该车的用例列表 /vehicles/:id/cases
  - 车辆对比入口（选 2-3 台车 → 跳转对比页）
```

### 5.2 层级导航

```
/vehicles                          -- 车辆列表
/vehicles/:id                      -- 单车概览（统计卡片 + 用例概况）
/vehicles/:id/cases                -- 该车的用例列表（三级标签筛选）
/vehicles/:id/cases/:caseId        -- 单个用例详情（视频 + 评分 + 多问题展开）
```

### 5.3 侧边栏扩展

```
现有：
  Home / Results / History / Database / Test Cases / Vector Manager / Settings

优化为：
  Dashboard（新）        -- 总览统计
  ──────────
  Analysis              -- 原 Home（发起分析）
  Vehicles（新）        -- 车辆管理 + 用例浏览
  Results               -- 按任务查看结果
  Database              -- 全量数据表
  ──────────
  Vector Manager        -- RAG 管理
  History               -- 任务历史
  Settings              -- 设置
```

---

## 六、用例视图

### 6.1 三级标签筛选

```typescript
// 级联选择器
// 一级标签（功能域）→ 二级标签 → 三级标签
// 数据从后端 GET /api/test-cases/tags 获取所有已有标签的去重列表

interface TagFilter {
  level1: string[];    // 可多选
  level2: string[];
  level3: string[];
}
```

### 6.2 多问题用例展示

```
单问题用例：
┌──────────────────────────────────┐
│ Case #1002  |  车控域 > 空调控制   │
│ Q: "打开空调"                     │
│ A: "好的，已为您打开空调"          │
│ Score: 4.2/5  ████████░░          │
│ [▶ 播放视频]                      │
└──────────────────────────────────┘

多问题（上下文记忆）用例：
┌──────────────────────────────────┐
│ Case #1050  |  车控域 > 上下文记忆  │  🔗 上下文记忆
│                                    │
│ Round 1:                           │
│   Q: "打开空调"                    │
│   A: "好的，已为您打开空调"        │
│   Score: 4.5/5                     │
│                                    │
│ Round 2:                           │
│   Q: "调到26度"                    │
│   A: "好的，已将空调调至26度"      │
│   Score: 4.0/5                     │
│                                    │
│ Overall: 4.25/5  ████████░░        │
│ [▶ 播放视频]（单个视频包含全部轮次）│
└──────────────────────────────────┘
```

### 6.3 上下文记忆标记

在所有列表/表格中，对 `is_context_memory = true` 的用例显示特殊标记：

```typescript
{result.is_context_memory && (
  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs 
                    bg-purple-100 text-purple-700">
    上下文记忆
  </span>
)}
```

---

## 七、统计仪表盘

### 7.1 新增 Dashboard 页

```
路由：/dashboard（或 / 作为新首页）

布局：
┌──────────────────────────────────────────────┐
│  统计卡片行                                    │
│  [总车辆: 128] [总用例: 130K] [已分析: 89K]   │
│  [平均分: 3.8] [通过率: 72%]                   │
├──────────────────┬───────────────────────────┤
│ 按功能域评分      │  分数分布直方图              │
│ (柱状图)         │  (0-1, 1-2, 2-3, 3-4, 4-5) │
├──────────────────┼───────────────────────────┤
│ 按车型评分排名    │  近期分析趋势               │
│ (横向柱状图)     │  (折线图)                   │
├──────────────────┴───────────────────────────┤
│ 最近分析任务（快捷入口）                       │
└──────────────────────────────────────────────┘
```

### 7.2 图表库选择

推荐 `recharts`（React 生态最成熟）或 `@nivo/core`（声明式、美观）：

```
npm install recharts
# 已有 tailwind，搭配 recharts 即可覆盖所有图表需求
```

---

## 八、视频播放器增强

### 8.1 统一播放器组件

```typescript
// src/components/VideoPlayer.tsx
interface VideoPlayerProps {
  source: 'local' | 'nas';
  path: string;                // 本地路径或 NAS 路径
  nasPath?: string;            // NAS 完整路径
  transcript?: TranscriptSegment[];  // 时间戳字幕
  screenshots?: string[];      // 关键帧截图
  onTimeUpdate?: (time: number) => void;
}

// 功能：
// - 自动判断源，生成正确的播放 URL
// - 支持 HTTP Range（NAS stream 已支持）
// - 可选：字幕轨同步显示（基于 ASR 的 segments 时间戳）
// - 可选：关键帧缩略图时间轴
```

### 8.2 字幕同步

ASR 返回的 `segments` 包含时间戳，可在播放时高亮当前说话内容：

```typescript
// segments: [{text: "打开空调", start: 1.2, end: 2.5}, ...]
// 播放到 1.5s 时高亮 "打开空调"
```

---

## 九、config.ts 修复与扩展

### 9.1 修复端口不一致

当前 `SERVER_URL = 'http://localhost:8000'` 但后端实际运行在 8004：

```typescript
// 修复：统一通过 Vite 代理，不直连后端
// 所有请求走 /api 前缀，由 vite proxy 转发到 8004
export const SERVER_URL = '';  // 开发环境走代理，不需要绝对 URL

// 或者改为正确端口
export const SERVER_URL = 'http://localhost:8004';
```

### 9.2 新增 NAS 相关端点

```typescript
export const API_ENDPOINTS = {
  // ...现有端点...
  
  // NAS
  NAS_BROWSE: '/nas/browse',
  NAS_SEARCH: '/nas/search',
  NAS_STREAM: '/nas/stream',
  NAS_SCAN: '/nas/scan',
  
  // Vehicles
  VEHICLES: '/vehicles',
  
  // Test Cases
  TEST_CASES_LIST: '/test-cases',
  TEST_CASES_TAGS: '/test-cases/tags',
  
  // Stats
  STATS_OVERVIEW: '/stats/overview',
  STATS_BY_VEHICLE: '/stats/by-vehicle',
  STATS_BY_DOMAIN: '/stats/by-domain',
  STATS_COMPARE: '/stats/compare',
} as const;
```

### 9.3 修复 `getASRModels` 路径

```typescript
// 当前（重复 /api 前缀）
export const getASRModels = async () => {
  const response = await api.get('/api/video/asr-models');  // BUG: baseURL 已是 /api
};

// 修复
export const getASRModels = async () => {
  const response = await api.get('/video/asr-models');
};
```

---

## 十、类型定义扩展

### 10.1 `types.ts` 新增

```typescript
// 车辆
interface Vehicle {
  id: string;
  brand: string;
  model: string;
  system_version: string;
  description?: string;
  created_at: string;
  // 聚合字段（从统计接口获取）
  total_cases?: number;
  analyzed_cases?: number;
  avg_score?: number;
}

// 用例
interface TestCase {
  id: string;
  case_id: string;
  vehicle_id: string;
  tag_level1: string;
  tag_level2: string;
  tag_level3: string;
  question_count: number;
  is_context_memory: boolean;
  questions: Array<{ index: number; text: string }>;
  expected_behavior?: string;
  video_name: string;
  video_nas_path?: string;
}

// 分页响应
interface PaginatedResponse<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
}

// 统计
interface StatsOverview {
  total_vehicles: number;
  total_cases: number;
  total_videos: number;
  analyzed_videos: number;
  avg_score: number;
  pass_rate: number;
}

// 筛选条件
interface ResultFilter {
  vehicle_id?: string;
  function_domain?: string;
  tag_level1?: string;
  tag_level2?: string;
  tag_level3?: string;
  is_context_memory?: boolean;
  status?: string;
  search?: string;
  score_min?: number;
  score_max?: number;
}
```

---

## 十一、路由结构

```typescript
// App.tsx 路由改造
<Routes>
  <Route path="/" element={<Dashboard />} />           {/* 新：统计仪表盘 */}
  <Route path="/analysis" element={<Home />} />         {/* 原 Home，改路径 */}
  <Route path="/vehicles" element={<Vehicles />} />     {/* 新：车辆列表 */}
  <Route path="/vehicles/:id" element={<VehicleDetail />} />  {/* 新：单车概览 */}
  <Route path="/results/:id" element={<Results />} />
  <Route path="/history" element={<History />} />
  <Route path="/database" element={<Database />} />
  <Route path="/test-cases" element={<TestCases />} />
  <Route path="/vector-manager" element={<VectorManager />} />
  <Route path="/settings" element={<Settings />} />
</Routes>
```

---

## 十二、文件结构变更

```
src/
├── api.ts                   # 改：新增分页参数、NAS/车辆/统计 API
├── config.ts                # 改：修复端口、新增端点
├── types.ts                 # 改：新增 Vehicle/TestCase/Paginated 等类型
├── App.tsx                  # 改：新路由
├── stores/                  # 新目录
│   ├── useVehicleStore.ts
│   ├── useResultStore.ts
│   ├── useNASStore.ts
│   └── useAppStore.ts
├── components/
│   ├── Sidebar.tsx          # 改：新菜单结构
│   ├── Pagination.tsx       # 新：统一分页组件
│   ├── NASBrowser.tsx       # 新：NAS 目录浏览器
│   ├── VideoPlayer.tsx      # 新：统一视频播放器
│   ├── TagFilter.tsx        # 新：三级标签级联选择器
│   ├── ContextMemoryBadge.tsx  # 新：上下文记忆标记
│   ├── AskBeeEval.tsx       # 不变
│   └── SmartText.tsx        # 不变
├── pages/
│   ├── Dashboard.tsx        # 新：统计仪表盘
│   ├── Vehicles.tsx         # 新：车辆管理
│   ├── VehicleDetail.tsx    # 新：单车详情
│   ├── Home.tsx             # 改：新增 NAS 浏览 Tab
│   ├── Database.tsx         # 改：服务端分页
│   ├── TestCases.tsx        # 改：三级标签筛选、多问题展开
│   ├── History.tsx          # 改：服务端分页
│   ├── Results.tsx          # 小改
│   └── VectorManager.tsx    # 不变
└── i18n.ts                  # 改：补充新页面翻译 key
```

---

## 十三、实施优先级

| 阶段 | 内容 | 依赖后端 | 预计工作量 |
|------|------|----------|-----------|
| **P0 - 基础修复** | 修复 `config.ts` 端口和 `getASRModels` 路径 | 无 | 0.5 天 |
| **P1 - 分页** | Pagination 组件 + Database/History 服务端分页 | 后端 P0 | 1-2 天 |
| **P2 - NAS 对接** | NASBrowser 组件 + Home 页双模式 + VideoPlayer | 后端 P1 | 2 天 |
| **P3 - 状态管理** | 引入 Zustand stores | 无 | 1 天 |
| **P4 - 车辆维度** | Vehicles/VehicleDetail 页面 + 侧边栏改造 | 后端 P2 | 2 天 |
| **P5 - 用例视图** | TagFilter + 多问题展开 + ContextMemoryBadge | 后端 P2 | 1-2 天 |
| **P6 - 仪表盘** | Dashboard 页 + recharts 图表 | 后端 P4 | 2 天 |
| **P7 - 增强** | 虚拟滚动、字幕同步、车辆对比 | - | 按需 |

---

## 十四、依赖新增

```bash
npm install zustand recharts @tanstack/react-virtual
```

| 包 | 用途 | 必要性 |
|---|---|---|
| `zustand` | 全局状态管理 | P3 必须 |
| `recharts` | 统计图表 | P6 必须 |
| `@tanstack/react-virtual` | 虚拟滚动 | P7 可选 |
