import React, { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { getNasVideoUrl, getVideoUrl } from '../api';

interface Props {
    open: boolean;
    videoPath: string | null;
    title?: string | null;
    onClose: () => void;
}

type LoadPhase = 'idle' | 'requesting' | 'metadata' | 'buffering' | 'ready' | 'error';

const PHASE_LABEL: Record<LoadPhase, string> = {
    idle: '',
    requesting: '正在请求视频...',
    metadata: '已收到视频信息，准备解码...',
    buffering: '缓冲中...',
    ready: '',
    error: '加载失败',
};

/**
 * 通用视频弹窗。点击 markdown 链接 (.mp4) 时弹出，不离开当前页。
 *
 * 路径判断逻辑：以 / 开头的视为 NAS 路径，走 /api/nas/stream；
 * 其他（含 http(s)://、相对路径）走 /api/video/stream，与 AskBeeEval 保持一致。
 *
 * 性能：
 * - preload="auto" 让浏览器立刻开始拉，配合 nginx buffering + 后端 keep-alive
 *   首屏更快
 * - 分阶段加载提示（请求/元数据/缓冲/就绪），让用户感知到进度
 */
const VideoPlayerModal: React.FC<Props> = ({ open, videoPath, title, onClose }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [phase, setPhase] = useState<LoadPhase>('idle');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    // 弹窗打开时记录开始时间，让 progress 文案显示「已等待 Xs」
    const [openAt, setOpenAt] = useState<number>(0);
    const [, setNow] = useState<number>(0);

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (open) {
            window.addEventListener('keydown', handleEsc);
        }
        return () => window.removeEventListener('keydown', handleEsc);
    }, [open, onClose]);

    useEffect(() => {
        if (open) {
            setPhase('requesting');
            setErrorMsg(null);
            setOpenAt(Date.now());
        } else if (videoRef.current) {
            videoRef.current.pause();
            setPhase('idle');
        }
    }, [open, videoPath]);

    // 「已等待 Xs」每秒更新一次，仅在还没就绪时跑
    useEffect(() => {
        if (phase === 'ready' || phase === 'idle' || phase === 'error') return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [phase]);

    if (!open || !videoPath) return null;

    const streamUrl = videoPath.startsWith('/') ? getNasVideoUrl(videoPath) : getVideoUrl(videoPath);
    const elapsedSec = phase === 'ready' || phase === 'idle' ? 0 : Math.floor((Date.now() - openAt) / 1000);
    const showOverlay = phase !== 'ready' && phase !== 'idle';

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4"
            onClick={onClose}
        >
            <div
                className="bg-slate-900 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 bg-slate-800/60">
                    <div className="text-white font-medium truncate pr-4">
                        {title || videoPath}
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-300 hover:text-white p-1.5 rounded-full hover:bg-slate-700 transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="flex-1 flex items-center justify-center bg-black overflow-hidden relative">
                    <video
                        ref={videoRef}
                        controls
                        autoPlay
                        preload="auto"
                        playsInline
                        src={streamUrl}
                        className="max-h-[80vh] max-w-full"
                        onLoadStart={() => setPhase('requesting')}
                        onLoadedMetadata={() => setPhase('metadata')}
                        onWaiting={() => setPhase('buffering')}
                        onCanPlay={() => setPhase('ready')}
                        onPlaying={() => setPhase('ready')}
                        onError={(e) => {
                            setPhase('error');
                            const v = e.currentTarget as HTMLVideoElement;
                            const code = v.error?.code;
                            const codeMsg: Record<number, string> = {
                                1: 'aborted',
                                2: 'network',
                                3: 'decode',
                                4: 'src not supported',
                            };
                            setErrorMsg(code ? codeMsg[code] || `code=${code}` : 'unknown');
                        }}
                    >
                        您的浏览器不支持 video 标签。
                    </video>
                    {showOverlay && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 pointer-events-none">
                            {phase === 'error' ? (
                                <div className="text-red-300 text-sm font-medium">
                                    {PHASE_LABEL[phase]}
                                    {errorMsg ? `（${errorMsg}）` : ''}
                                </div>
                            ) : (
                                <>
                                    <Loader2 className="w-8 h-8 text-white/80 animate-spin mb-2" />
                                    <div className="text-white/90 text-sm font-medium">
                                        {PHASE_LABEL[phase]}
                                    </div>
                                    <div className="text-white/50 text-xs mt-1 font-mono">
                                        {elapsedSec > 2 ? `已等待 ${elapsedSec}s` : ''}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
                <div className="px-5 py-2 text-xs text-slate-400 font-mono break-all bg-slate-800/40 border-t border-slate-700">
                    {videoPath}
                </div>
            </div>
        </div>
    );
};

export default VideoPlayerModal;
