import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Database, Upload, CheckCircle, AlertCircle, Loader2, Trash2, RefreshCw, Filter, ChevronDown, ChevronUp, Search, Eye, X, AlertTriangle, ChevronLeft, ChevronRight, Square, CheckSquare, Download } from 'lucide-react';
import { getTasks, vectorizeEvaluations, getVectorStats, deleteVideoVectors, listVectors, getVectorFacets, deleteVectorsBatch, clearVectors, updateVector, VectorPoint } from '../api';
import { useLanguage } from '../contexts/LanguageContext';
import clsx from 'clsx';

interface Task {
    id: string;
    folder_path: string;
    status: string;
    total_videos: number;
    completed_videos: number;
    created_at: string;
}

interface VectorStats {
    total_vectors: number;
    dimension: number;
    collection_name: string;
}

type SortField = 'created_at' | 'total_videos' | 'completion_rate';
type SortOrder = 'asc' | 'desc';
type StatusFilter = 'all' | 'completed' | 'processing' | 'pending';

interface FilterOptions {
    status: StatusFilter;
    minVideos: number;
    minCompletionRate: number;
    searchQuery: string;
}

const ITEMS_PER_PAGE = 10;
const PAGE_OPTIONS = [10, 20, 50];

const VectorManager = () => {
    const { language } = useLanguage();
    const [tasks, setTasks] = useState<Task[]>([]);
    const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
    const [vectorizing, setVectorizing] = useState(false);
    const [vectorStats, setVectorStats] = useState<VectorStats | null>(null);
    const [result, setResult] = useState<{ vectorized_count: number; skipped_count: number; failed_count: number } | null>(null);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(ITEMS_PER_PAGE);

    // Sorting
    const [sortField, setSortField] = useState<SortField>('created_at');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

    // Filtering
    const [filters, setFilters] = useState<FilterOptions>({
        status: 'completed',  // 默认只显示已完成的任务
        minVideos: 0,
        minCompletionRate: 0,
        searchQuery: ''
    });

    const [showFilterPanel, setShowFilterPanel] = useState(false);

    const fetchTasks = async () => {
        try {
            const res = await getTasks({ limit: 1000 });
            setTasks(res.data);
        } catch (error) {
            console.error('Failed to fetch tasks:', error);
        }
    };

    const fetchVectorStats = async () => {
        try {
            const stats = await getVectorStats();
            setVectorStats(stats);
        } catch (error) {
            console.error('Failed to fetch vector stats:', error);
        }
    };

    useEffect(() => {
        fetchTasks();
        fetchVectorStats();
    }, []);

    // Reset page when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [filters, itemsPerPage]);

    const handleToggleTask = (taskId: string) => {
        const newSelected = new Set(selectedTasks);
        if (newSelected.has(taskId)) {
            newSelected.delete(taskId);
        } else {
            newSelected.add(taskId);
        }
        setSelectedTasks(newSelected);
    };

    const handleSelectAll = () => {
        if (selectedTasks.size === filteredAndSortedTasks.length) {
            setSelectedTasks(new Set());
        } else {
            setSelectedTasks(new Set(filteredAndSortedTasks.map(t => t.id)));
        }
    };

    const handleVectorize = async () => {
        if (selectedTasks.size === 0) return;

        setVectorizing(true);
        setResult(null);

        try {
            const res = await vectorizeEvaluations(Array.from(selectedTasks));
            setResult(res);
            await fetchVectorStats();
            // Clear selection after successful vectorization
            if (res.failed_count === 0) {
                setSelectedTasks(new Set());
            }
        } catch (error) {
            console.error('Vectorization failed:', error);
            setResult({ vectorized_count: 0, skipped_count: 0, failed_count: selectedTasks.size });
        } finally {
            setVectorizing(false);
        }
    };

    const handleDeleteVideoVectors = async (videoName: string) => {
        if (!confirm(language === 'zh' ? `确定要删除视频 "${videoName}" 的向量吗？` : `Sure to delete vectors for video "${videoName}"?`)) {
            return;
        }

        try {
            await deleteVideoVectors(videoName);
            await fetchVectorStats();
        } catch (error) {
            console.error('Failed to delete vectors:', error);
            alert(language === 'zh' ? '删除失败' : 'Delete failed');
        }
    };

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder('desc');
        }
    };

    const getCompletionRate = (task: Task) => {
        if (task.total_videos === 0) return 0;
        return (task.completed_videos / task.total_videos) * 100;
    };

    // Filter and sort tasks
    const filteredAndSortedTasks = useMemo(() => {
        let result = [...tasks];

        // Apply status filter
        if (filters.status !== 'all') {
            result = result.filter(t => t.status === filters.status);
        }

        // Apply min videos filter
        if (filters.minVideos > 0) {
            result = result.filter(t => t.total_videos >= filters.minVideos);
        }

        // Apply min completion rate filter
        if (filters.minCompletionRate > 0) {
            result = result.filter(t => getCompletionRate(t) >= filters.minCompletionRate);
        }

        // Apply search filter
        if (filters.searchQuery) {
            const query = filters.searchQuery.toLowerCase();
            result = result.filter(t =>
                t.id.toLowerCase().includes(query) ||
                t.folder_path.toLowerCase().includes(query)
            );
        }

        // Apply sorting
        result.sort((a, b) => {
            let comparison = 0;

            switch (sortField) {
                case 'created_at':
                    comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                    break;
                case 'total_videos':
                    comparison = a.total_videos - b.total_videos;
                    break;
                case 'completion_rate':
                    comparison = getCompletionRate(a) - getCompletionRate(b);
                    break;
            }

            return sortOrder === 'asc' ? comparison : -comparison;
        });

        return result;
    }, [tasks, filters, sortField, sortOrder]);

    // Pagination
    const totalPages = Math.ceil(filteredAndSortedTasks.length / itemsPerPage);
    const paginatedTasks = filteredAndSortedTasks.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const completedTasksCount = tasks.filter(t => t.status === 'completed').length;

    const getSortIcon = (field: SortField) => {
        if (sortField !== field) return <ChevronDown className="w-4 h-4 opacity-30" />;
        return sortOrder === 'asc' ?
            <ChevronUp className="w-4 h-4" /> :
            <ChevronDown className="w-4 h-4" />;
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="min-h-screen bg-slate-50 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="bg-gradient-to-br from-primary to-secondary p-3 rounded-xl shadow-lg shadow-primary/20">
                            <Database className="w-8 h-8 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">
                                {language === 'zh' ? '向量库管理' : 'Vector Library Manager'}
                            </h1>
                            <p className="text-sm text-slate-500">
                                {language === 'zh' ? '管理视频评估结果的向量化入库' : 'Manage vectorization of video evaluation results'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    {/* Vector Count */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                                <Database className="w-6 h-6 text-blue-600" />
                            </div>
                        </div>
                        <div className="text-3xl font-bold text-slate-900 mb-1">
                            {vectorStats?.total_vectors || 0}
                        </div>
                        <div className="text-sm text-slate-500">
                            {language === 'zh' ? '向量总数' : 'Total Vectors'}
                        </div>
                    </div>

                    {/* Dimension */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                                <RefreshCw className="w-6 h-6 text-purple-600" />
                            </div>
                        </div>
                        <div className="text-3xl font-bold text-slate-900 mb-1">
                            {vectorStats?.dimension || 768}
                        </div>
                        <div className="text-sm text-slate-500 flex items-center gap-1">
                            <span>{language === 'zh' ? '向量维度' : 'Vector Dimension'}</span>
                            <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">BGE-ZH</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                            {language === 'zh' ? '每个向量的特征数量' : 'Number of features per vector'}
                        </div>
                    </div>

                    {/* Collection */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                                <CheckCircle className="w-6 h-6 text-green-600" />
                            </div>
                        </div>
                        <div className="text-lg font-bold text-slate-900 mb-1">
                            {vectorStats?.collection_name || 'beeeval'}
                        </div>
                        <div className="text-sm text-slate-500">
                            {language === 'zh' ? '集合名称' : 'Collection Name'}
                        </div>
                    </div>
                </div>

                {/* Task Selection & Filters */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-6">
                    {/* Toolbar */}
                    <div className="p-6 border-b border-slate-100">
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                            {/* Left: Selection info and filter toggle */}
                            <div className="flex items-center gap-3 flex-wrap">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={selectedTasks.size === filteredAndSortedTasks.length && filteredAndSortedTasks.length > 0}
                                        onChange={handleSelectAll}
                                        disabled={filteredAndSortedTasks.length === 0}
                                        className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                                    />
                                    <span className="font-semibold text-slate-700">
                                        {language === 'zh' ? '选择任务' : 'Select Tasks'}
                                    </span>
                                </div>
                                <span className="text-sm text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                                    {selectedTasks.size} / {filteredAndSortedTasks.length} {language === 'zh' ? '已选择' : 'selected'}
                                </span>
                                <button
                                    onClick={() => setShowFilterPanel(!showFilterPanel)}
                                    className={clsx(
                                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors",
                                        showFilterPanel ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-100"
                                    )}
                                >
                                    <Filter className="w-4 h-4" />
                                    {language === 'zh' ? '筛选' : 'Filter'}
                                </button>
                            </div>

                            {/* Right: Vectorize button */}
                            <button
                                onClick={handleVectorize}
                                disabled={selectedTasks.size === 0 || vectorizing}
                                className="flex items-center justify-center gap-2 px-6 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                            >
                                {vectorizing ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        {language === 'zh' ? '处理中...' : 'Processing...'}
                                    </>
                                ) : (
                                    <>
                                        <Upload className="w-5 h-5" />
                                        {language === 'zh' ? '开始向量化' : 'Vectorize Selected'}
                                    </>
                                )}
                            </button>
                        </div>

                        {/* Filter Panel */}
                        {showFilterPanel && (
                            <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                    {/* Status Filter */}
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                            {language === 'zh' ? '任务状态' : 'Status'}
                                        </label>
                                        <select
                                            value={filters.status}
                                            onChange={(e) => setFilters({ ...filters, status: e.target.value as StatusFilter })}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-primary focus:border-primary"
                                        >
                                            <option value="all">{language === 'zh' ? '全部' : 'All'}</option>
                                            <option value="completed">{language === 'zh' ? '已完成' : 'Completed'}</option>
                                            <option value="processing">{language === 'zh' ? '处理中' : 'Processing'}</option>
                                            <option value="pending">{language === 'zh' ? '待处理' : 'Pending'}</option>
                                        </select>
                                    </div>

                                    {/* Min Videos */}
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                            {language === 'zh' ? '最少视频数' : 'Min Videos'}
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={filters.minVideos || ''}
                                            onChange={(e) => setFilters({ ...filters, minVideos: parseInt(e.target.value) || 0 })}
                                            placeholder={language === 'zh' ? '不限' : 'Any'}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-primary focus:border-primary"
                                        />
                                    </div>

                                    {/* Min Completion Rate */}
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                            {language === 'zh' ? '最低完成率' : 'Min Completion'}
                                        </label>
                                        <select
                                            value={filters.minCompletionRate}
                                            onChange={(e) => setFilters({ ...filters, minCompletionRate: parseInt(e.target.value) })}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-primary focus:border-primary"
                                        >
                                            <option value="0">{language === 'zh' ? '不限' : 'Any'}</option>
                                            <option value="50">50%+</option>
                                            <option value="80">80%+</option>
                                            <option value="90">90%+</option>
                                            <option value="100">100%</option>
                                        </select>
                                    </div>

                                    {/* Search */}
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                            {language === 'zh' ? '搜索' : 'Search'}
                                        </label>
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <input
                                                type="text"
                                                value={filters.searchQuery}
                                                onChange={(e) => setFilters({ ...filters, searchQuery: e.target.value })}
                                                placeholder={language === 'zh' ? '任务 ID 或路径...' : 'Task ID or path...'}
                                                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-primary focus:border-primary"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Reset Filters */}
                                <div className="mt-4 flex justify-end">
                                    <button
                                        onClick={() => setFilters({
                                            status: 'completed',
                                            minVideos: 0,
                                            minCompletionRate: 0,
                                            searchQuery: ''
                                        })}
                                        className="text-sm text-slate-600 hover:text-slate-800 flex items-center gap-1"
                                    >
                                        <RefreshCw className="w-3.5 h-3.5" />
                                        {language === 'zh' ? '重置筛选' : 'Reset Filters'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Result Banner */}
                        {result && (
                            <div className={clsx(
                                "mt-4 p-4 flex items-center gap-3 rounded-xl",
                                result.failed_count > 0 ? "bg-amber-50" : "bg-green-50"
                            )}>
                                {result.failed_count > 0 ? (
                                    <AlertCircle className="w-5 h-5 text-amber-600" />
                                ) : (
                                    <CheckCircle className="w-5 h-5 text-green-600" />
                                )}
                                <span className="text-sm font-medium">
                                    {language === 'zh'
                                        ? `成功入库 ${result.vectorized_count} 条，跳过 ${result.skipped_count} 条`
                                        : `Vectorized ${result.vectorized_count}, skipped ${result.skipped_count}`}
                                    {result.failed_count > 0 && `, 失败 ${result.failed_count} 条`}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Task Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-100">
                                <tr>
                                    <th className="px-6 py-3 text-left">
                                        <input
                                            type="checkbox"
                                            checked={selectedTasks.size === paginatedTasks.length && paginatedTasks.length > 0}
                                            onChange={handleSelectAll}
                                            disabled={paginatedTasks.length === 0}
                                            className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                                        />
                                    </th>
                                    <th
                                        className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100"
                                        onClick={() => handleSort('created_at')}
                                    >
                                        <div className="flex items-center gap-1">
                                            {language === 'zh' ? '任务 ID' : 'Task ID'}
                                            {getSortIcon('created_at')}
                                        </div>
                                    </th>
                                    <th
                                        className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100"
                                        onClick={() => handleSort('total_videos')}
                                    >
                                        <div className="flex items-center gap-1">
                                            {language === 'zh' ? '视频进度' : 'Video Progress'}
                                            {getSortIcon('total_videos')}
                                        </div>
                                    </th>
                                    <th
                                        className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100"
                                        onClick={() => handleSort('completion_rate')}
                                    >
                                        <div className="flex items-center gap-1">
                                            {language === 'zh' ? '完成率' : 'Completion'}
                                            {getSortIcon('completion_rate')}
                                        </div>
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                        {language === 'zh' ? '创建时间' : 'Created At'}
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                        {language === 'zh' ? '状态' : 'Status'}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {paginatedTasks.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                                            <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                            {language === 'zh' ? '暂无符合条件的任务' : 'No tasks match the filters'}
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedTasks.map((task) => (
                                        <tr
                                            key={task.id}
                                            className={clsx(
                                                "hover:bg-slate-50 transition-colors",
                                                task.status !== 'completed' && "opacity-60"
                                            )}
                                        >
                                            <td className="px-6 py-4">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedTasks.has(task.id)}
                                                    onChange={() => task.status === 'completed' && handleToggleTask(task.id)}
                                                    disabled={task.status !== 'completed'}
                                                    className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                                                />
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="font-medium text-slate-700 text-sm truncate max-w-xs" title={task.id}>
                                                    {task.id}
                                                </div>
                                                <div className="text-xs text-slate-400 truncate max-w-xs" title={task.folder_path}>
                                                    {task.folder_path}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-sm text-slate-600">
                                                    {task.completed_videos} / {task.total_videos}
                                                </div>
                                                <div className="w-24 h-1.5 bg-slate-200 rounded-full mt-1 overflow-hidden">
                                                    <div
                                                        className="h-full bg-primary rounded-full transition-all"
                                                        style={{ width: `${getCompletionRate(task)}%` }}
                                                    />
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={clsx(
                                                    "text-sm font-medium",
                                                    getCompletionRate(task) === 100 ? "text-green-600" :
                                                    getCompletionRate(task) >= 80 ? "text-blue-600" :
                                                    "text-slate-500"
                                                )}>
                                                    {getCompletionRate(task).toFixed(0)}%
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-500">
                                                {formatDate(task.created_at)}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={clsx(
                                                    "px-2.5 py-1 rounded-full text-xs font-medium",
                                                    task.status === 'completed' ? "bg-green-100 text-green-700" :
                                                    task.status === 'processing' ? "bg-blue-100 text-blue-700" :
                                                    "bg-slate-100 text-slate-600"
                                                )}>
                                                    {task.status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="p-4 border-t border-slate-100 flex items-center justify-between flex-wrap gap-4">
                            {/* Items per page */}
                            <div className="flex items-center gap-2 text-sm text-slate-600">
                                <span>{language === 'zh' ? '每页显示' : 'Show'}:</span>
                                <select
                                    value={itemsPerPage}
                                    onChange={(e) => setItemsPerPage(parseInt(e.target.value))}
                                    className="px-2 py-1 border border-slate-300 rounded-lg focus:ring-primary focus:border-primary"
                                >
                                    {PAGE_OPTIONS.map(option => (
                                        <option key={option} value={option}>{option}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Page info */}
                            <div className="text-sm text-slate-600">
                                {language === 'zh'
                                    ? `第 ${currentPage} 页，共 ${totalPages} 页（${filteredAndSortedTasks.length} 条任务）`
                                    : `Page ${currentPage} of ${totalPages} (${filteredAndSortedTasks.length} tasks)`
                                }
                            </div>

                            {/* Page navigation */}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setCurrentPage(1)}
                                    disabled={currentPage === 1}
                                    className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {language === 'zh' ? '首页' : 'First'}
                                </button>
                                <button
                                    onClick={() => setCurrentPage(currentPage - 1)}
                                    disabled={currentPage === 1}
                                    className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {language === 'zh' ? '上一页' : 'Previous'}
                                </button>

                                {/* Page numbers */}
                                <div className="flex items-center gap-1">
                                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                        let pageNum;
                                        if (totalPages <= 5) {
                                            pageNum = i + 1;
                                        } else if (currentPage <= 3) {
                                            pageNum = i + 1;
                                        } else if (currentPage >= totalPages - 2) {
                                            pageNum = totalPages - 4 + i;
                                        } else {
                                            pageNum = currentPage - 2 + i;
                                        }

                                        return (
                                            <button
                                                key={pageNum}
                                                onClick={() => setCurrentPage(pageNum)}
                                                className={clsx(
                                                    "w-8 h-8 text-sm rounded-lg transition-colors",
                                                    currentPage === pageNum
                                                        ? "bg-primary text-white"
                                                        : "hover:bg-slate-100 text-slate-600"
                                                )}
                                            >
                                                {pageNum}
                                            </button>
                                        );
                                    })}
                                </div>

                                <button
                                    onClick={() => setCurrentPage(currentPage + 1)}
                                    disabled={currentPage === totalPages}
                                    className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {language === 'zh' ? '下一页' : 'Next'}
                                </button>
                                <button
                                    onClick={() => setCurrentPage(totalPages)}
                                    disabled={currentPage === totalPages}
                                    className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {language === 'zh' ? '末页' : 'Last'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Quick Actions */}
                <div className="flex items-center justify-between mb-8">
                    <div className="text-sm text-slate-500">
                        {language === 'zh'
                            ? `共 ${tasks.length} 个任务，${completedTasksCount} 个已完成，${selectedTasks.size} 个已选择`
                            : `Total: ${tasks.length} tasks, ${completedTasksCount} completed, ${selectedTasks.size} selected`
                        }
                    </div>
                    <button
                        onClick={fetchTasks}
                        className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-800 hover:bg-white transition-colors rounded-lg border border-transparent hover:border-slate-200"
                    >
                        <RefreshCw className="w-4 h-4" />
                        {language === 'zh' ? '刷新列表' : 'Refresh'}
                    </button>
                </div>

                {/* ===== Vector Data Browser ===== */}
                <VectorBrowser
                    language={language}
                    onStatsChange={fetchVectorStats}
                />
            </div>
        </div>
    );
};

/* ==================== Vector Data Browser Component ==================== */

const VEC_PAGE_SIZE = 20;

const VectorBrowser = ({ language, onStatsChange }: { language: string; onStatsChange: () => void }) => {
    const [points, setPoints] = useState<VectorPoint[]>([]);
    const [total, setTotal] = useState(0);
    const [nextOffset, setNextOffset] = useState<string | null>(null);
    const [offsets, setOffsets] = useState<(string | undefined)[]>([undefined]);
    const [pageIdx, setPageIdx] = useState(0);
    const [loading, setLoading] = useState(false);

    const [facets, setFacets] = useState<{ video_names: string[]; brand_models: string[]; function_domains: string[] }>({ video_names: [], brand_models: [], function_domains: [] });
    const [filterVideoName, setFilterVideoName] = useState('');
    const [filterBrandModel, setFilterBrandModel] = useState('');
    const [filterDomain, setFilterDomain] = useState('');

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [detailPoint, setDetailPoint] = useState<VectorPoint | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [clearing, setClearing] = useState(false);

    const fetchPage = useCallback(async (offset?: string) => {
        setLoading(true);
        try {
            const params: Record<string, any> = { limit: VEC_PAGE_SIZE };
            if (offset) params.offset = offset;
            if (filterVideoName) params.video_name = filterVideoName;
            if (filterBrandModel) params.brand_model = filterBrandModel;
            if (filterDomain) params.function_domain = filterDomain;
            const res = await listVectors(params);
            setPoints(res.points);
            setTotal(res.total);
            setNextOffset(res.next_offset);
        } catch (e) {
            console.error('Failed to list vectors', e);
        } finally {
            setLoading(false);
        }
    }, [filterVideoName, filterBrandModel, filterDomain]);

    useEffect(() => {
        fetchPage();
        setPageIdx(0);
        setOffsets([undefined]);
        setSelectedIds(new Set());
    }, [fetchPage]);

    useEffect(() => {
        getVectorFacets().then(setFacets).catch(() => {});
    }, []);

    const handleNext = () => {
        if (!nextOffset) return;
        const newIdx = pageIdx + 1;
        const newOffsets = [...offsets];
        if (newOffsets.length <= newIdx) newOffsets.push(nextOffset);
        setOffsets(newOffsets);
        setPageIdx(newIdx);
        fetchPage(nextOffset);
        setSelectedIds(new Set());
    };

    const handlePrev = () => {
        if (pageIdx === 0) return;
        const newIdx = pageIdx - 1;
        setPageIdx(newIdx);
        fetchPage(offsets[newIdx]);
        setSelectedIds(new Set());
    };

    const toggleSelect = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelectedIds(next);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === points.length && points.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(points.map(p => p.id)));
        }
    };

    const handleDeleteSelected = async () => {
        if (selectedIds.size === 0) return;
        const msg = language === 'zh'
            ? `确定要删除选中的 ${selectedIds.size} 条向量数据吗？此操作不可撤销。`
            : `Delete ${selectedIds.size} selected vectors? This cannot be undone.`;
        if (!confirm(msg)) return;
        setDeleting(true);
        try {
            await deleteVectorsBatch(Array.from(selectedIds));
            setSelectedIds(new Set());
            await fetchPage(offsets[pageIdx]);
            onStatsChange();
        } catch (e) {
            console.error('Delete failed', e);
            alert(language === 'zh' ? '删除失败' : 'Delete failed');
        } finally {
            setDeleting(false);
        }
    };

    const handleClear = async () => {
        const msg = language === 'zh'
            ? '⚠️ 确定要清空整个向量库吗？所有向量数据将被永久删除，此操作不可撤销！'
            : '⚠️ Clear the entire vector database? All data will be permanently deleted!';
        if (!confirm(msg)) return;
        const msg2 = language === 'zh' ? '请再次确认：输入 "清空" 以继续' : 'Type "CLEAR" to confirm';
        const input = prompt(msg2);
        if (input !== (language === 'zh' ? '清空' : 'CLEAR')) return;
        setClearing(true);
        try {
            await clearVectors();
            setPoints([]);
            setTotal(0);
            setNextOffset(null);
            setOffsets([undefined]);
            setPageIdx(0);
            setSelectedIds(new Set());
            onStatsChange();
            getVectorFacets().then(setFacets).catch(() => {});
        } catch (e) {
            console.error('Clear failed', e);
            alert(language === 'zh' ? '清空失败' : 'Clear failed');
        } finally {
            setClearing(false);
        }
    };

    const resetFilters = () => {
        setFilterVideoName('');
        setFilterBrandModel('');
        setFilterDomain('');
    };

    const hasFilters = filterVideoName || filterBrandModel || filterDomain;

    return (
        <>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                {/* Header */}
                <div className="p-6 border-b border-slate-100">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                                <Eye className="w-5 h-5 text-indigo-600" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-slate-900">
                                    {language === 'zh' ? '向量数据浏览器' : 'Vector Data Browser'}
                                </h2>
                                <p className="text-xs text-slate-500">
                                    {language === 'zh' ? '查看、筛选和管理向量库中的数据' : 'Browse, filter & manage vector data'}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {selectedIds.size > 0 && (
                                <button
                                    onClick={handleDeleteSelected}
                                    disabled={deleting}
                                    className="flex items-center gap-1.5 px-3 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 disabled:opacity-50"
                                >
                                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                    {language === 'zh' ? `删除 (${selectedIds.size})` : `Delete (${selectedIds.size})`}
                                </button>
                            )}
                            <a
                                href="/api/rag/export?with_vectors=true"
                                download
                                className={clsx(
                                    "flex items-center gap-1.5 px-3 py-2 border border-indigo-200 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-50 transition-colors",
                                    total === 0 && "opacity-30 pointer-events-none"
                                )}
                            >
                                <Download className="w-4 h-4" />
                                {language === 'zh' ? '导出' : 'Export'}
                            </a>
                            <button
                                onClick={handleClear}
                                disabled={clearing || total === 0}
                                className="flex items-center gap-1.5 px-3 py-2 border border-red-200 text-red-500 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                                {language === 'zh' ? '清空向量库' : 'Clear All'}
                            </button>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="flex flex-wrap gap-3 items-center">
                        <select value={filterBrandModel} onChange={e => setFilterBrandModel(e.target.value)} className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="">{language === 'zh' ? '全部车型' : 'All Models'}</option>
                            {facets.brand_models.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <select value={filterDomain} onChange={e => setFilterDomain(e.target.value)} className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="">{language === 'zh' ? '全部功能域' : 'All Domains'}</option>
                            {facets.function_domains.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                        <select value={filterVideoName} onChange={e => setFilterVideoName(e.target.value)} className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-500 max-w-[260px]">
                            <option value="">{language === 'zh' ? '全部视频' : 'All Videos'}</option>
                            {facets.video_names.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                        {hasFilters && (
                            <button onClick={resetFilters} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
                                <RefreshCw className="w-3 h-3" /> {language === 'zh' ? '重置' : 'Reset'}
                            </button>
                        )}
                        <span className="ml-auto text-xs text-slate-400">{total} {language === 'zh' ? '条向量' : 'vectors'}</span>
                    </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
                            <tr>
                                <th className="px-4 py-3 w-10">
                                    <button onClick={toggleSelectAll}>
                                        {selectedIds.size === points.length && points.length > 0
                                            ? <CheckSquare className="w-4 h-4 text-indigo-600" />
                                            : <Square className="w-4 h-4 text-slate-300" />}
                                    </button>
                                </th>
                                <th className="px-4 py-3">{language === 'zh' ? '视频名称' : 'Video'}</th>
                                <th className="px-4 py-3">{language === 'zh' ? '用户问题' : 'Question'}</th>
                                <th className="px-4 py-3 w-24">{language === 'zh' ? '车型' : 'Model'}</th>
                                <th className="px-4 py-3 w-24">{language === 'zh' ? '功能域' : 'Domain'}</th>
                                <th className="px-4 py-3 w-20 text-right">{language === 'zh' ? '操作' : 'Actions'}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading ? (
                                <tr><td colSpan={6} className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin text-indigo-500 mx-auto" /></td></tr>
                            ) : points.length === 0 ? (
                                <tr><td colSpan={6} className="text-center py-16 text-slate-400">
                                    <Database className="w-10 h-10 mx-auto mb-2 opacity-40" />
                                    {language === 'zh' ? '向量库为空' : 'No vectors found'}
                                </td></tr>
                            ) : points.map(p => (
                                <tr key={p.id} className={clsx("hover:bg-slate-50 transition-colors", selectedIds.has(p.id) && "bg-indigo-50/40")}>
                                    <td className="px-4 py-3">
                                        <button onClick={() => toggleSelect(p.id)}>
                                            {selectedIds.has(p.id)
                                                ? <CheckSquare className="w-4 h-4 text-indigo-600" />
                                                : <Square className="w-4 h-4 text-slate-300" />}
                                        </button>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-slate-800 truncate max-w-[200px]" title={p.video_name}>{p.video_name}</div>
                                        <div className="text-[10px] text-slate-400 font-mono">{p.id}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="text-slate-700 line-clamp-2 max-w-[280px]" title={p.user_question}>{p.user_question || '-'}</div>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-500">{p.brand_model || '-'}</td>
                                    <td className="px-4 py-3 text-xs text-slate-500">{p.function_domain || '-'}</td>
                                    <td className="px-4 py-3 text-right">
                                        <button
                                            onClick={() => setDetailPoint(p)}
                                            className="p-1.5 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded transition-colors"
                                            title={language === 'zh' ? '查看详情' : 'View detail'}
                                        >
                                            <Eye className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="p-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
                    <span>{language === 'zh' ? `第 ${pageIdx + 1} 页` : `Page ${pageIdx + 1}`}</span>
                    <div className="flex items-center gap-2">
                        <button onClick={handlePrev} disabled={pageIdx === 0} className="px-2 py-1 rounded border border-slate-300 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1">
                            <ChevronLeft className="w-3 h-3" /> {language === 'zh' ? '上一页' : 'Prev'}
                        </button>
                        <button onClick={handleNext} disabled={!nextOffset} className="px-2 py-1 rounded border border-slate-300 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1">
                            {language === 'zh' ? '下一页' : 'Next'} <ChevronRight className="w-3 h-3" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Detail / Edit Modal */}
            {detailPoint && (
                <VectorEditModal
                    language={language}
                    point={detailPoint}
                    onClose={() => setDetailPoint(null)}
                    onSaved={() => { fetchPage(offsets[pageIdx]); onStatsChange(); }}
                />
            )}
        </>
    );
};

/* ==================== Vector Edit Modal ==================== */

const SEMANTIC_FIELDS = new Set(['user_question', 'system_response', 'summary']);

const VectorEditModal = ({ language, point, onClose, onSaved }: {
    language: string;
    point: VectorPoint;
    onClose: () => void;
    onSaved: () => void;
}) => {
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState({ ...point });
    const [saving, setSaving] = useState(false);
    const [semanticChanged, setSemanticChanged] = useState(false);

    const set = (key: string, val: string) => {
        setForm(prev => ({ ...prev, [key]: val }));
        if (SEMANTIC_FIELDS.has(key)) {
            setSemanticChanged(true);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateVector(point.id, {
                video_name: form.video_name,
                user_question: form.user_question,
                system_response: form.system_response,
                summary: form.summary,
                case_id: form.case_id,
                brand_model: form.brand_model,
                system_version: form.system_version,
                function_domain: form.function_domain,
                scenario: form.scenario,
                sequence: form.sequence,
                created_at: form.created_at,
                re_embed: semanticChanged,
            });
            setEditing(false);
            setSemanticChanged(false);
            onSaved();
        } catch (e) {
            console.error('Save failed', e);
            alert(language === 'zh' ? '保存失败' : 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => {
        setForm({ ...point });
        setEditing(false);
        setSemanticChanged(false);
    };

    const fields: { key: keyof VectorPoint; label_zh: string; label_en: string; long?: boolean }[] = [
        { key: 'video_name', label_zh: '视频名称', label_en: 'Video' },
        { key: 'case_id', label_zh: '用例 ID', label_en: 'Case ID' },
        { key: 'brand_model', label_zh: '品牌车型', label_en: 'Model' },
        { key: 'system_version', label_zh: '系统版本', label_en: 'Version' },
        { key: 'function_domain', label_zh: '功能域', label_en: 'Domain' },
        { key: 'scenario', label_zh: '场景', label_en: 'Scenario' },
        { key: 'user_question', label_zh: '用户问题', label_en: 'User Question', long: true },
        { key: 'system_response', label_zh: '系统回复', label_en: 'System Response', long: true },
        { key: 'summary', label_zh: '评估总结', label_en: 'Summary', long: true },
        { key: 'created_at', label_zh: '创建时间', label_en: 'Created' },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50 rounded-t-2xl sticky top-0 z-10">
                    <div>
                        <h3 className="font-bold text-slate-900">{language === 'zh' ? (editing ? '编辑向量' : '向量详情') : (editing ? 'Edit Vector' : 'Vector Detail')}</h3>
                        <p className="text-xs text-slate-400 font-mono mt-1">ID: {point.id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {!editing ? (
                            <button onClick={() => setEditing(true)} className="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors">
                                {language === 'zh' ? '编辑' : 'Edit'}
                            </button>
                        ) : (
                            <>
                                <button onClick={handleCancel} className="px-3 py-1.5 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">
                                    {language === 'zh' ? '取消' : 'Cancel'}
                                </button>
                                <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
                                    {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                                    {language === 'zh' ? '保存' : 'Save'}
                                </button>
                            </>
                        )}
                        <button onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded-full text-slate-500"><X className="w-5 h-5" /></button>
                    </div>
                </div>
                <div className="p-6 space-y-4">
                    {editing && semanticChanged && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>{language === 'zh'
                                ? '你修改了语义字段（问题/回复/总结），保存时将自动重新生成 embedding 向量。'
                                : 'Semantic fields changed. Embedding will be re-generated on save.'}</span>
                        </div>
                    )}

                    {fields.map(f => (
                        <div key={f.key}>
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                                {language === 'zh' ? f.label_zh : f.label_en}
                                {editing && SEMANTIC_FIELDS.has(f.key) && (
                                    <span className="text-[9px] bg-amber-100 text-amber-600 px-1 rounded">semantic</span>
                                )}
                            </div>
                            {editing ? (
                                f.long ? (
                                    <textarea
                                        value={(form as any)[f.key] || ''}
                                        onChange={e => set(f.key, e.target.value)}
                                        rows={3}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-y"
                                    />
                                ) : (
                                    <input
                                        type="text"
                                        value={(form as any)[f.key] || ''}
                                        onChange={e => set(f.key, e.target.value)}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                    />
                                )
                            ) : (
                                f.long ? (
                                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-sm text-slate-700 whitespace-pre-wrap">{(point as any)[f.key] || '-'}</div>
                                ) : (
                                    <div className="text-sm text-slate-800">{(point as any)[f.key] || '-'}</div>
                                )
                            )}
                        </div>
                    ))}

                    {/* Evaluations (read-only) */}
                    {point.evaluations && point.evaluations.length > 0 && (
                        <div>
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{language === 'zh' ? '评估指标' : 'Evaluations'}</div>
                            <div className="space-y-2">
                                {point.evaluations.map((ev: any, i: number) => (
                                    <div key={i} className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-sm">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="font-medium text-slate-700">{ev.metric_name || ev.criteria || `Metric ${i + 1}`}</span>
                                            <span className={clsx("px-2 py-0.5 rounded text-xs font-bold",
                                                (ev.score || 0) >= 4 ? "bg-emerald-100 text-emerald-700" :
                                                (ev.score || 0) >= 3 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"
                                            )}>{ev.score ?? 'N/A'}</span>
                                        </div>
                                        {ev.feedback && <p className="text-xs text-slate-600">{ev.feedback}</p>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default VectorManager;
