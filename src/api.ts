import axios from 'axios';
import { Video, AnalysisTask, TaskResults } from './types';
import { BASE_URL, API_ENDPOINTS, getVideoStreamUrl, getNasStreamUrl } from './config';

const api = axios.create({
    baseURL: BASE_URL,
});

export const listVideos = async (folderPath: string): Promise<{ videos: Video[] }> => {
    const response = await api.post(API_ENDPOINTS.LIST_VIDEOS, { folder_path: folderPath });
    return response.data;
};

export const analyzeVideos = async (
    folderPath: string,
    videoNames: string[],
    language: string = "zh",
    asrModel: string = "whisper"
): Promise<{ task_id: string }> => {
    const response = await api.post(API_ENDPOINTS.ANALYZE_VIDEOS, {
        folder_path: folderPath,
        video_names: videoNames,
        analysis_config: {
            evaluation_criteria: ["accuracy", "response_time", "user_experience", "context_awareness", "safety"]
        },
        language: language,
        asr_model: asrModel
    });
    return response.data;
};

export const getASRModels = async (): Promise<{ models: Array<{ value: string; label: string; description: string }>; default: string }> => {
    const response = await api.get('/video/asr-models');
    return response.data;
};

export const getResults = async (taskId: string, params?: { offset?: number; limit?: number; status?: string }): Promise<TaskResults & { total: number; offset: number; limit: number; failed_count: number }> => {
    const response = await api.get(`${API_ENDPOINTS.GET_RESULTS}/${taskId}`, { params });
    return response.data;
};

export const retryFailedVideos = async (taskId: string, asrModel: string = "whisper"): Promise<{ retried: number; task_id: string; message: string }> => {
    const response = await api.post(`${API_ENDPOINTS.RETRY_FAILED}/${taskId}`, null, { params: { asr_model: asrModel } });
    return response.data;
};

export const recoverStuckVideos = async (taskId: string, asrModel: string = "whisper"): Promise<{ recovered: number; task_id: string; message: string }> => {
    const response = await api.post(`${API_ENDPOINTS.RECOVER_STUCK}/${taskId}`, null, { params: { asr_model: asrModel } });
    return response.data;
};

export const forceCompleteTask = async (taskId: string): Promise<{ success: boolean; message: string; celery_purged?: number }> => {
    const response = await api.post(`${API_ENDPOINTS.FORCE_COMPLETE}/${taskId}`);
    return response.data;
};

export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    offset: number;
    limit: number;
}

export const getTasks = async (params?: {
    offset?: number;
    limit?: number;
}): Promise<PaginatedResponse<AnalysisTask>> => {
    const response = await api.get(API_ENDPOINTS.GET_TASKS, { params });
    return response.data;
};

export const getAllResults = async (params?: {
    offset?: number;
    limit?: number;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
    vehicle_id?: string;
    function_domain?: string;
    brand_model?: string;
    system_version?: string;
    status?: string;
    search?: string;
}): Promise<PaginatedResponse<any>> => {
    const response = await api.get(API_ENDPOINTS.GET_ALL_RESULTS, { params });
    return response.data;
};

export const updateResult = async (id: string, data: any): Promise<void> => {
    await api.put(`${API_ENDPOINTS.UPDATE_RESULT}/${id}`, data);
};

export const deleteResult = async (id: string): Promise<void> => {
    await api.delete(`${API_ENDPOINTS.DELETE_RESULT}/${id}`);
};

export const deleteResultsBatch = async (ids: string[]): Promise<void> => {
    await api.delete(API_ENDPOINTS.DELETE_RESULTS_BATCH, { data: { ids } });
};

export const deleteTasksBatch = async (ids: string[]): Promise<void> => {
    await api.delete(API_ENDPOINTS.DELETE_TASKS_BATCH, { data: { ids } });
};

export const getFilterOptions = async (): Promise<{
    brand_models: string[];
    function_domains: string[];
    system_versions: string[];
}> => {
    const response = await api.get(API_ENDPOINTS.FILTER_OPTIONS);
    return response.data;
};

export const getAnalysisStatus = async (taskId: string): Promise<any> => {
    const response = await api.get(`${API_ENDPOINTS.GET_STATUS}/${taskId}`);
    return response.data;
};

export const chatQuery = async (query: string, language: string = "zh"): Promise<{ answer: string }> => {
    const response = await api.post(API_ENDPOINTS.CHAT_QUERY, { query, language });
    return response.data;
};

export const translateText = async (text: string, targetLang: string): Promise<{ original: string, translated: string }> => {
    const response = await api.post(API_ENDPOINTS.TRANSLATE, { text, target_lang: targetLang });
    return response.data;
};

export const getVideoUrl = (path: string): string => {
    return getVideoStreamUrl(path);
};

// NAS API functions
export interface NasItem {
    name: string;
    path: string;
    is_dir: boolean;
    size: number | null;
    modified: number | null;
    mime: string | null;
    is_video: boolean;
}

