import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getAllResults, getVideoUrl, getNasVideoUrl, getFilterOptions } from '../api';
import { Loader2, Filter, Star, Info, PlayCircle, X, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import SmartText from '../components/SmartText';

const PAGE_SIZE = 30;

const TestCases = () => {
    const { t } = useTranslation();
    const [results, setResults] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(true);
    const [selectedModel, setSelectedModel] = useState<string>('all');
    const [selectedDomain, setSelectedDomain] = useState<string>('all');
    const [selectedCase, setSelectedCase] = useState<string>('all');

    const [selectedResult, setSelectedResult] = useState<any | null>(null);
    const [models, setModels] = useState<string[]>([]);
    const [domains, setDomains] = useState<string[]>([]);

    useEffect(() => {
        getFilterOptions().then(opts => {
            setModels(opts.brand_models);
            setDomains(opts.function_domains);
        }).catch(() => {});
    }, []);

    const fetchData = useCallback(async (pageNum: number) => {
        setLoading(true);
        try {
            const params: Record<string, any> = {
                offset: pageNum * PAGE_SIZE,
                limit: PAGE_SIZE,
            };
            if (selectedModel !== 'all') params.brand_model = selectedModel;
            if (selectedDomain !== 'all') params.function_domain = selectedDomain;
            if (selectedCase !== 'all') params.search = selectedCase;
            const res = await getAllResults(params);
            setResults(res.data);
            setTotal(res.total);
        } catch (error) {
            console.error("Failed to load results", error);
        } finally {
            setLoading(false);
        }
    }, [selectedModel, selectedDomain, selectedCase]);

    useEffect(() => {
        setPage(0);
        fetchData(0);
    }, [fetchData]);

    const getCarModel = (name: string) => name.split('-')[0]?.replace(/^\d+/, '') || 'Other';

    const getTestCaseName = (name: string) => name.replace(/\.(mp4|mov|avi|mkv)$/i, '');

    const totalPages = Math.ceil(total / PAGE_SIZE);
    const filteredResults = results;

    return (
        <div className="p-8 h-screen flex flex-col overflow-hidden bg-slate-50 relative">
            <header className="mb-8 shrink-0">
                <h2 className="text-3xl font-bold text-slate-900">{t('test_case_library')}</h2>
                <p className="text-slate-500 mt-2">{t('description')}</p>
            </header>

            {/* Filters */}
            <div className="flex flex-wrap gap-4 mb-6 shrink-0 bg-white p-4 rounded-xl shadow-sm border border-slate-200 items-center">
                <Filter className="w-5 h-5 text-slate-400" />
                <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-700 text-sm">{t('filter_by_model')}:</span>
                    <select
                        value={selectedModel}
                        onChange={e => {
                            setSelectedModel(e.target.value);
                            setSelectedDomain('all');
                            setSelectedCase('all');
                        }}
                        className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="all">{t('all_models')}</option>
                        {models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>

                <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-700 text-sm">Domain:</span>
                    <select
                        value={selectedDomain}
                        onChange={e => {
                            setSelectedDomain(e.target.value);
                            setSelectedCase('all');
                        }}
                        className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="all">All Domains</option>
                        {domains.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                </div>

                <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-700 text-sm">{t('filter_by_case')}:</span>
                    <input
                        type="text"
                        value={selectedCase === 'all' ? '' : selectedCase}
                        onChange={e => setSelectedCase(e.target.value || 'all')}
                        placeholder={t('all_cases')}
                        className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 w-48"
                    />
                </div>

                <span className="text-xs text-slate-400 ml-auto">{total} {t('total')}</span>
            </div>

            {/* Content Grid */}
            <div className="flex-1 overflow-y-auto pr-2 pb-4">
                {loading ? (
                    <div className="flex justify-center items-center h-64">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                    </div>
                ) : filteredResults.length === 0 ? (
                    <div className="text-center text-slate-400 py-20 bg-white rounded-xl border border-slate-200 border-dashed">
                        {t('no_results')}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                        {filteredResults.map(result => (
                            <div
                                key={result.id}
                                className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow group cursor-pointer"
                                onClick={() => setSelectedResult(result)}
                            >
                                {/* Card Header */}
                                <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-start">
                                    <div>
                                        <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">
                                            {getCarModel(result.video_name)}
                                        </div>
                                        <h3 className="font-semibold text-slate-900 line-clamp-1" title={result.video_name}>
                                            {getTestCaseName(result.video_name)}
                                        </h3>
                                    </div>
                                    <div className={clsx(
                                        "px-2 py-1 rounded text-xs font-bold flex items-center gap-1",
                                        (result.metadata?.response_quality_score || 0) >= 4 ? "bg-emerald-100 text-emerald-700" :
                                            (result.metadata?.response_quality_score || 0) >= 3 ? "bg-amber-100 text-amber-700" :
                                                "bg-rose-100 text-rose-700"
                                    )}>
                                        <Star className="w-3 h-3 fill-current" />
                                        {result.metadata?.response_quality_score || 'N/A'}
                                    </div>
                                </div>

                                {/* Card Body */}
                                <div className="p-4 space-y-4">
                                    {/* Screenshot if available */}
                                    {result.metadata?.screenshot_path && (
                                        <div className="relative aspect-video bg-slate-100 rounded-lg overflow-hidden group-hover:ring-2 ring-blue-500/20 transition-all">
                                            <img
                                                src={result.metadata.screenshot_path}
                                                alt="Screenshot"
                                                className="w-full h-full object-cover"
                                            />
                                            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                                                <Info className="w-10 h-10 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-2">
                                        {/* Show User Question Preview instead of Summary */}
                                        <div className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block"></span>
                                            User Question
                                        </div>
                                        <p className="text-sm text-slate-700 font-medium leading-relaxed line-clamp-3" title={result.metadata?.user_question}>
                                            <SmartText text={result.metadata?.user_question || 'N/A'} />
                                        </p>
                                    </div>

                                    {/* Key Metrics */}
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div className="bg-slate-50 p-2 rounded border border-slate-100">
                                            <span className="text-slate-400 block mb-0.5">{t('latency')}</span>
                                            <span className="font-mono font-medium text-slate-700">
                                                {result.metadata?.latency_ms ? `${result.metadata.latency_ms}ms` : 'N/A'}
                                            </span>
                                        </div>
                                        <div className="bg-slate-50 p-2 rounded border border-slate-100">
                                            <span className="text-slate-400 block mb-0.5">{t('response')}</span>
                                            <span className="font-medium text-slate-700 truncate block" title={result.metadata?.system_response}>
                                                <SmartText text={result.metadata?.system_response || 'N/A'} />
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-3 mt-6 mb-2">
                        <button
                            onClick={() => { const p = page - 1; setPage(p); fetchData(p); }}
                            disabled={page === 0}
                            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-300 text-sm hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <ChevronLeft className="w-4 h-4" /> 上一页
                        </button>
                        <span className="text-sm text-slate-600 font-mono">
                            {page + 1} / {totalPages}
                        </span>
                        <button
                            onClick={() => { const p = page + 1; setPage(p); fetchData(p); }}
                            disabled={page + 1 >= totalPages}
                            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-300 text-sm hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            下一页 <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </div>

            {/* Detail Modal */}
            {selectedResult && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setSelectedResult(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 relative" onClick={e => e.stopPropagation()}>
                        {/* Modal Header */}
                        <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50">
                            <div>
                                <div className="flex items-center gap-3 mb-2">
                                    <span className="bg-primary text-white text-xs font-bold px-2 py-1 rounded uppercase tracking-wider shadow-sm">
                                        {getCarModel(selectedResult.video_name)}
                                    </span>
                                    <span className="text-slate-400 text-sm font-mono">{selectedResult.video_name}</span>
                                </div>
                                <h2 className="text-2xl font-bold text-slate-900">{getTestCaseName(selectedResult.video_name)}</h2>
                            </div>
                            <button
                                onClick={() => setSelectedResult(null)}
                                className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div className="flex-1 overflow-hidden relative">
                            <div className="flex flex-col md:grid md:grid-cols-3 h-full absolute inset-0 w-full">
                                {/* Left Column: Media & Core Info - Scrollable independently */}
                                <div className="md:col-span-1 bg-slate-50 p-6 border-r border-slate-100 space-y-6 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 h-full">
                                    {/* Video Player / Screenshot */}
                                    <div className="rounded-xl overflow-hidden shadow-sm bg-black aspect-video relative group">
                                        {/* Use video tag if path available, else image */}
                                        <video
                                            src={selectedResult.metadata?.video_source === 'nas' ? getNasVideoUrl(selectedResult.metadata.path) : getVideoUrl(selectedResult.metadata.path)}
                                            controls
                                            className="w-full h-full object-contain"
                                            poster={selectedResult.metadata?.screenshot_path}
                                        />
                                    </div>

                                    {/* Score Card */}
                                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 text-center">
                                        <div className="text-sm text-slate-500 mb-1 uppercase tracking-wide font-semibold">Overall Score</div>
                                        <div className={clsx(
                                            "text-4xl font-black",
                                            (selectedResult.metadata?.response_quality_score || 0) >= 4 ? "text-emerald-600" :
                                                (selectedResult.metadata?.response_quality_score || 0) >= 3 ? "text-amber-500" :
                                                    "text-rose-500"
                                        )}>
                                            {selectedResult.metadata?.response_quality_score || 'N/A'}
                                            <span className="text-lg text-slate-300 ml-1 font-normal">/ 5</span>
                                        </div>
                                    </div>

                                    {/* Metrics */}
                                    <div className="space-y-3">
                                        <div className="bg-white p-3 rounded-lg border border-slate-200">
                                            <div className="text-xs text-slate-400 mb-1">Latency</div>
                                            <div className="font-mono font-medium">{selectedResult.metadata?.latency_ms ? `${selectedResult.metadata.latency_ms} ms` : 'N/A'}</div>
                                        </div>
                                        <div className="bg-white p-3 rounded-lg border border-slate-200">
                                            <div className="text-xs text-slate-400 mb-1">Analysis Date</div>
                                            <div className="text-sm">{new Date(selectedResult.created_at).toLocaleDateString()}</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Right Column: Detailed Evaluation - Scrollable independently */}
                                <div className="md:col-span-2 p-8 space-y-8 bg-white overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 h-full">
                                    {/* Evaluation Summary - MOVED BELOW */}

                                    {/* Transcript Interaction - MOVED TO TOP */}
                                    <section className="mb-6">
                                        <h3 className="text-lg font-bold text-slate-900 mb-3">{t('interaction_log')}</h3>
                                        <div className="space-y-4">
                                            {/* User Bubble */}
                                            <div className="flex gap-3 justify-end">
                                                <div className="bg-secondary text-white p-3 rounded-2xl rounded-tr-none text-sm max-w-[80%] shadow-sm">
                                                    <div className="text-[10px] opacity-70 mb-1 uppercase tracking-wide font-semibold">User</div>
                                                    <SmartText text={selectedResult.metadata?.user_question || 'N/A'} />
                                                </div>
                                            </div>

                                            {/* System Bubble */}
                                            <div className="flex gap-3">
                                                <div className="bg-slate-100 text-slate-800 p-3 rounded-2xl rounded-tl-none text-sm max-w-[80%] border border-slate-200">
                                                    <div className="text-[10px] text-slate-400 mb-1 uppercase tracking-wide font-semibold">System</div>
                                                    <SmartText text={selectedResult.metadata?.system_response || 'N/A'} />
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    {/* Summary Section */}
                                    <section>
                                        <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                                            <Info className="w-5 h-5 text-blue-500" />
                                            {t('summary')}
                                        </h3>
                                        <div className="bg-blue-50/50 p-4 rounded-xl text-slate-700 leading-relaxed border border-blue-100 text-sm">
                                            <SmartText text={selectedResult.metadata?.summary || 'N/A'} />
                                        </div>
                                    </section>

                                    {/* Sub-criteria Scores */}
                                    <section>
                                        <h3 className="text-lg font-bold text-slate-900 mb-4">{t('evaluation_details')}</h3>
                                        <div className="space-y-4">
                                            {selectedResult.evaluation_scores && selectedResult.evaluation_scores.length > 0 ? (
                                                selectedResult.evaluation_scores.map((score: any) => (
                                                    <div key={score.id} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors">
                                                        <div className="flex justify-between items-center mb-2">
                                                            <span className="font-bold text-slate-700">{score.criteria}</span>
                                                            <span className={clsx(
                                                                "px-2 py-0.5 rounded text-xs font-bold",
                                                                score.score >= 4 ? "bg-emerald-100 text-emerald-700" :
                                                                    score.score >= 3 ? "bg-amber-100 text-amber-700" :
                                                                        "bg-rose-100 text-rose-700"
                                                            )}>
                                                                {score.score} / 5
                                                            </span>
                                                        </div>
                                                        <p className="text-sm text-slate-600">
                                                            <SmartText text={score.feedback} />
                                                        </p>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="text-slate-400 italic text-sm">No detailed scores available.</div>
                                            )}
                                        </div>
                                    </section>

                                    {/* Transcript Interaction - Removed from bottom as it is now at top */}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TestCases;
