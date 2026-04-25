import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Play, CheckSquare, Square, Film, ChevronRight, Home as HomeIcon, Loader2, HardDrive, FileVideo, Activity, Cpu } from 'lucide-react';
import { listVideos, analyzeVideos, getAnalysisStatus, getASRModels } from '../api';
import { Video } from '../types';
import clsx from 'clsx';
import axios from 'axios';
import { useLanguage } from '../contexts/LanguageContext';

// Folder Picker Modal Component
const FolderPicker = ({
    isOpen,
    onClose,
    onSelect
}: {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (path: string) => void;
}) => {
    const { t } = useLanguage();
    const [currentPath, setCurrentPath] = useState<string | null>(null);
    const [dirs, setDirs] = useState<{ name: string, path: string, type?: string }[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchDirs = async (path?: string | null) => {
        setLoading(true);
        try {
            const res = await axios.post('/api/system/list-dirs', { path: path ?? undefined });
            setDirs(res.data.directories);
            setCurrentPath(res.data.current_path);
        } catch (error) {
            console.error("Failed to list directories:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            // Start from root (drive letters on Windows)
            fetchDirs();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                    <div className="flex items-center gap-2">
                        <FolderOpen className="w-5 h-5 text-primary" />
                        <h3 className="font-semibold text-slate-900 font-sans">{t('select_folder')}</h3>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">
                        <span className="sr-only">Close</span>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                <div className="p-3 bg-slate-100/50 border-b border-slate-200 flex items-center gap-2 overflow-x-auto">
                    <span className="text-slate-600 text-xs font-mono whitespace-nowrap px-2 py-1 bg-white rounded border border-slate-200 shadow-sm">
                        {currentPath === "My Computer" ? "选择盘符 / Select Drive" : (currentPath || "Loading...")}
                    </span>
                </div>

                <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-slate-200">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
                            <Loader2 className="w-8 h-8 animate-spin text-primary-light" />
                            <span className="text-sm">Loading directories...</span>
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            {dirs.map((dir) => (
                                <button
                                    key={dir.path || dir.name}
                                    onClick={() => {
                                        if (dir.type === 'root') {
                                            // Go back to drive list
                                            fetchDirs();
                                        } else {
                                            fetchDirs(dir.path);
                                        }
                                    }}
                                    className="w-full text-left px-4 py-2.5 hover:bg-blue-50/80 rounded-md flex items-center gap-3 transition-colors group"
                                >
                                    <FolderOpen className={clsx(
                                        "w-5 h-5 transition-colors",
                                        dir.type === 'root' ? "text-slate-400" :
                                            dir.name === '..' ? "text-slate-400" : "text-primary-light group-hover:text-primary"
                                    )} />
                                    <span className="text-slate-700 font-medium text-sm font-mono">{dir.name}</span>
                                    {dir.type !== 'root' && dir.name !== '..' && <ChevronRight className="w-4 h-4 ml-auto text-slate-300 group-hover:text-primary-light" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-slate-200 flex justify-end gap-3 bg-slate-50">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-200 rounded-lg transition-colors text-sm">
                        Cancel
                    </button>
                    <button
                        onClick={() => {
                            if (currentPath && currentPath !== "My Computer") {
                                onSelect(currentPath);
                                onClose();
                            }
                        }}
                        disabled={!currentPath || currentPath === "My Computer"}
                        className="px-6 py-2 bg-primary text-white font-medium rounded-lg hover:bg-primary-dark transition-colors shadow-sm shadow-primary/20 text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <CheckSquare className="w-4 h-4" />
                        Select This Folder
                    </button>
                </div>
            </div>
        </div>
    );
};

const Home = () => {
    const { t } = useLanguage();
    const [folderPath, setFolderPath] = useState('');
    const [videos, setVideos] = useState<Video[]>([]);
    const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [showPicker, setShowPicker] = useState(false);
    const [asrModels, setAsrModels] = useState<Array<{ value: string; label: string; description: string }>>([]);
    const [selectedAsrModel, setSelectedAsrModel] = useState<string>('whisper');
    const navigate = useNavigate();

    // Fetch available ASR models on mount
    useEffect(() => {
        const fetchASRModels = async () => {
            try {
                const data = await getASRModels();
                setAsrModels(data.models);
                setSelectedAsrModel(data.default || 'whisper');
            } catch (error) {
                console.error('Failed to fetch ASR models:', error);
                // Default models if API fails
                setAsrModels([
                    { value: 'whisper', label: 'Whisper (Medium)', description: 'OpenAI Whisper - Good accuracy, slower' },
                    { value: 'moonshine', label: 'Moonshine (Small)', description: 'Fastest, good accuracy balance' },
                    { value: 'funasr', label: 'FunASR (Paraformer)', description: 'Best Chinese accuracy, fast' }
                ]);
            }
        };
        fetchASRModels();
    }, []);

    const handleScan = async (path: string = folderPath) => {
        if (!path) return;
        setLoading(true);
        try {
            const res = await listVideos(path);
            setVideos(res.videos);
            setSelectedVideos(new Set(res.videos.map(v => v.name)));
        } catch (error) {
            console.error(error);
            alert('Failed to scan folder. Ensure backend is running and path is valid.');
        } finally {
            setLoading(false);
        }
    };

    const toggleVideo = (name: string) => {
        const newSet = new Set(selectedVideos);
        if (newSet.has(name)) {
            newSet.delete(name);
        } else {
            newSet.add(name);
        }
        setSelectedVideos(newSet);
    };

    const [analysisTaskId, setAnalysisTaskId] = useState<string | null>(null);
    const [progressMap, setProgressMap] = useState<Record<string, { status: string, progress: number, current_phase?: string }>>({});

    useEffect(() => {
        if (!analyzing || !analysisTaskId) return;

        let pollInterval: NodeJS.Timeout | null = null;
        let isUnmounted = false;

        const fetchAndSetStatus = async () => {
            try {
                const status = await getAnalysisStatus(analysisTaskId);
                console.log('[Polling] Task status:', status.task.status);
                console.log('[Polling] Videos:', status.videos);

                const newMap: Record<string, { status: string, progress: number, current_phase?: string }> = {};

                // Process each video from API response
                if (status.videos && Array.isArray(status.videos)) {
                    status.videos.forEach((v: any) => {
                        const videoName = v.video_name || 'unknown';
                        const metadata = v.metadata || {};
                        const phase = metadata.current_phase || '';
                        const progress = metadata.progress || 0;
                        const videoStatus = metadata.status || 'pending';

                        newMap[videoName] = {
                            status: videoStatus,
                            progress: progress,
                            current_phase: phase
                        };
                        console.log(`[Polling] ${videoName}: ${phase} (${progress}%) - status: ${videoStatus}`);
                    });
                }

                if (!isUnmounted) {
                    setProgressMap(newMap);
                }

                // Check if task is completed
                if (status.task.status === 'completed' || status.task.status === 'failed') {
                    if (pollInterval && !isUnmounted) {
                        clearInterval(pollInterval);
                        console.log('[Polling] Task completed, stopping poll');
                    }
                    setTimeout(() => {
                        if (!isUnmounted) {
                            navigate(`/results/${analysisTaskId}`);
                        }
                    }, 500);
                }
            } catch (error) {
                console.error("[Polling] Error:", error);
            }
        };

        const startPolling = () => {
            console.log('[Polling] Starting polling for task:', analysisTaskId);
            // Fetch immediately first
            fetchAndSetStatus();
            // Then poll every 500ms (reduced from 200ms to avoid excessive requests)
            pollInterval = setInterval(fetchAndSetStatus, 500);
        };

        startPolling();

        return () => {
            isUnmounted = true;
            if (pollInterval) {
                clearInterval(pollInterval);
                console.log('[Polling] Cleanup - interval cleared');
            }
        };
    }, [analyzing, analysisTaskId]);

    const handleStartAnalysis = async () => {
        if (!folderPath || selectedVideos.size === 0) return;

        setAnalyzing(true);
        try {
            const result = await analyzeVideos(folderPath, Array.from(selectedVideos), 'zh', selectedAsrModel);
            setAnalysisTaskId(result.task_id);
        } catch (error) {
            console.error(error);
            setAnalyzing(false);
            alert('Analysis failed to start');
        }
    };

    return (
        <div className="p-8 space-y-8 max-w-7xl mx-auto">
            <header className="flex justify-between items-end border-b border-slate-200 pb-6">
                <div>
                    <h2 className="text-3xl font-bold text-primary-dark font-sans tracking-tight">{t('analysis_console')}</h2>
                    <p className="text-slate-500 mt-2 font-sans">{t('select_folder_desc')}</p>
                </div>
                {/* Stats / Status could go here */}
            </header>

            {/* Ingestion Card */}
            <div className="bg-white p-1 rounded-2xl shadow-sm border border-slate-200">
                <div className="bg-slate-50/50 p-6 rounded-xl border border-slate-100">
                    <label className="block text-sm font-semibold text-slate-700 mb-2 font-sans">
                        Data Source (Local Folder)
                    </label>
                    <div className="flex gap-3">
                        <div className="flex-1 relative cursor-pointer group" onClick={() => setShowPicker(true)}>
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <HardDrive className="h-5 w-5 text-slate-400 group-hover:text-primary transition-colors" />
                            </div>
                            <input
                                type="text"
                                value={folderPath}
                                readOnly
                                placeholder={t('click_to_select')}
                                className="block w-full pl-10 pr-3 py-3 border border-slate-300 rounded-lg leading-5 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary sm:text-sm font-mono transition-all cursor-pointer hover:border-primary-light"
                            />
                            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                <span className="text-slate-400 text-xs bg-slate-100 px-2 py-0.5 rounded border border-slate-200">BROWSE</span>
                            </div>
                        </div>
                        <button
                            onClick={() => handleScan()}
                            disabled={loading || !folderPath}
                            className="px-6 py-3 bg-secondary text-white font-bold rounded-lg hover:bg-secondary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm shadow-secondary/20 flex items-center gap-2 whitespace-nowrap"
                        >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Activity className="w-5 h-5" />}
                            {loading ? t('scanning') : t('scan_folder')}
                        </button>
                    </div>
                </div>
            </div>

            <FolderPicker
                isOpen={showPicker}
                onClose={() => setShowPicker(false)}
                onSelect={(path) => {
                    setFolderPath(path);
                    handleScan(path);
                }}
            />

            {/* Data Table */}
            {videos.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
                    <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/30">
                        <div className="flex items-center gap-3">
                            <div className="bg-blue-100 p-2 rounded-lg text-primary">
                                <FileVideo className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">{t('detected_videos')}</h3>
                                <p className="text-xs text-slate-500 font-mono mt-0.5">{videos.length} items found</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            {/* ASR Model Selector */}
                            <div className="flex items-center gap-2">
                                <Cpu className="w-4 h-4 text-slate-500" />
                                <select
                                    value={selectedAsrModel}
                                    onChange={(e) => setSelectedAsrModel(e.target.value)}
                                    disabled={analyzing}
                                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium bg-white focus:ring-2 focus:ring-primary focus:border-primary disabled:opacity-50 cursor-pointer hover:border-primary-light transition-colors"
                                    title="Select ASR model for transcription"
                                >
                                    {asrModels.map((model) => (
                                        <option key={model.value} value={model.value}>
                                            {model.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <span className="text-sm font-medium text-slate-600 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                                {selectedVideos.size} selected
                            </span>
                            <button
                                onClick={handleStartAnalysis}
                                disabled={analyzing || selectedVideos.size === 0}
                                className="flex items-center gap-2 px-8 py-2.5 bg-cta text-white font-bold rounded-lg hover:bg-cta-hover disabled:opacity-50 transition-all shadow-md shadow-cta/20 transform active:scale-95"
                            >
                                {analyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
                                {analyzing ? t('analyzing') : t('start_analysis')}
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                                    <th className="px-6 py-3 w-12 text-center">
                                        <button
                                            onClick={() => setSelectedVideos(selectedVideos.size === videos.length ? new Set() : new Set(videos.map(v => v.name)))}
                                            className="hover:text-primary transition-colors focus:outline-none"
                                            disabled={analyzing}
                                        >
                                            {selectedVideos.size === videos.length ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                                        </button>
                                    </th>
                                    <th className="px-6 py-3 font-sans">{t('video_name')}</th>
                                    <th className="px-6 py-3 font-sans">{t('size')}</th>
                                    <th className="px-6 py-3 font-sans">{t('path')}</th>
                                    {analyzing && <th className="px-6 py-3 font-sans">{t('progress')}</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-sm">
                                {videos.map((video, idx) => (
                                    <tr
                                        key={video.name}
                                        className={clsx(
                                            "group transition-colors duration-150",
                                            selectedVideos.has(video.name) ? "bg-blue-50/40" : "hover:bg-slate-50",
                                            analyzing && !selectedVideos.has(video.name) && "opacity-40 grayscale"
                                        )}
                                        onClick={() => !analyzing && toggleVideo(video.name)}
                                    >
                                        <td className="px-6 py-4 text-center cursor-pointer">
                                            <div className={clsx(
                                                "w-5 h-5 rounded border flex items-center justify-center transition-all mx-auto",
                                                selectedVideos.has(video.name)
                                                    ? "bg-primary border-primary text-white shadow-sm"
                                                    : "border-slate-300 bg-white group-hover:border-primary-light"
                                            )}>
                                                {selectedVideos.has(video.name) && <CheckSquare className="w-3.5 h-3.5" />}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 font-medium text-slate-900">
                                            <div className="flex items-center gap-3">
                                                <span className="text-slate-400 font-mono text-xs opacity-50 w-6 text-right">{idx + 1}</span>
                                                <span className="font-mono text-sm">{video.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 font-mono text-slate-500 text-xs">
                                            {(video.size / (1024 * 1024)).toFixed(2)} MB
                                        </td>
                                        <td className="px-6 py-4 text-slate-400 font-mono text-xs truncate max-w-xs" title={video.path}>
                                            {video.path}
                                        </td>
                                        {analyzing && selectedVideos.has(video.name) && (
                                            <td className="px-6 py-4">
                                                {(() => {
                                                    const info = progressMap[video.name];
                                                    const progress = info?.progress || 0;
                                                    const status = info?.status || 'processing';
                                                    const phase = info?.current_phase || 'Initializing...';

                                                    // Debug: log progress info for this video
                                                    if (info) {
                                                        console.log(`[Render] ${video.name}: progress=${progress}, status=${status}, phase=${phase}`);
                                                    } else {
                                                        console.log(`[Render] ${video.name}: No progress info yet (waiting for backend)`);
                                                    }

                                                    // Map backend phase names to i18n keys
                                                    const getPhaseKey = (phaseName: string): string => {
                                                        const phaseMap: Record<string, string> = {
                                                            'Queued': 'phase_queued',
                                                            'Initializing Analysis': 'phase_initializing',
                                                            'Extracting Audio from Video': 'phase_extracting_audio',
                                                            'Audio Extraction Complete': 'phase_audio_extracted',
                                                            'Transcribing Audio': 'phase_transcribing',
                                                            'Transcription Complete': 'phase_transcription_complete',
                                                            'Capturing System Screenshot': 'phase_capturing_screenshot',
                                                            'Screenshot Captured': 'phase_screenshot_captured',
                                                            'LLM AI Analysis': 'phase_llm_analysis',
                                                            'LLM Analysis Complete': 'phase_llm_complete',
                                                            'Saving Results': 'phase_saving_results',
                                                            'Saving Results to Database': 'phase_saving_results',
                                                            'Completed': 'phase_completed',
                                                            'Failed': 'phase_failed'
                                                        };
                                                        // Find matching key
                                                        for (const [key, value] of Object.entries(phaseMap)) {
                                                            if (phaseName.includes(key)) return value;
                                                        }
                                                        return 'processing'; // fallback
                                                    };

                                                    const phaseKey = getPhaseKey(phase);
                                                    const phaseText = t(phaseKey);

                                                    if (status === 'completed') {
                                                        return (
                                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                                {t('done')}
                                                            </span>
                                                        );
                                                    }
                                                    if (status === 'failed') {
                                                        return (
                                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 border border-rose-200">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                                                {t('failed')}
                                                            </span>
                                                        );
                                                    }

                                                    return (
                                                        <div className="w-48">
                                                            {/* Current Phase Name */}
                                                            <div className="text-[10px] font-bold text-secondary mb-1 truncate" title={phaseText}>
                                                                {phaseText}
                                                            </div>
                                                            {/* Progress Bar */}
                                                            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden shadow-inner">
                                                                <div
                                                                    className="bg-secondary h-full rounded-full transition-all duration-500 shadow-sm"
                                                                    style={{ width: `${progress}%` }}
                                                                />
                                                            </div>
                                                            {/* Progress Percentage */}
                                                            <div className="text-right text-[10px] text-slate-500 font-mono mt-0.5">
                                                                {progress}%
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Home;