export interface NasBrowseResponse {
    current_path: string;
    parent_path?: string;
    total: number;
    offset: number;
    items: NasItem[];
}

export const getNasStatus = async (): Promise<{ available: boolean; root?: string; roots?: string[]; message?: string }> => {
    const response = await api.get(API_ENDPOINTS.NAS_STATUS);
    return response.data;
};

export const browseNas = async (params?: {
    path?: string;
    type?: string;
    sort?: string;
    order?: string;
    offset?: number;
}): Promise<NasBrowseResponse> => {
    const response = await api.get(API_ENDPOINTS.NAS_BROWSE, { params });
    return response.data;
};

export const searchNas = async (params: {
    keyword: string;
    path?: string;
    depth?: number;
    limit?: number;
}): Promise<any> => {
    const response = await api.get(API_ENDPOINTS.NAS_SEARCH, { params });
    return response.data;
};

export const scanNasDirectory = async (nasPath: string): Promise<{
    nas_path: string;
    total_files: number;
    video_files: number;
    parsed_videos: any[];
}> => {
    const response = await api.post(API_ENDPOINTS.NAS_SCAN, { nas_path: nasPath });
    return response.data;
};

export const analyzeNasVideos = async (
    nasPaths: string[],
    asrModel: string = "whisper"
): Promise<{ task_id: string }> => {
    const response = await api.post(API_ENDPOINTS.ANALYZE_NAS, {
        nas_paths: nasPaths,
        analysis_config: {
            evaluation_criteria: ["accuracy", "response_time", "user_experience", "context_awareness", "safety"]
        },
        asr_model: asrModel,
    });
    return response.data;
};

export const getNasVideoUrl = (nasPath: string): string => {
    return getNasStreamUrl(nasPath);
};

// RAG API functions
export const vectorizeEvaluations = async (taskIds: string[]): Promise<{ vectorized_count: number; skipped_count: number; failed_count: number }> => {
    const response = await api.post('/rag/vectorize', { task_ids: taskIds });
    return response.data;
};

export const ragQuery = async (question: string, top_k: number = 20): Promise<{ answer: string; sources: any[] }> => {
    const response = await api.post('/rag/query', { question, top_k });
    return response.data;
};

export const getVectorStats = async (): Promise<{ total_vectors: number; dimension: number; collection_name: string }> => {
    const response = await api.get('/rag/stats');
    return response.data;
};

export const deleteVideoVectors = async (videoName: string): Promise<{ status: string; message: string }> => {
    const response = await api.delete(`/rag/video/${encodeURIComponent(videoName)}`);
    return response.data;
};

export interface VectorPoint {
    id: string;
    video_name: string;
    user_question: string;
    system_response: string;
    summary: string;
    evaluations: any[];
    created_at: string;
    case_id: string;
    brand_model: string;
    system_version: string;
    function_domain: string;
    scenario: string;
    sequence: string;
}

export const listVectors = async (params?: {
    offset?: string;
    limit?: number;
    video_name?: string;
    brand_model?: string;
    function_domain?: string;
}): Promise<{ points: VectorPoint[]; next_offset: string | null; total: number }> => {
    const response = await api.get(API_ENDPOINTS.RAG_VECTORS, { params });
    return response.data;
};

export const getVectorFacets = async (): Promise<{
    video_names: string[];
    brand_models: string[];
    function_domains: string[];
}> => {
    const response = await api.get(API_ENDPOINTS.RAG_FACETS);
    return response.data;
};

export const deleteVectorsBatch = async (ids: string[]): Promise<{ status: string; deleted: number }> => {
    const response = await api.post(API_ENDPOINTS.RAG_VECTORS_DELETE_BATCH, { ids });
    return response.data;
};

export const clearVectors = async (): Promise<{ status: string; message: string }> => {
    const response = await api.post(API_ENDPOINTS.RAG_VECTORS_CLEAR);
    return response.data;
};

export const updateVector = async (pointId: string, payload: Partial<VectorPoint> & { re_embed?: boolean }): Promise<{ status: string; id: string; re_embedded: boolean }> => {
    const response = await api.put(`${API_ENDPOINTS.RAG_VECTORS}/${pointId}`, payload);
    return response.data;
};

// ────────────────────────────────────────────────────────────────────
// Vehicle Aggregated Scores
// ────────────────────────────────────────────────────────────────────
export interface VehicleListItem {
    brand_model: string;
    system_version: string | null;
    video_count: number;
    has_cache: boolean;
    last_computed_at: string | null;
}

export interface DimensionScore {
    dimension_key: string;
    avg_score: number;
    sample_count: number;
}

export interface VehicleScoreSnapshot {
    brand_model: string;
    system_version: string | null;
    last_computed_at: string | null;
    criteria_scores: DimensionScore[];
    function_domain_scores: DimensionScore[];
}

export const listVehiclesForAggregation = async (): Promise<VehicleListItem[]> => {
    const response = await api.get(API_ENDPOINTS.AGGREGATION_VEHICLES);
    return response.data;
};

