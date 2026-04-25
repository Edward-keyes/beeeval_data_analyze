import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    browseNas, getNasStatus, analyzeNasVideos, getASRModels,
    getNasVideoUrl, NasItem, NasBrowseResponse, searchNas,
} from '../api';
import { useLanguage } from '../contexts/LanguageContext';
import {
    Loader2, FolderOpen, Film, ArrowLeft, Search, CheckSquare, Square,
    Play, HardDrive, ChevronRight, RefreshCw, Wifi, WifiOff, X,
    FileVideo, ArrowUpDown,
} from 'lucide-react';
import clsx from 'clsx';

const formatSize = (bytes: number | null) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const NASBrowser = () => {
    const { t } = useLanguage();
    const navigate = useNavigate();

    const [nasAvailable, setNasAvailable] = useState<boolean | null>(null);
    const [nasMessage, setNasMessage] = useState('');
    const [currentPath, setCurrentPath] = useState<string>('');
    const [parentPath, setParentPath] = useState<string | null>(null);
    const [items, setItems] = useState<NasItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [previewVideo, setPreviewVideo] = useState<string | null>(null);
    const [typeFilter, setTypeFilter] = useState<string>('');
    const [sortBy, setSortBy] = useState<string>('name');
    const [sortOrder, setSortOrder] = useState<string>('asc');
    const [searchKeyword, setSearchKeyword] = useState('');
    const [searchResults, setSearchResults] = useState<NasItem[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [page, setPage] = useState(0);
    const pageSize = 500;

    const [analyzing, setAnalyzing] = useState(false);
    const [asrModels, setAsrModels] = useState<Array<{ value: string; label: string; description: string }>>([]);
    const [selectedAsr, setSelectedAsr] = useState('whisper');

    useEffect(() => {
        const checkStatus = async () => {
            try {
                const status = await getNasStatus();
                setNasAvailable(status.available);
                setNasMessage(status.message || '');
            } catch {
                setNasAvailable(false);
                setNasMessage('Failed to connect to backend');
            }
        };
        checkStatus();
        getASRModels().then(res => {
            setAsrModels(res.models);
            setSelectedAsr(res.default);
        }).catch(() => { });
    }, []);

    const browse = useCallback(async (path?: string, offset: number = 0) => {
        setLoading(true);
        setSearchResults(null);
        try {
            const params: Record<string, any> = { sort: sortBy, order: sortOrder, offset };
            if (path !== undefined) params.path = path;
            if (typeFilter) params.type = typeFilter;
            const data: NasBrowseResponse = await browseNas(params);
            setCurrentPath(data.current_path);
            setParentPath(data.parent_path || null);
            setItems(data.items);
            setTotal(data.total);
        } catch (e: any) {
            console.error('NAS browse error', e);
        } finally {
            setLoading(false);
        }
    }, [sortBy, sortOrder, typeFilter]);

    useEffect(() => {
        if (nasAvailable) browse();
    }, [nasAvailable, browse]);

    const handleNavigate = (path: string) => {
        setSelectedPaths(new Set());
        setPage(0);
        browse(path, 0);
    };

    const handleBack = () => {
        if (parentPath) handleNavigate(parentPath);
    };

    const handleSearch = async () => {
        if (!searchKeyword.trim()) { setSearchResults(null); return; }
        setSearching(true);
        try {
            const data = await searchNas({ keyword: searchKeyword, path: currentPath, depth: 5, limit: 200 });
            setSearchResults(data.results || data.items || []);
        } catch (e) {
            console.error('NAS search error', e);
        } finally {
            setSearching(false);
        }
    };

    const toggleSelect = (path: string) => {
        const next = new Set(selectedPaths);
        if (next.has(path)) next.delete(path); else next.add(path);
        setSelectedPaths(next);
    };

    const videoItems = (searchResults || items).filter(i => i.is_video);
    const dirItems = searchResults ? [] : items.filter(i => i.is_dir);

    const selectAllVideos = () => {
        if (selectedPaths.size === videoItems.length && videoItems.length > 0) {
            setSelectedPaths(new Set());
        } else {
            setSelectedPaths(new Set(videoItems.map(v => v.path)));
        }
    };

    const handleAnalyze = async () => {
        if (selectedPaths.size === 0) return;
        setAnalyzing(true);
        try {
            const res = await analyzeNasVideos(Array.from(selectedPaths), selectedAsr);
            navigate(`/results/${res.task_id}`);
        } catch (e: any) {
            console.error('NAS analyze error', e);
            alert('Failed to start NAS analysis: ' + (e?.response?.data?.detail || e.message));
        } finally {
            setAnalyzing(false);
        }
    };

    const pathParts = currentPath.split('/').filter(Boolean);

    if (nasAvailable === null) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    if (!nasAvailable) {
        return (
            <div className="p-8 flex flex-col items-center justify-center h-full gap-4">
                <WifiOff className="w-16 h-16 text-slate-300" />
                <h2 className="text-2xl font-bold text-slate-700">{t('nas_unavailable')}</h2>
                <p className="text-slate-500 max-w-md text-center">{nasMessage || t('nas_unavailable_desc')}</p>
                <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" /> {t('retry')}
                </button>
            </div>
        );
    }

    return (
        <div className="p-8 h-screen flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex justify-between items-start mb-6 shrink-0">
                <div>
                    <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <HardDrive className="w-8 h-8 text-blue-600" />
                        {t('nas_browser')}
                    </h2>
                    <p className="text-slate-500 mt-1">{t('nas_browser_desc')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs text-emerald-600 font-medium">{t('nas_connected')}</span>
                </div>
            </div>

            {/* Breadcrumb + Controls */}
            <div className="flex items-center gap-3 mb-4 shrink-0 flex-wrap">
                <button
                    onClick={handleBack}
                    disabled={!parentPath}
                    className="p-2 rounded-lg hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-1 text-sm text-slate-600 bg-white px-3 py-2 rounded-lg border border-slate-200 flex-1 min-w-0 overflow-x-auto">
                    <button onClick={() => handleNavigate('')} className="hover:text-blue-600 font-medium shrink-0">NAS</button>
                    {pathParts.map((part, i) => (
                        <React.Fragment key={i}>
                            <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                            <button
                                onClick={() => handleNavigate('/' + pathParts.slice(0, i + 1).join('/'))}
                                className="hover:text-blue-600 truncate max-w-[200px]"
                                title={part}
                            >
                                {part}
                            </button>
                        </React.Fragment>
                    ))}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="text-sm border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">{t('all_files')}</option>
                        <option value="video">{t('videos_only')}</option>
                        <option value="dir">{t('folders_only')}</option>
                    </select>
                    <button onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')} className="p-2 rounded-lg hover:bg-slate-200 transition-colors" title="Toggle sort order">
                        <ArrowUpDown className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Search Bar */}
            <div className="flex items-center gap-2 mb-4 shrink-0">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input
                        type="text"
                        value={searchKeyword}
                        onChange={e => setSearchKeyword(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSearch()}
                        placeholder={t('nas_search_placeholder')}
                        className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    {searchResults && (
                        <button onClick={() => { setSearchResults(null); setSearchKeyword(''); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
                <button onClick={handleSearch} disabled={searching} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    {t('search')}
                </button>
            </div>

            {/* Analysis Controls */}
            {videoItems.length > 0 && (
                <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200 shadow-sm mb-4 shrink-0">
                    <div className="flex items-center gap-4">
                        <button onClick={selectAllVideos} className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-blue-600">
                            {selectedPaths.size === videoItems.length && videoItems.length > 0
                                ? <CheckSquare className="w-5 h-5 text-blue-600" />
                                : <Square className="w-5 h-5" />
                            }
                            {selectedPaths.size > 0 ? `${selectedPaths.size} ${t('selected')}` : t('select_all')}
                        </button>
                        <span className="text-xs text-slate-400">{videoItems.length} {t('videos_in_dir')}</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <select value={selectedAsr} onChange={e => setSelectedAsr(e.target.value)} className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 outline-none">
                            {asrModels.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                        <button
                            onClick={handleAnalyze}
                            disabled={selectedPaths.size === 0 || analyzing}
                            className="px-5 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 text-sm"
                        >
                            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                            {analyzing ? t('analyzing') : t('start_analysis')} {selectedPaths.size > 0 && `(${selectedPaths.size})`}
                        </button>
                    </div>
                </div>
            )}

            {/* File List */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 overflow-hidden flex flex-col">
                <div className="overflow-auto flex-1">
                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                        </div>
                    ) : (
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 text-slate-500 font-medium sticky top-0 z-10">
                                <tr>
                                    <th className="px-4 py-3 w-10"></th>
                                    <th className="px-4 py-3">{t('file_name')}</th>
                                    <th className="px-4 py-3 w-28">{t('size')}</th>
                                    <th className="px-4 py-3 w-20 text-right">{t('actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {dirItems.map(item => (
                                    <tr key={item.path} className="hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => handleNavigate(item.path)}>
                                        <td className="px-4 py-3"><FolderOpen className="w-5 h-5 text-amber-500" /></td>
                                        <td className="px-4 py-3 font-medium text-slate-900">{item.name}</td>
                                        <td className="px-4 py-3 text-slate-400">-</td>
                                        <td className="px-4 py-3 text-right">
                                            <ChevronRight className="w-4 h-4 text-slate-400 inline" />
                                        </td>
                                    </tr>
                                ))}
                                {videoItems.map(item => (
                                    <tr key={item.path} className={clsx("hover:bg-slate-50 transition-colors group", selectedPaths.has(item.path) && "bg-blue-50/40")}>
                                        <td className="px-4 py-3">
                                            <button onClick={() => toggleSelect(item.path)}>
                                                {selectedPaths.has(item.path)
                                                    ? <CheckSquare className="w-5 h-5 text-blue-600" />
                                                    : <Square className="w-5 h-5 text-slate-300" />
                                                }
                                            </button>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <FileVideo className="w-4 h-4 text-blue-500 shrink-0" />
                                                <span className="font-medium text-slate-900 truncate">{item.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">{formatSize(item.size)}</td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setPreviewVideo(item.path); }}
                                                className="p-1.5 hover:bg-blue-50 text-slate-400 hover:text-blue-600 rounded opacity-0 group-hover:opacity-100 transition-all"
                                                title={t('preview')}
                                            >
                                                <Play className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {!loading && dirItems.length === 0 && videoItems.length === 0 && (
                                    <tr><td colSpan={4} className="text-center py-16 text-slate-400">{t('no_results')}</td></tr>
                                )}
                            </tbody>
                        </table>
                    )}
                </div>
                <div className="p-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 flex justify-between items-center">
                    <span>{searchResults ? `${t('search_results')}: ${searchResults.length}` : `${t('total')}: ${total}`}</span>
                    {!searchResults && total > pageSize && (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => { const p = page - 1; setPage(p); browse(currentPath, p * pageSize); }}
                                disabled={page === 0}
                                className="px-2 py-1 rounded border border-slate-300 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                ←
                            </button>
                            <span className="font-mono text-slate-600">
                                {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} / {total}
                            </span>
                            <button
                                onClick={() => { const p = page + 1; setPage(p); browse(currentPath, p * pageSize); }}
                                disabled={(page + 1) * pageSize >= total}
                                className="px-2 py-1 rounded border border-slate-300 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                →
                            </button>
                        </div>
                    )}
                    <span className="font-mono text-slate-400">{currentPath}</span>
                </div>
            </div>

            {/* Video Preview Modal */}
            {previewVideo && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setPreviewVideo(null)}>
                    <div className="relative w-full max-w-4xl mx-4" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setPreviewVideo(null)} className="absolute -top-12 right-0 text-white/70 hover:text-white transition-colors">
                            <X className="w-8 h-8" />
                        </button>
                        <video
                            src={getNasVideoUrl(previewVideo)}
                            controls
                            autoPlay
                            className="w-full rounded-xl shadow-2xl"
                        />
                        <div className="mt-3 text-center text-white/60 text-sm font-mono truncate">{previewVideo.split('/').pop()}</div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default NASBrowser;
