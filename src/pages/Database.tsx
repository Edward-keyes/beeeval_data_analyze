import React, { useEffect, useState, useCallback } from 'react';
import { getAllResults, updateResult, deleteResult, deleteResultsBatch, getVideoUrl, PaginatedResponse } from '../api';
import { getScreenshotUrl } from '../config';
import { Loader2, Search, Trash2, Edit2, X, Save, PlayCircle, CheckSquare, Square, Info, ArrowUpDown, Tag, Cpu, GitBranch, Gauge, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import SmartText from '../components/SmartText';

// Sort types
type SortConfig = {
    key: 'case_id' | 'brand_model' | 'system_version' | 'function_domain' | 'score' | 'latency' | null;
    direction: 'asc' | 'desc';
};

// Filter types
type FilterConfig = {
    case_id: string;
    brand_model: string;
    system_version: string;
    function_domain: string;
    score_min: string;
    score_max: string;
};

const PAGE_SIZE = 20;

// Parse video name to extract structured info
// Format: {case_id}-{brand_model}-{system_version}-{function_domain}-{scenario}-{sequence}.mp4
// Example: 1002-理想 i8-v8.0.1-车控域-NULL-1.mp4
const parseVideoName = (filename: string) => {
    const parts = filename.split('-');
    if (parts.length >= 4) {
        return {
            case_id: parts[0] || '',
            brand_model: parts[1] || '',
            system_version: parts[2] || '',
            function_domain: parts[3] || '',
            parsed: true
        };
    }
    return {
        case_id: '',
        brand_model: '',
        system_version: '',
        function_domain: '',
        parsed: false
    };
};

// Image Modal Component
const ImageModal = ({ src, onClose }: { src: string; onClose: () => void }) => {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm" onClick={onClose}>
            <div className="relative max-w-7xl max-h-[90vh] p-4" onClick={e => e.stopPropagation()}>
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

// EditModal
const EditModal = ({
    result,
    onClose,
    onSave
}: {
    result: any;
    onClose: () => void;
    onSave: (id: string, data: any) => Promise<void>;
}) => {
    const videoInfo = parseVideoName(result.video_name);
    const [formData, setFormData] = useState({
        user_question: result.metadata?.user_question || '',
        system_response: result.metadata?.system_response || '',
        response_quality_score: result.metadata?.response_quality_score || 0,
        summary: result.metadata?.summary || '',
        video_name: result.video_name,
        latency_ms: result.metadata?.latency_ms || 0,
        path: result.metadata?.path || '',
    });
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave(result.id, {
                video_name: formData.video_name,
                metadata: {
                    user_question: formData.user_question,
                    system_response: formData.system_response,
                    response_quality_score: parseFloat(formData.response_quality_score),
                    summary: formData.summary,
                    latency_ms: parseInt(formData.latency_ms),
                    path: formData.path,
                }
            });
            onClose();
        } catch (error) {
            console.error(error);
            alert("Failed to save");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-slate-900">Edit Result</h3>
                    <button onClick={onClose}><X className="w-5 h-5 text-slate-500" /></button>
                </div>

                {/* Structured Info (Read-only) */}
                <div className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                        <Info className="w-4 h-4" />
                        Video Information (Parsed from filename)
                    </h4>
                    <div className="grid grid-cols-4 gap-3">
                        <div>
                            <label className="block text-xs text-slate-500 mb-1">Case ID</label>
                            <div className="text-sm font-medium text-slate-900">{videoInfo.case_id || 'N/A'}</div>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1">Brand/Model</label>
                            <div className="text-sm font-medium text-slate-900">{videoInfo.brand_model || 'N/A'}</div>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1">System Version</label>
                            <div className="text-sm font-medium text-slate-900">{videoInfo.system_version || 'N/A'}</div>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1">Function Domain</label>
                            <div className="text-sm font-medium text-slate-900">{videoInfo.function_domain || 'N/A'}</div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Video Name</label>
                        <input
                            type="text"
                            className="w-full p-2 border rounded-lg text-sm bg-slate-50"
                            value={formData.video_name}
                            onChange={e => setFormData({ ...formData, video_name: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Latency (ms)</label>
                        <input
                            type="number"
                            className="w-full p-2 border rounded-lg text-sm"
                            value={formData.latency_ms}
                            onChange={e => setFormData({ ...formData, latency_ms: e.target.value })}
                        />
                    </div>
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Video Path</label>
                        <input
                            type="text"
                            className="w-full p-2 border rounded-lg text-sm font-mono text-slate-600"
                            value={formData.path}
                            onChange={e => setFormData({ ...formData, path: e.target.value })}
                        />
                    </div>
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-1">User Question</label>
                        <textarea
                            className="w-full p-2 border rounded-lg text-sm"
                            rows={2}
                            value={formData.user_question}
                            onChange={e => setFormData({ ...formData, user_question: e.target.value })}
                        />
                    </div>
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-1">System Response</label>
                        <textarea
                            className="w-full p-2 border rounded-lg text-sm"
                            rows={3}
                            value={formData.system_response}
                            onChange={e => setFormData({ ...formData, system_response: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Score (1-5)</label>
                        <input
                            type="number"
                            step="0.5"
                            max="5"
                            min="0"
                            className="w-full p-2 border rounded-lg text-sm"
                            value={formData.response_quality_score}
                            onChange={e => setFormData({ ...formData, response_quality_score: e.target.value })}
                        />
                    </div>
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Summary</label>
                        <textarea
                            className="w-full p-2 border rounded-lg text-sm"
                            rows={4}
                            value={formData.summary}
                            onChange={e => setFormData({ ...formData, summary: e.target.value })}
                        />
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-slate-100">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg">Cancel</button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
};

const Database = () => {
    const { t } = useTranslation();
    const [results, setResults] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [searchDebounced, setSearchDebounced] = useState('');
    const [editingResult, setEditingResult] = useState<any | null>(null);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deletingBatch, setDeletingBatch] = useState(false);
    const [sortConfig, setSortConfig] = useState<SortConfig>({ key: null, direction: 'asc' });
    const [filters, setFilters] = useState<FilterConfig>({
        case_id: '',
        brand_model: '',
        system_version: '',
        function_domain: '',
        score_min: '',
        score_max: ''
    });
    const [showFilters, setShowFilters] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => setSearchDebounced(search), 400);
        return () => clearTimeout(timer);
    }, [search]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const sortFieldMap: Record<string, string> = {
                score: 'created_at',
                latency: 'created_at',
                case_id: 'video_name',
                brand_model: 'video_name',
                system_version: 'video_name',
                function_domain: 'video_name',
            };
            const params: Record<string, any> = {
                offset: (currentPage - 1) * PAGE_SIZE,
                limit: PAGE_SIZE,
            };
            if (sortConfig.key) {
                params.sort_by = sortFieldMap[sortConfig.key] || 'created_at';
                params.sort_order = sortConfig.direction;
            }
            if (searchDebounced) params.search = searchDebounced;
            if (filters.brand_model) params.brand_model = filters.brand_model;
            if (filters.system_version) params.system_version = filters.system_version;
            if (filters.function_domain) params.function_domain = filters.function_domain;

            const res = await getAllResults(params);
            setResults(res.data);
            setTotal(res.total);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [currentPage, sortConfig, searchDebounced, filters]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchDebounced, filters]);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const handleDelete = async (id: string) => {
        if (!window.confirm("Are you sure you want to delete this result?")) return;
        try {
            await deleteResult(id);
            setResults(results.filter(r => r.id !== id));
            if (selectedIds.has(id)) {
                const newSet = new Set(selectedIds);
                newSet.delete(id);
                setSelectedIds(newSet);
            }
        } catch (error) {
            console.error(error);
            alert("Failed to delete");
        }
    };

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!window.confirm(`Are you sure you want to delete ${selectedIds.size} items? This action cannot be undone.`)) return;

        setDeletingBatch(true);
        try {
            await deleteResultsBatch(Array.from(selectedIds));
            setResults(results.filter(r => !selectedIds.has(r.id)));
            setSelectedIds(new Set());
        } catch (error) {
            console.error(error);
            alert("Failed to batch delete");
        } finally {
            setDeletingBatch(false);
        }
    };

    const handleUpdate = async (id: string, data: any) => {
        await updateResult(id, data);
        fetchData();
    };

    const toggleSelect = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredThenSortedResults.length && filteredThenSortedResults.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredThenSortedResults.map(r => r.id)));
        }
    };

    const handleSort = (key: SortConfig['key']) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const filteredThenSortedResults = results.filter(r => {
        const videoInfo = parseVideoName(r.video_name);
        const score = r.metadata?.response_quality_score || 0;

        const matchesCaseId = !filters.case_id || videoInfo.case_id.toLowerCase().includes(filters.case_id.toLowerCase());
        const matchesScoreMin = !filters.score_min || score >= parseFloat(filters.score_min);
        const matchesScoreMax = !filters.score_max || score <= parseFloat(filters.score_max);

        return matchesCaseId && matchesScoreMin && matchesScoreMax;
    });

    const getSortIcon = (key: SortConfig['key']) => {
        if (sortConfig.key !== key) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
        return sortConfig.direction === 'asc' ?
            <ArrowUpDown className="w-3 h-3 rotate-180" /> :
            <ArrowUpDown className="w-3 h-3" />;
    };

    return (
        <div className="p-8 h-screen flex flex-col relative overflow-hidden">
            {previewImage && <ImageModal src={previewImage} onClose={() => setPreviewImage(null)} />}

            <div className="flex justify-between items-center mb-8 shrink-0">
                <div>
                    <h2 className="text-3xl font-bold text-slate-900">{t('database')}</h2>
                    <p className="text-slate-500 mt-1">Manage and review all analysis results</p>
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={clsx(
                            "flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium transition-colors",
                            showFilters ? "bg-primary/10 text-primary border-primary/30" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                        )}
                    >
                        <Filter className="w-4 h-4" />
                        Filters
                    </button>
                    {selectedIds.size > 0 && (
                        <button
                            onClick={handleBatchDelete}
                            disabled={deletingBatch}
                            className="flex items-center gap-2 px-4 py-2 bg-rose-600 text-white font-medium rounded-lg hover:bg-rose-700 disabled:opacity-50 transition-colors animate-in fade-in slide-in-from-right-4"
                        >
                            {deletingBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            Delete Selected ({selectedIds.size})
                        </button>
                    )}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                        <input
                            type="text"
                            placeholder="Search results..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-64"
                        />
                    </div>
                </div>
            </div>

            {/* Filter Panel */}
            {showFilters && (
                <div className="mb-6 p-4 bg-white rounded-xl shadow-sm border border-slate-200">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                            <Filter className="w-4 h-4" />
                            Filter by Video Information
                        </h3>
                        <button
                            onClick={() => setFilters({ case_id: '', brand_model: '', system_version: '', function_domain: '', score_min: '', score_max: '' })}
                            className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
                        >
                            <X className="w-3 h-3" />
                            Clear Filters
                        </button>
                    </div>
                    <div className="grid grid-cols-5 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1.5 flex items-center gap-1">
                                <Tag className="w-3 h-3" />
                                Case ID
                            </label>
                            <input
                                type="text"
                                value={filters.case_id}
                                onChange={e => setFilters({ ...filters, case_id: e.target.value })}
                                placeholder="e.g., 1002"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1.5 flex items-center gap-1">
                                <GitBranch className="w-3 h-3" />
                                Brand/Model
                            </label>
                            <input
                                type="text"
                                value={filters.brand_model}
                                onChange={e => setFilters({ ...filters, brand_model: e.target.value })}
                                placeholder="e.g., 理想 i8"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1.5 flex items-center gap-1">
                                <Cpu className="w-3 h-3" />
                                System Version
                            </label>
                            <input
                                type="text"
                                value={filters.system_version}
                                onChange={e => setFilters({ ...filters, system_version: e.target.value })}
                                placeholder="e.g., v8.0.1"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1.5 flex items-center gap-1">
                                <Gauge className="w-3 h-3" />
                                Function Domain
                            </label>
                            <input
                                type="text"
                                value={filters.function_domain}
                                onChange={e => setFilters({ ...filters, function_domain: e.target.value })}
                                placeholder="e.g., 车控域"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1.5 flex items-center gap-1">
                                <Gauge className="w-3 h-3" />
                                Score Range
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    min="0"
                                    max="5"
                                    step="0.5"
                                    value={filters.score_min}
                                    onChange={e => setFilters({ ...filters, score_min: e.target.value })}
                                    placeholder="Min"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                                <span className="text-slate-400">-</span>
                                <input
                                    type="number"
                                    min="0"
                                    max="5"
                                    step="0.5"
                                    value={filters.score_max}
                                    onChange={e => setFilters({ ...filters, score_max: e.target.value })}
                                    placeholder="Max"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 overflow-hidden flex flex-col">
                <div className="overflow-auto flex-1">
                    <table className="w-full text-left text-sm min-w-[1400px]">
                        <thead className="bg-slate-50 text-slate-500 font-medium sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="px-4 py-4 w-12">
                                    <button
                                        onClick={toggleSelectAll}
                                        className="hover:text-blue-600 flex items-center"
                                    >
                                        {filteredThenSortedResults.length > 0 && selectedIds.size === filteredThenSortedResults.length ?
                                            <CheckSquare className="w-5 h-5 text-blue-600" /> :
                                            <Square className="w-5 h-5" />
                                        }
                                    </button>
                                </th>
                                <th
                                    className="px-4 py-4 cursor-pointer hover:bg-slate-100 transition-colors group"
                                    onClick={() => handleSort('case_id')}
                                >
                                    <div className="flex items-center gap-1">
                                        <Tag className="w-3.5 h-3.5" />
                                        Case ID
                                        {getSortIcon('case_id')}
                                    </div>
                                </th>
                                <th
                                    className="px-4 py-4 cursor-pointer hover:bg-slate-100 transition-colors group"
                                    onClick={() => handleSort('brand_model')}
                                >
                                    <div className="flex items-center gap-1">
                                        <GitBranch className="w-3.5 h-3.5" />
                                        Brand/Model
                                        {getSortIcon('brand_model')}
                                    </div>
                                </th>
                                <th
                                    className="px-4 py-4 cursor-pointer hover:bg-slate-100 transition-colors group"
                                    onClick={() => handleSort('system_version')}
                                >
                                    <div className="flex items-center gap-1">
                                        <Cpu className="w-3.5 h-3.5" />
                                        System Version
                                        {getSortIcon('system_version')}
                                    </div>
                                </th>
                                <th
                                    className="px-4 py-4 cursor-pointer hover:bg-slate-100 transition-colors group"
                                    onClick={() => handleSort('function_domain')}
                                >
                                    <div className="flex items-center gap-1">
                                        <Gauge className="w-3.5 h-3.5" />
                                        Function Domain
                                        {getSortIcon('function_domain')}
                                    </div>
                                </th>
                                <th className="px-4 py-4 min-w-[180px]">User Question</th>
                                <th className="px-4 py-4 min-w-[220px]">System Response</th>
                                <th
                                    className="px-4 py-4 cursor-pointer hover:bg-slate-100 transition-colors group"
                                    onClick={() => handleSort('score')}
                                >
                                    <div className="flex items-center gap-1">
                                        Score
                                        {getSortIcon('score')}
                                    </div>
                                </th>
                                <th
                                    className="px-4 py-4 cursor-pointer hover:bg-slate-100 transition-colors group"
                                    onClick={() => handleSort('latency')}
                                >
                                    <div className="flex items-center gap-1">
                                        Latency
                                        {getSortIcon('latency')}
                                    </div>
                                </th>
                                <th className="px-4 py-4 min-w-[180px]">Summary</th>
                                <th className="px-4 py-4 min-w-[150px]">Video</th>
                                <th className="px-4 py-4 w-20 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading ? (
                                <tr>
                                    <td colSpan={12} className="p-8 text-center text-slate-500">
                                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                                        {t('loading_data')}
                                    </td>
                                </tr>
                            ) : filteredThenSortedResults.length === 0 ? (
                                <tr>
                                    <td colSpan={12} className="p-8 text-center text-slate-500">
                                        {search || showFilters ? 'No results match the filters' : t('no_results')}
                                    </td>
                                </tr>
                            ) : (
                                filteredThenSortedResults.map((row) => {
                                    const videoInfo = parseVideoName(row.video_name);
                                    return (
                                        <tr
                                            key={row.id}
                                            className={clsx(
                                                "hover:bg-slate-50 transition-colors group",
                                                selectedIds.has(row.id) && "bg-blue-50/30"
                                            )}
                                        >
                                            <td className="px-4 py-4 align-top">
                                                <button
                                                    onClick={() => toggleSelect(row.id)}
                                                    className="hover:text-blue-600"
                                                >
                                                    {selectedIds.has(row.id) ?
                                                        <CheckSquare className="w-5 h-5 text-blue-600" /> :
                                                        <Square className="w-5 h-5 text-slate-300" />
                                                    }
                                                </button>
                                            </td>
                                            <td className="px-4 py-4 align-top">
                                                <span className="bg-slate-100 px-2.5 py-1 rounded-md text-xs font-mono font-medium text-slate-700">
                                                    {videoInfo.case_id || 'N/A'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 align-top">
                                                <span className="text-sm font-medium text-slate-900">
                                                    {videoInfo.brand_model || 'N/A'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 align-top">
                                                <span className="text-xs font-mono text-slate-600 bg-blue-50 px-2 py-1 rounded">
                                                    {videoInfo.system_version || 'N/A'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 align-top">
                                                <span className="text-xs font-medium text-slate-700 bg-purple-50 px-2.5 py-1 rounded-full">
                                                    {videoInfo.function_domain || 'N/A'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 align-top text-slate-600">
                                                <SmartText text={row.metadata?.user_question || 'N/A'} fallback={<span className="text-slate-300 italic">N/A</span>} />
                                            </td>
                                            <td className="px-4 py-4 align-top text-slate-600">
                                                <SmartText text={row.metadata?.system_response || 'N/A'} fallback={<span className="text-slate-300 italic">N/A</span>} />
                                            </td>
                                            <td className="px-4 py-4 align-top font-bold text-slate-700">
                                                {row.metadata?.response_quality_score ? (
                                                    <span className={clsx(
                                                        "px-2 py-1 rounded-md text-sm",
                                                        row.metadata.response_quality_score >= 4 ? "bg-emerald-100 text-emerald-700" :
                                                            row.metadata.response_quality_score >= 3 ? "bg-amber-100 text-amber-700" :
                                                                "bg-rose-100 text-rose-700"
                                                    )}>
                                                        {row.metadata.response_quality_score}
                                                    </span>
                                                ) : '-'}
                                            </td>
                                            <td className="px-4 py-4 align-top text-slate-700 font-mono text-xs">
                                                {row.metadata?.latency_ms ? (
                                                    <span>{row.metadata.latency_ms} ms</span>
                                                ) : <span className="text-slate-300 italic">-</span>}
                                            </td>
                                            <td className="px-4 py-4 align-top text-slate-600 text-xs">
                                                <SmartText text={row.metadata?.summary || 'N/A'} />
                                            </td>
                                            <td className="px-4 py-4 align-top font-medium text-slate-900">
                                                <div className="text-xs font-mono">
                                                    {row.video_name}
                                                </div>
                                                <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[150px]">
                                                    {row.id}
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 align-top text-right">
                                                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => setEditingResult(row)}
                                                        className="p-1.5 hover:bg-blue-50 text-slate-400 hover:text-blue-600 rounded"
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(row.id)}
                                                        className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="p-4 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 flex justify-between items-center">
                    <span>Showing {filteredThenSortedResults.length} of {total} records (Page {currentPage}/{totalPages})</span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage <= 1}
                            className="p-1.5 rounded hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            let page: number;
                            if (totalPages <= 5) {
                                page = i + 1;
                            } else if (currentPage <= 3) {
                                page = i + 1;
                            } else if (currentPage >= totalPages - 2) {
                                page = totalPages - 4 + i;
                            } else {
                                page = currentPage - 2 + i;
                            }
                            return (
                                <button
                                    key={page}
                                    onClick={() => setCurrentPage(page)}
                                    className={clsx(
                                        "w-8 h-8 rounded text-xs font-medium transition-colors",
                                        page === currentPage
                                            ? "bg-blue-600 text-white"
                                            : "hover:bg-slate-200 text-slate-600"
                                    )}
                                >
                                    {page}
                                </button>
                            );
                        })}
                        <button
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage >= totalPages}
                            className="p-1.5 rounded hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {editingResult && (
                <EditModal
                    result={editingResult}
                    onClose={() => setEditingResult(null)}
                    onSave={handleUpdate}
                />
            )}
        </div>
    );
};

export default Database;
