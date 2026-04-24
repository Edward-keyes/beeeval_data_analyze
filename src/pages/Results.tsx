import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getResults, retryFailedVideos, recoverStuckVideos, forceCompleteTask } from '../api';
import { getScreenshotUrl, getVideoStreamUrl } from '../config';
import { TaskResults, VideoResult } from '../types';
import { ArrowLeft, Loader2, Activity, Star, X, PlayCircle, ChevronLeft, ChevronRight, RotateCcw, Filter, CheckCircle2, AlertCircle, Clock, Square } from 'lucide-react';
import clsx from 'clsx';

const ImageModal = ({ src, onClose }: { src: string; onClose: () => void }) => {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
            <div className="relative max-w-5xl max-h-[90vh] w-full p-4" onClick={e => e.stopPropagation()}>
                <button 
                    onClick={onClose}
                    className="absolute top-0 right-0 -mt-12 text-white/70 hover:text-white transition-colors"
                >
                    <X className="w-8 h-8" />
                </button>
                <img 
                    src={src} 
                    alt="Full size" 
                    className="w-full h-full object-contain rounded-lg shadow-2xl"
                />
            </div>
        </div>
    );
};

const StarRating = ({ rating }: { rating: number }) => {
    return (
        <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => {
                const isFull = star <= rating;
                const isHalf = star - 0.5 === rating;
                
                return (
                    <div key={star} className="relative">
                        <Star 
                            className={clsx(
                                "w-4 h-4",
                                isFull ? "text-amber-400 fill-amber-400" : "text-slate-200 fill-slate-200"
                            )} 
                        />
                        {isHalf && (
                            <div className="absolute top-0 left-0 overflow-hidden w-1/2">
                                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                            </div>
                        )}
                    </div>
                );
            })}
            <span className="ml-2 font-bold text-slate-700 text-sm">{rating.toFixed(1)}/5.0</span>
        </div>
    );
};

const PAGE_SIZE = 20;

type StatusFilter = '' | 'completed' | 'failed' | 'processing' | 'pending';

const STATUS_OPTIONS: { value: StatusFilter; label: string; icon: React.ReactNode; color: string }[] = [
    { value: '', label: '全部', icon: <Filter className="w-3.5 h-3.5" />, color: 'text-slate-600 bg-slate-100 border-slate-300' },
    { value: 'completed', label: '已完成', icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: 'text-emerald-600 bg-emerald-50 border-emerald-300' },
    { value: 'failed', label: '失败', icon: <AlertCircle className="w-3.5 h-3.5" />, color: 'text-red-600 bg-red-50 border-red-300' },
    { value: 'processing', label: '分析中', icon: <Loader2 className="w-3.5 h-3.5" />, color: 'text-blue-600 bg-blue-50 border-blue-300' },
    { value: 'pending', label: '排队中', icon: <Clock className="w-3.5 h-3.5" />, color: 'text-slate-500 bg-slate-50 border-slate-300' },
];

