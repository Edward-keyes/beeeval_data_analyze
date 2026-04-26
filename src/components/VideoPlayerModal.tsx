import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { getNasVideoUrl, getVideoUrl } from '../api';

interface Props {
    open: boolean;
    videoPath: string | null;
    title?: string | null;
    onClose: () => void;
}

/**
 * 通用视频弹窗。点击 markdown 链接 (.mp4) 时弹出，不离开当前页。
 *
 * 路径判断逻辑：以 / 开头的视为 NAS 路径，走 /api/nas/stream；
 * 其他（含 http(s)://、相对路径）走 /api/video/stream，与 AskBeeEval 保持一致。
 */
const VideoPlayerModal: React.FC<Props> = ({ open, videoPath, title, onClose }) => {
    const videoRef = useRef<HTMLVideoElement>(null);

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
        if (!open && videoRef.current) {
            videoRef.current.pause();
        }
    }, [open]);

    if (!open || !videoPath) return null;

    const streamUrl = videoPath.startsWith('/') ? getNasVideoUrl(videoPath) : getVideoUrl(videoPath);

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
                <div className="flex-1 flex items-center justify-center bg-black overflow-hidden">
                    <video
                        ref={videoRef}
                        controls
                        autoPlay
                        src={streamUrl}
                        className="max-h-[80vh] max-w-full"
                    >
                        您的浏览器不支持 video 标签。
                    </video>
                </div>
                <div className="px-5 py-2 text-xs text-slate-400 font-mono break-all bg-slate-800/40 border-t border-slate-700">
                    {videoPath}
                </div>
            </div>
        </div>
    );
};

export default VideoPlayerModal;
