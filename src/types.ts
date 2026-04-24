export interface Video {
    name: string;
    size: number;
    path: string;
}

export interface VideoInfo {
    case_id: string;           // 用例 ID
    brand_model: string;        // 品牌车型
    system_version: string;     // 系统版本
    function_domain: string;    // 功能域
    scenario: string;           // 场景描述
    sequence: string;           // 序号
    parsed: boolean;            // 是否成功解析
}

export interface AnalysisTask {
    id: string;
    folder_path: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    total_videos: number;
    completed_videos: number;
    created_at: string;
}

export interface EvaluationScore {
    id: string;
    criteria: string;
    score: number;
    feedback: string;
    details: any;
    // New fields for multi-case support
    metric_code?: string;
    category?: string;
    selection_reason?: string;
}

export interface MatchedMetric {
    metric_code: string;
    metric_name: string;
    category: string;
    score: number;
    feedback: string;
    selection_reason: string;
}

export interface EvaluationCase {
    user_question: string;
    system_response: string;
    response_quality_score: number;
    latency_ms: number;
    summary: string;
    ui_ux_feedback?: string;
    matched_metrics: MatchedMetric[];
}

export interface VideoResult {
    id: string;
    task_id: string;
    video_name: string;
    transcript: string;
    metadata: any;
    created_at: string;
    evaluation_scores: EvaluationScore[];
}

export interface TaskResults {
    task: AnalysisTask;
    results: VideoResult[];
}