const Results = () => {
    const { id } = useParams<{ id: string }>();
    const [data, setData] = useState<TaskResults | null>(null);
    const [loading, setLoading] = useState(true);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [page, setPage] = useState(0);
    const [total, setTotal] = useState(0);
    const [failedCount, setFailedCount] = useState(0);
    const [stuckCount, setStuckCount] = useState(0);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
    const [retrying, setRetrying] = useState(false);
    const [recovering, setRecovering] = useState(false);
    const [stopping, setStopping] = useState(false);

    const fetchData = useCallback(async (pageNum?: number, filter?: StatusFilter) => {
        if (!id) return;
        const p = pageNum ?? page;
        const s = filter !== undefined ? filter : statusFilter;
        try {
            const params: any = { offset: p * PAGE_SIZE, limit: PAGE_SIZE };
            if (s) params.status = s;
            const res = await getResults(id, params);
            setData(res);
            setTotal(res.total ?? res.results?.length ?? 0);
            setFailedCount(res.failed_count ?? 0);
            setStuckCount((res as any).stuck_count ?? 0);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [id, page, statusFilter]);

    useEffect(() => {
        fetchData();
        const isActive = data?.task?.status === 'processing' || data?.task?.status === 'pending' || !data;
        if (!isActive) return;
        const interval = setInterval(() => {
            fetchData();
        }, 5000);
        return () => clearInterval(interval);
    }, [fetchData, data?.task?.status]);

    const totalPages = Math.ceil(total / PAGE_SIZE);

    const handlePageChange = (newPage: number) => {
        setPage(newPage);
        fetchData(newPage);
    };

    const handleStatusFilter = (s: StatusFilter) => {
        setStatusFilter(s);
        setPage(0);
        fetchData(0, s);
    };

    const handleRetryFailed = async () => {
        if (!id || retrying) return;
        if (!window.confirm(`确认重新分析 ${failedCount} 个失败视频？`)) return;
        setRetrying(true);
        try {
            await retryFailedVideos(id);
            setStatusFilter('');
            setPage(0);
            fetchData(0, '');
        } catch (e) {
            console.error(e);
            alert('重试请求失败，请查看控制台');
        } finally {
            setRetrying(false);
        }
    };

    const handleRecoverStuck = async () => {
        if (!id || recovering) return;
        if (!window.confirm(`确认恢复 ${stuckCount} 个僵尸/孤儿视频？\n（将重新提交所有卡住的 pending 和 processing 视频）`)) return;
        setRecovering(true);
        try {
            const res = await recoverStuckVideos(id);
            alert(`成功恢复 ${res.recovered} 个视频，已重新提交分析`);
            setStatusFilter('');
            setPage(0);
            fetchData(0, '');
        } catch (e) {
            console.error(e);
            alert('恢复请求失败，请查看控制台');
        } finally {
            setRecovering(false);
        }
    };

    const handleStopTask = async () => {
        if (!id || stopping) return;
        if (!window.confirm('确认停止当前任务？\n\n将执行以下操作：\n• 清空待处理的 Celery 队列\n• 把所有 pending/processing/queued 视频标记为 failed\n• 任务整体置为 completed\n\n此操作不可撤销。')) return;
        setStopping(true);
        try {
            const res = await forceCompleteTask(id);
            alert(`任务已停止${res.celery_purged ? `（清掉 ${res.celery_purged} 条队列残留）` : ''}`);
            fetchData();
        } catch (e) {
            console.error(e);
            alert('停止任务失败，请查看控制台');
        } finally {
            setStopping(false);
        }
    };

    if (loading && !data) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    if (!data) {
        return <div className="p-8 text-center text-slate-500">Task not found</div>;
    }

    // Determine overall status message
    const processingVideos = data.results.filter(v => v.metadata?.status === 'processing');
    const pendingVideos = data.results.filter(v => v.metadata?.status === 'pending' || v.metadata?.status === 'queued');
    
    return (
        <div className="h-screen flex flex-col relative">
            {previewImage && <ImageModal src={previewImage} onClose={() => setPreviewImage(null)} />}
            
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-8 py-4 z-10">
                <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <Link to="/" className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">Analysis Results</h2>
                        <div className="flex items-center gap-2 text-sm text-slate-500 mt-1">
                            <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-xs">{id}</span>
                            <span>•</span>
                            <span className={clsx(
                                "capitalize font-medium",
                                data.task.status === 'completed' ? "text-emerald-600" : 
                                data.task.status === 'processing' ? "text-blue-600" : "text-slate-600"
                            )}>
                                {data.task.status === 'completed' ? 'Finished' : data.task.status}
                                {data.task.status === 'processing' && (
                                    <span className="ml-2 text-slate-500 font-normal">
                                        ({data.task.completed_videos} / {data.task.total_videos} videos processed)
                                    </span>
                                )}
                            </span>
                        </div>
                    </div>
                </div>
                {/* Progress Bar for Processing */}
                {data.task.status === 'processing' && (
                    <div className="w-1/3 bg-slate-50 p-4 rounded-lg border border-slate-100">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-medium text-slate-700">
                                Total Progress ({Math.round((data.task.completed_videos / data.task.total_videos) * 100)}%)
                            </span>
                        </div>
                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden mb-3">
                            <div 
                                className="h-full bg-blue-500 transition-all duration-500 ease-out rounded-full"
                                style={{ width: `${(data.task.completed_videos / data.task.total_videos) * 100}%` }}
                            />
                        </div>
                        
                        {/* Current Active Tasks */}
                        <div className="space-y-2">
                            {processingVideos.map(v => (
                                <div key={v.id} className="flex items-center justify-between text-xs bg-white p-2 rounded border border-blue-100 shadow-sm animate-pulse">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <Loader2 className="w-3 h-3 animate-spin text-blue-500 flex-shrink-0" />
                                        <span className="font-medium text-slate-700 truncate max-w-[150px]">{v.video_name}</span>
                                        <span className="text-slate-400">|</span>
                                        <span className="text-blue-600 font-medium">{v.metadata?.current_phase || "Initializing..."}</span>
                                    </div>
                                    <span className="font-mono text-slate-500">{v.metadata?.progress || 0}%</span>
                                </div>
                            ))}
                            {processingVideos.length === 0 && pendingVideos.length > 0 && (
                                <div className="text-xs text-slate-400 text-center italic">
                                    Queueing next video...
                                </div>
                            )}
                        </div>
                    </div>
                )}
                </div>

                {/* Status Filter Bar + Retry Button */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                    <div className="flex items-center gap-2">
                        {STATUS_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => handleStatusFilter(opt.value)}
                                className={clsx(
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all",
                                    statusFilter === opt.value
                                        ? `${opt.color} border-current shadow-sm`
                                        : "text-slate-400 bg-white border-slate-200 hover:border-slate-300 hover:text-slate-600"
                                )}
                            >
                                {opt.icon}
                                {opt.label}
                                {opt.value === 'failed' && failedCount > 0 && (
                                    <span className="ml-1 px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] font-bold">{failedCount}</span>
                                )}
                            </button>
                        ))}
                    </div>
                    {failedCount > 0 && (
                        <button
                            onClick={handleRetryFailed}
                            disabled={retrying}
                            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
                        >
                            <RotateCcw className={clsx("w-3.5 h-3.5", retrying && "animate-spin")} />
                            {retrying ? '重试中...' : `重新分析失败视频 (${failedCount})`}
                        </button>
                    )}
                    {stuckCount > 0 && (
                        <button
                            onClick={handleRecoverStuck}
                            disabled={recovering}
                            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
                        >
                            <RotateCcw className={clsx("w-3.5 h-3.5", recovering && "animate-spin")} />
                            {recovering ? '恢复中...' : `恢复僵尸视频 (${stuckCount})`}
                        </button>
                    )}
                    {(data.task.status === 'processing' || data.task.status === 'pending') && (
                        <button
                            onClick={handleStopTask}
                            disabled={stopping}
                            className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
                            title="停止任务：清空队列 + 标记剩余视频为失败 + 任务置完成"
                        >
                            <Square className={clsx("w-3.5 h-3.5", stopping && "animate-pulse")} fill="currentColor" />
                            {stopping ? '停止中...' : '停止任务'}
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Main Content */}
                <div className="flex-1 overflow-y-auto bg-slate-100/50 p-8">
                    {data.results.length > 0 ? (
                        <div className="max-w-full mx-auto">
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                <div className="p-4 border-b border-slate-200 bg-slate-50/50">
                                    <h3 className="font-semibold text-slate-900">Analysis Details</h3>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-slate-50 text-slate-500 font-medium">
                                            <tr>
                                                <th className="px-6 py-4 w-1/6">Video / Question</th>
                                                <th className="px-6 py-4 w-1/6">System Response</th>
                                                <th className="px-6 py-4 w-1/12">Screenshot</th>
                                                <th className="px-6 py-4 w-1/12">Video</th>
                                                <th className="px-6 py-4 w-1/12">Latency</th>
                                                <th className="px-6 py-4 w-1/6">Quality</th>
                                                <th className="px-6 py-4 w-1/4">Evaluation Details</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {data.results.map((video) => {
                                                const isProcessing = video.metadata?.status === 'processing';
                                                const isPending = video.metadata?.status === 'pending' || video.metadata?.status === 'queued';
                                                const isFailed = video.metadata?.status === 'failed';
                                                
                                                if (isPending) {
                                                    return (
                                                        <tr key={video.id} className="bg-slate-50/30">
                                                            <td className="px-6 py-4 align-top">
                                                                <div className="font-medium text-slate-400">{video.video_name}</div>
                                                                <div className="inline-flex items-center gap-1.5 mt-2 px-2 py-1 bg-slate-100 rounded text-xs text-slate-500">
                                                                    <div className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
                                                                    Pending
                                                                </div>
                                                            </td>
                                                            <td colSpan={6} className="px-6 py-4 text-slate-400 italic">Waiting to start...</td>
                                                        </tr>
                                                    );
                                                }

                                                if (isFailed) {
                                                    return (
                                                        <tr key={video.id} className="bg-red-50/10">
                                                            <td className="px-6 py-4 align-top">
                                                                <div className="font-medium text-slate-900">{video.video_name}</div>
                                                                <div className="inline-flex items-center gap-1.5 mt-2 px-2 py-1 bg-red-50 rounded text-xs text-red-600 border border-red-100">
                                                                    <X className="w-3 h-3" />
                                                                    Failed
                                                                </div>
                                                            </td>
                                                            <td colSpan={6} className="px-6 py-4">
                                                                <div className="text-red-600 text-xs font-mono bg-red-50 p-3 rounded border border-red-100">
                                                                    Error: {video.metadata?.error || "Unknown error occurred during analysis"}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                }

                                                if (isProcessing) {
                                                    return (
                                                        <tr key={video.id} className="bg-blue-50/10">
                                                            <td className="px-6 py-4 align-top">
                                                                <div className="font-medium text-slate-900">{video.video_name}</div>
                                                                <div className="inline-flex items-center gap-1.5 mt-2 px-2 py-1 bg-blue-50 rounded text-xs text-blue-600 border border-blue-100">
                                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                                    Analyzing ({video.metadata?.progress || 0}%)
                                                                </div>
                                                            </td>
                                                            <td colSpan={6} className="px-6 py-4">
                                                                <div className="flex flex-col gap-2">
                                                                    <span className="text-slate-500 text-xs uppercase tracking-wider font-medium">{video.metadata?.current_phase || "Processing..."}</span>
                                                                    <div className="w-full max-w-md h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                        <div 
                                                                            className="h-full bg-blue-400 rounded-full transition-all duration-300 animate-pulse"
                                                                            style={{ width: `${video.metadata?.progress || 0}%` }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                }

                                                return (
                                                    <tr key={video.id} className="hover:bg-slate-50/50 transition-colors">
                                                        <td className="px-6 py-4 align-top">
                                                            <div className="font-medium text-slate-900 mb-1 break-words whitespace-pre-wrap">{video.video_name}</div>
                                                            <div className="text-slate-500 text-xs mb-3 font-mono break-all">{video.metadata.path}</div>
                                                            {video.metadata.user_question && (
                                                                <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                                                                    <div className="text-xs font-semibold text-blue-700 mb-1">USER QUESTION</div>
                                                                    <div className="text-slate-700 text-xs leading-relaxed whitespace-pre-wrap">{video.metadata.user_question}</div>
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-4 align-top">
                                                            {video.metadata.system_response ? (
                                                                <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                                                                    <div className="text-xs font-semibold text-emerald-700 mb-1">SYSTEM RESPONSE</div>
                                                                    <div className="text-slate-700 text-xs leading-relaxed whitespace-pre-wrap">{video.metadata.system_response}</div>
                                                                </div>
                                                            ) : (
                                                                <span className="text-slate-400 italic text-xs">No response detected</span>
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-4 align-top">
                                                            {video.metadata.screenshot_path ? (
                                                                <div className="group relative w-32">
                                                                    <img
                                                                        src={getScreenshotUrl(video.metadata.screenshot_path)}
                                                                        alt="System Response"
                                                                        className="w-full h-auto rounded-lg border border-slate-200 shadow-sm cursor-pointer hover:ring-2 ring-blue-500 transition-all"
                                                                        onClick={() => setPreviewImage(getScreenshotUrl(video.metadata.screenshot_path))}
                                                                    />
                                                                </div>
                                                            ) : (
                                                                <div className="w-32 aspect-video bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 border border-slate-200 border-dashed">
                                                                    <span className="text-xs">No Image</span>
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-4 align-top">
                                                             <a
                                                                 href={getVideoStreamUrl(video.metadata.path)}
                                                                 target="_blank"
                                                                 rel="noopener noreferrer"
                                                                 className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition-colors text-xs font-medium"
                                                             >
                                                                 <PlayCircle className="w-4 h-4" />
                                                                 Watch
                                                             </a>
                                                        </td>
                                                        <td className="px-6 py-4 align-top whitespace-nowrap">
                                                            <div className="flex items-center gap-2">
                                                                <Activity className="w-4 h-4 text-slate-400" />
                                                                <span className="font-mono font-bold text-slate-700 text-sm">
                                                                    {video.metadata.latency_ms || 0} ms
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 align-top">
                                                             <div className="space-y-2">
                                                                <StarRating rating={video.metadata.response_quality_score || 0} />
                                                                {video.metadata.summary && (
                                                                    <div className="text-xs text-slate-600 bg-amber-50 p-2 rounded border border-amber-100 leading-relaxed">
                                                                        <span className="font-semibold text-amber-700 block mb-1">Summary:</span>
                                                                        {video.metadata.summary}
                                                                    </div>
                                                                )}
                                                             </div>
                                                        </td>
                                                        <td className="px-6 py-4 align-top">
                                                            <div className="space-y-3">
                                                                {video.evaluation_scores.map((score, idx) => (
                                                                    <div key={score.id || idx} className="bg-slate-50 p-2.5 rounded border border-slate-100">
                                                                        <div className="flex justify-between items-center mb-1">
                                                                            <div className="flex flex-col">
                                                                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{score.criteria}</span>
                                                                                {score.metric_code && (
                                                                                    <span className="text-[9px] text-slate-400 font-mono">{score.metric_code}</span>
                                                                                )}
                                                                                {score.category && (
                                                                                    <span className="text-[9px] text-slate-400">{score.category}</span>
                                                                                )}
                                                                            </div>
                                                                            <span className={clsx(
                                                                                "text-[10px] font-bold px-1.5 py-0.5 rounded",
                                                                                score.score >= 4 ? "bg-emerald-100 text-emerald-700" :
                                                                                score.score >= 3 ? "bg-amber-100 text-amber-700" :
                                                                                "bg-rose-100 text-rose-700"
                                                                            )}>
                                                                                {score.score.toFixed(1)}
                                                                            </span>
                                                                        </div>
                                                                        <p className="text-xs text-slate-600 leading-relaxed">{score.feedback}</p>
                                                                        {score.selection_reason && (
                                                                            <p className="text-[10px] text-slate-400 mt-1.5 italic border-t border-slate-200 pt-1.5">
                                                                                选择理由：{score.selection_reason}
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400">
                            <Activity className="w-12 h-12 mb-4 opacity-20" />
                            <p>No results available</p>
                        </div>
                    )}

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-3 py-4 bg-slate-100/50">
                            <button
                                onClick={() => handlePageChange(page - 1)}
                                disabled={page === 0}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 text-xs hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                <ChevronLeft className="w-3 h-3" /> 上一页
                            </button>
                            <span className="text-xs text-slate-600 font-mono">
                                {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} / {total}
                            </span>
                            <button
                                onClick={() => handlePageChange(page + 1)}
                                disabled={page + 1 >= totalPages}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 text-xs hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                下一页 <ChevronRight className="w-3 h-3" />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Results;
