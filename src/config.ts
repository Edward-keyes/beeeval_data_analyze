/**
 * Application Configuration
 *
 * Centralized configuration for API endpoints and settings.
 * Update BASE_URL to change the backend server address.
 */

// Backend API base URL
// 开发：Vite 代理，用相对路径 '/api'
// 生产或嵌入**其它域名**的页面：构建前在 .env.production 里设置
//   VITE_API_BASE_URL=https://你的 BeeEVAL 公网或内网域/api
//   VITE_SERVER_URL=https://你的 BeeEVAL 域（无路径，与 NAS 流等一致）
// 否则同域部署仍可用默认 '/api'
export const BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

export const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:8004";

// API endpoints
export const API_ENDPOINTS = {
    // Video analysis
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
    FILTER_OPTIONS: '/video/filter-options',
    RETRY_FAILED: '/video/retry-failed',
    RECOVER_STUCK: '/video/recover-stuck',
    FORCE_COMPLETE: '/video/force-complete',

    // NAS
    NAS_STATUS: '/nas/status',
    NAS_BROWSE: '/nas/browse',
    NAS_SEARCH: '/nas/search',
    NAS_INFO: '/nas/info',
    NAS_STREAM: '/nas/stream',
    NAS_SCAN: '/nas/scan',
    ANALYZE_NAS: '/video/analyze-nas',

    // RAG / Vector management
    RAG_VECTORS: '/rag/vectors',
    RAG_FACETS: '/rag/facets',
    RAG_VECTORS_DELETE_BATCH: '/rag/vectors/delete-batch',
    RAG_VECTORS_CLEAR: '/rag/vectors/clear',

    // Chat & Translation
    CHAT_QUERY: '/chat/query',
    TRANSLATE: '/translate',

    // Vehicle Aggregated Scores
    AGGREGATION_VEHICLES: '/aggregation/vehicles',
    AGGREGATION_VEHICLE: '/aggregation/vehicle',
    AGGREGATION_VEHICLE_COMPUTE: '/aggregation/vehicle/compute',

    // Dr.bee 调试台
    DRBEE_CONFIG: '/drbee/config',
    DRBEE_QUERY: '/drbee/query',
    DRBEE_SESSIONS: '/drbee/sessions',

    // System
    STREAM_VIDEO: '/video/stream',
    SYSTEM_LOGS: '/system/logs',
} as const;

// Helper functions
export const getApiUrl = (endpoint: string): string => {
    return `${BASE_URL}${endpoint}`;
};

export const getServerUrl = (path: string): string => {
    return `${SERVER_URL}${path}`;
};

export const getVideoStreamUrl = (path: string): string => {
    return `${SERVER_URL}/api${API_ENDPOINTS.STREAM_VIDEO}?path=${encodeURIComponent(path)}`;
};

export const getNasStreamUrl = (nasPath: string): string => {
    return `${SERVER_URL}/api${API_ENDPOINTS.NAS_STREAM}?path=${encodeURIComponent(nasPath)}`;
};

export const getScreenshotUrl = (screenshotPath: string): string => {
    if (!screenshotPath) return '';
    // If screenshot path is absolute (starts with /screenshots), prepend server URL
    if (screenshotPath.startsWith('/screenshots')) {
        return `${SERVER_URL}${screenshotPath}`;
    }
    // If it already has full URL, return as is
    if (screenshotPath.startsWith('http')) {
        return screenshotPath;
    }
    // Otherwise, prepend server URL
    return `${SERVER_URL}${screenshotPath}`;
};
