import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getTasks, deleteTasksBatch } from '../api';
import { AnalysisTask } from '../types';
import { Clock, CheckCircle2, AlertCircle, Loader2, Trash2, CheckSquare, Square, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const PAGE_SIZE = 20;

const History = () => {
    const [tasks, setTasks] = useState<AnalysisTask[]>([]);
    const [total, setTotal] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deletingBatch, setDeletingBatch] = useState(false);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const fetchTasks = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getTasks({
                offset: (currentPage - 1) * PAGE_SIZE,
                limit: PAGE_SIZE,
            });
            setTasks(res.data);
            setTotal(res.total);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [currentPage]);

    useEffect(() => {
        fetchTasks();
    }, [fetchTasks]);

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
        if (selectedIds.size === tasks.length && tasks.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(tasks.map(t => t.id)));
        }
    };

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!window.confirm(`Are you sure you want to delete ${selectedIds.size} tasks? This will also delete all associated analysis results.`)) return;
        
        setDeletingBatch(true);
        try {
            await deleteTasksBatch(Array.from(selectedIds));
            setSelectedIds(new Set());
            await fetchTasks();
        } catch (error) {
            console.error(error);
            alert("Failed to batch delete tasks");
        } finally {
            setDeletingBatch(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="p-8 space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-3xl font-bold text-slate-900">Analysis History</h2>
                    <p className="text-slate-500 mt-2">View past analysis tasks and reports.</p>
                </div>
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
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-sm text-slate-600">
                    <thead className="bg-slate-50 text-slate-700 uppercase font-semibold">
                        <tr>
                            <th className="px-6 py-4 w-12">
                                <button 
                                    onClick={toggleSelectAll}
                                    className="hover:text-blue-600 flex items-center"
                                >
                                    {tasks.length > 0 && selectedIds.size === tasks.length ? 
                                        <CheckSquare className="w-5 h-5 text-blue-600" /> : 
                                        <Square className="w-5 h-5" />
                                    }
                                </button>
                            </th>
                            <th className="px-6 py-4">Status</th>
                            <th className="px-6 py-4">Folder Path</th>
                            <th className="px-6 py-4">Videos</th>
                            <th className="px-6 py-4">Date</th>
                            <th className="px-6 py-4">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                        {tasks.map((task) => (
                            <tr 
                                key={task.id} 
                                className={clsx(
                                    "hover:bg-slate-50 transition-colors",
                                    selectedIds.has(task.id) && "bg-blue-50/30"
                                )}
                            >
                                <td className="px-6 py-4">
                                    <button 
                                        onClick={() => toggleSelect(task.id)}
                                        className="hover:text-blue-600"
                                    >
                                        {selectedIds.has(task.id) ? 
                                            <CheckSquare className="w-5 h-5 text-blue-600" /> : 
                                            <Square className="w-5 h-5 text-slate-300" />
                                        }
                                    </button>
                                </td>
                                <td className="px-6 py-4">
                                    <div className={clsx(
                                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                                        task.status === 'completed' ? "bg-emerald-100 text-emerald-700" :
                                        task.status === 'processing' ? "bg-blue-100 text-blue-700" :
                                        task.status === 'failed' ? "bg-rose-100 text-rose-700" :
                                        "bg-slate-100 text-slate-700"
                                    )}>
                                        {task.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5" />}
                                        {task.status === 'processing' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                        {task.status === 'failed' && <AlertCircle className="w-3.5 h-3.5" />}
                                        <span className="capitalize">{task.status === 'completed' ? 'Finished' : task.status}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 font-mono text-xs text-slate-500 max-w-xs truncate" title={task.folder_path}>
                                    {task.folder_path}
                                </td>
                                <td className="px-6 py-4">
                                    {task.completed_videos} / {task.total_videos}
                                </td>
                                <td className="px-6 py-4 text-slate-500">
                                    <div className="flex items-center gap-2">
                                        <Clock className="w-4 h-4 text-slate-400" />
                                        {format(new Date(task.created_at), 'MMM d, yyyy HH:mm')}
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <Link 
                                        to={`/results/${task.id}`}
                                        className="text-blue-600 hover:text-blue-800 font-medium hover:underline"
                                    >
                                        View Details
                                    </Link>
                                </td>
                            </tr>
                        ))}
                        {tasks.length === 0 && (
                            <tr>
                                <td colSpan={6} className="text-center py-12 text-slate-400 italic">
                                    No history found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                <div className="p-4 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 flex justify-between items-center">
                    <span>Showing {tasks.length} of {total} tasks (Page {currentPage}/{totalPages})</span>
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
        </div>
    );
};

export default History;