export const getVehicleAggregatedScores = async (
    brand_model: string,
    system_version?: string | null,
): Promise<VehicleScoreSnapshot> => {
    const params: Record<string, string> = { brand_model };
    if (system_version) params.system_version = system_version;
    const response = await api.get(API_ENDPOINTS.AGGREGATION_VEHICLE, { params });
    return response.data;
};

export const computeVehicleAggregatedScores = async (
    brand_model: string,
    system_version?: string | null,
): Promise<VehicleScoreSnapshot> => {
    const response = await api.post(API_ENDPOINTS.AGGREGATION_VEHICLE_COMPUTE, {
        brand_model,
        system_version: system_version || null,
    });
    return response.data;
};

// ────────────────────────────────────────────────────────────────────
// Dr.bee 调试台
// ────────────────────────────────────────────────────────────────────
export interface DrBeeModelOption {
    key: string;
    label: string;
    model_name: string;
}

export interface DrBeeConfig {
    default_system_instruction: string;
    default_prompt_template: string;
    required_placeholders: string[];
    optional_placeholders: string[];
    models: DrBeeModelOption[];
    default_model_key: string;
    /** Auto 模式默认相似度阈值（0~1） */
    default_min_score: number;
    /** Auto 模式兜底最小返回条数 */
    rag_min_k: number;
    /** Auto 模式上限条数 */
    rag_max_k: number;
}

export type DrBeeSelectionMode = "auto" | "manual";

export interface DrBeeSource {
    video_name: string | null;
    video_path: string | null;
    user_question: string | null;
    system_response: string | null;
    summary: string | null;
    score: number | null;
    brand_model: string | null;
    system_version: string | null;
    function_domain: string | null;
}

export interface DrBeeQueryResponse {
    answer: string;
    sources: DrBeeSource[];
    model_key: string;
    model_name: string;
    llm_latency_ms: number;
    total_latency_ms: number;
    retrieved_count: number;
    selection_mode: DrBeeSelectionMode;
    /** Auto 模式下实际生效的阈值；manual 时为 null */
    min_score_used: number | null;
    /** 候选池中 top1 的 cosine 相似度；manual 时为 null */
    top_score: number | null;
    /** 是否触发兜底（样本相关度偏低） */
    low_relevance: boolean;
}

export interface DrBeeQueryRequest {
    question: string;
    prompt_template?: string;
    system_instruction?: string;
    model_key?: string;
    top_k?: number;
    selection_mode?: DrBeeSelectionMode;
    min_score?: number | null;
}

export interface DrBeeSessionListItem {
    id: number;
    title: string | null;
    model_key: string | null;
    model_name: string;
    user_question: string;
    llm_latency_ms: number | null;
    total_latency_ms: number | null;
    top_k: number | null;
    created_at: string;
    selection_mode: DrBeeSelectionMode | null;
    min_score: number | null;
    top_score: number | null;
    low_relevance: boolean | null;
}

export interface DrBeeSessionDetail extends DrBeeSessionListItem {
    prompt_template: string;
    answer: string;
    retrieved_sources: DrBeeSource[];
}

export interface DrBeeReplayResponse {
    original: DrBeeSessionDetail;
    replay: DrBeeQueryResponse;
}

export const getDrBeeConfig = async (): Promise<DrBeeConfig> => {
    const response = await api.get(API_ENDPOINTS.DRBEE_CONFIG);
    return response.data;
};

export const drBeeQuery = async (req: DrBeeQueryRequest): Promise<DrBeeQueryResponse> => {
    const response = await api.post(API_ENDPOINTS.DRBEE_QUERY, req);
    return response.data;
};

export const listDrBeeSessions = async (params?: { limit?: number; offset?: number }): Promise<DrBeeSessionListItem[]> => {
    const response = await api.get(API_ENDPOINTS.DRBEE_SESSIONS, { params });
    return response.data;
};

export const getDrBeeSession = async (id: number): Promise<DrBeeSessionDetail> => {
    const response = await api.get(`${API_ENDPOINTS.DRBEE_SESSIONS}/${id}`);
    return response.data;
};

export const saveDrBeeSession = async (payload: {
    title?: string | null;
    prompt_template: string;
    model_key: string;
    model_name: string;
    user_question: string;
    answer: string;
    llm_latency_ms: number;
    total_latency_ms: number;
    top_k: number;
    retrieved_sources: DrBeeSource[];
    selection_mode?: DrBeeSelectionMode;
    min_score?: number | null;
    top_score?: number | null;
    low_relevance?: boolean;
}): Promise<DrBeeSessionDetail> => {
    const response = await api.post(API_ENDPOINTS.DRBEE_SESSIONS, payload);
    return response.data;
};

export const deleteDrBeeSession = async (id: number): Promise<void> => {
    await api.delete(`${API_ENDPOINTS.DRBEE_SESSIONS}/${id}`);
};

export const replayDrBeeSession = async (id: number): Promise<DrBeeReplayResponse> => {
    const response = await api.post(`${API_ENDPOINTS.DRBEE_SESSIONS}/${id}/replay`);
    return response.data;
};
