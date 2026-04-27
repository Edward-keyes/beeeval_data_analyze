import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { useTranslation } from 'react-i18next';
import {
    AlertCircle,
    Bot,
    History as HistoryIcon,
    Loader2,
    PlayCircle,
    Save,
    Send,
    Settings2,
    Sparkles,
} from 'lucide-react';

import {
    DrBeeConfig,
    DrBeeQueryResponse,
    DrBeeSelectionMode,
    DrBeeSource,
    drBeeQuery,
    getDrBeeConfig,
    saveDrBeeSession,
} from '../api';
import VideoPlayerModal from '../components/VideoPlayerModal';

const TOP_K_DEFAULT = 20;
const MIN_SCORE_FALLBACK = 0.55;

const DrBeeLab: React.FC = () => {
    const { t } = useTranslation();

    const [config, setConfig] = useState<DrBeeConfig | null>(null);
    const [configLoading, setConfigLoading] = useState(true);
    const [configError, setConfigError] = useState<string | null>(null);

    const [systemInstruction, setSystemInstruction] = useState('');
    const [promptTemplate, setPromptTemplate] = useState('');
    const [modelKey, setModelKey] = useState('');
    const [topK, setTopK] = useState(TOP_K_DEFAULT);
    const [selectionMode, setSelectionMode] = useState<DrBeeSelectionMode>('manual');
    const [minScore, setMinScore] = useState<number>(MIN_SCORE_FALLBACK);
    const [question, setQuestion] = useState('');

    const [response, setResponse] = useState<DrBeeQueryResponse | null>(null);
    const [askLoading, setAskLoading] = useState(false);
    const [askError, setAskError] = useState<string | null>(null);

    const [saveTitle, setSaveTitle] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState<string | null>(null);

    const [videoModalPath, setVideoModalPath] = useState<string | null>(null);
    const [videoModalTitle, setVideoModalTitle] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        getDrBeeConfig()
            .then((cfg) => {
                if (!mounted) return;
                setConfig(cfg);
                setSystemInstruction(cfg.default_system_instruction);
                setPromptTemplate(cfg.default_prompt_template);
                setModelKey(cfg.default_model_key || (cfg.models[0]?.key ?? ''));
                if (typeof cfg.default_min_score === 'number') {
                    setMinScore(cfg.default_min_score);
                }
            })
            .catch((err) => {
                if (!mounted) return;
                setConfigError(err?.response?.data?.detail || err?.message || 'Failed to load config');
            })
            .finally(() => mounted && setConfigLoading(false));
        return () => {
            mounted = false;
        };
    }, []);

    const missingPlaceholders = useMemo(() => {
        if (!config) return [];
        return config.required_placeholders.filter((ph) => !promptTemplate.includes(ph));
    }, [config, promptTemplate]);

    const canAsk = !!question.trim() && !!modelKey && missingPlaceholders.length === 0 && !askLoading;

    const handleAsk = async () => {
        if (!canAsk) return;
        setAskLoading(true);
        setAskError(null);
        setSaveMsg(null);
        setResponse(null);
        try {
            const res = await drBeeQuery({
                question,
                prompt_template: promptTemplate,
                system_instruction: systemInstruction,
                model_key: modelKey,
                top_k: topK,
                selection_mode: selectionMode,
                min_score: selectionMode === 'auto' ? minScore : null,
            });
            setResponse(res);
        } catch (err: any) {
            setAskError(err?.response?.data?.detail || err?.message || 'Query failed');
        } finally {
            setAskLoading(false);
        }
    };

    const handleSave = async () => {
        if (!response) return;
        setSaving(true);
        setSaveMsg(null);
        try {
            await saveDrBeeSession({
                title: saveTitle.trim() || null,
                prompt_template: promptTemplate,
                model_key: response.model_key,
                model_name: response.model_name,
                user_question: question,
                answer: response.answer,
                llm_latency_ms: response.llm_latency_ms,
                total_latency_ms: response.total_latency_ms,
                // auto 模式 top_k 没意义，回填实际取的条数让历史记录更直观
                top_k: response.selection_mode === 'auto' ? response.retrieved_count : topK,
                retrieved_sources: response.sources,
                selection_mode: response.selection_mode,
                min_score: response.min_score_used,
                top_score: response.top_score,
                low_relevance: response.low_relevance,
            });
            setSaveMsg(t('drbee_save_success') || '已保存');
            setSaveTitle('');
        } catch (err: any) {
            setSaveMsg(err?.response?.data?.detail || err?.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const resetToDefaults = () => {
        if (!config) return;
        setSystemInstruction(config.default_system_instruction);
        setPromptTemplate(config.default_prompt_template);
        setModelKey(config.default_model_key);
        setTopK(TOP_K_DEFAULT);
        setSelectionMode('manual');
        setMinScore(config.default_min_score ?? MIN_SCORE_FALLBACK);
    };

    return (
        <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="bg-gradient-to-br from-primary to-secondary p-2.5 rounded-xl shadow-lg shadow-primary/20">
                            <Bot className="w-6 h-6 text-white" />
                        </div>
                        <h1 className="text-2xl font-bold text-slate-900 font-sans">
                            {t('drbee_lab') || 'Dr.bee 调试台'}
                        </h1>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                            {t('drbee_tester_only') || '测试人员专用'}
                        </span>
                    </div>
                    <p className="text-sm text-slate-500">
                        {t('drbee_lab_desc') ||
                            '编辑前置 prompt、切换 LLM 基模、查看耗时与检索来源，把效果好的问答保存到历史。'}
                    </p>
                </div>
                <Link
                    to="/drbee/sessions"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-primary/40 hover:text-primary transition-colors text-sm font-medium shadow-sm"
                >
                    <HistoryIcon className="w-4 h-4" />
                    {t('drbee_history') || '历史会话'}
                </Link>
            </div>

            {configLoading && (
                <div className="flex items-center gap-2 text-slate-500 text-sm py-12 justify-center">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>{t('loading_data') || 'Loading...'}</span>
                </div>
            )}

            {configError && (
                <div className="flex items-start gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                    <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                    <div className="text-sm">{configError}</div>
                </div>
            )}

            {config && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {/* ───────── 左：配置 ───────── */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-5">
                        <div className="flex items-center justify-between">
                            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                                <Settings2 className="w-4 h-4 text-primary" />
                                {t('drbee_config') || '调试配置'}
                            </h2>
                            <button
                                onClick={resetToDefaults}
                                className="text-xs text-slate-500 hover:text-primary"
                            >
                                {t('drbee_reset_defaults') || '恢复默认'}
                            </button>
                        </div>

                        {/* Model + retrieval mode */}
                        <div>
                            <label className="text-xs font-medium text-slate-600 mb-1 block">
                                {t('drbee_model') || 'LLM 基模'}
                            </label>
                            <select
                                value={modelKey}
                                onChange={(e) => setModelKey(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                                disabled={config.models.length === 0}
                            >
                                {config.models.length === 0 ? (
                                    <option value="">
                                        {t('drbee_no_model') || '⚠ .env 里还没配齐任何模型'}
                                    </option>
                                ) : (
                                    config.models.map((m) => (
                                        <option key={m.key} value={m.key}>
                                            {m.label} — {m.model_name}
                                        </option>
                                    ))
                                )}
                            </select>
                        </div>

                        {/* Selection mode + threshold/top_k */}
                        <div className="grid grid-cols-2 gap-3 items-end">
                            <div>
                                <label className="text-xs font-medium text-slate-600 mb-1 block">
                                    {t('drbee_retrieval_mode') || '检索数量模式'}
                                </label>
                                <div
                                    role="tablist"
                                    aria-label={t('drbee_retrieval_mode') || 'retrieval mode'}
                                    className="inline-flex w-full rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium"
                                >
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={selectionMode === 'manual'}
                                        onClick={() => setSelectionMode('manual')}
                                        className={
                                            'flex-1 px-3 py-1.5 rounded-md transition-colors ' +
                                            (selectionMode === 'manual'
                                                ? 'bg-white text-slate-900 shadow-sm'
                                                : 'text-slate-500 hover:text-slate-700')
                                        }
                                    >
                                        {t('drbee_mode_manual') || '手动'}
                                    </button>
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={selectionMode === 'auto'}
                                        onClick={() => setSelectionMode('auto')}
                                        className={
                                            'flex-1 px-3 py-1.5 rounded-md transition-colors ' +
                                            (selectionMode === 'auto'
                                                ? 'bg-white text-slate-900 shadow-sm'
                                                : 'text-slate-500 hover:text-slate-700')
                                        }
                                    >
                                        {t('drbee_mode_auto') || '自动'}
                                    </button>
                                </div>
                            </div>
                            {selectionMode === 'manual' ? (
                                <div>
                                    <label className="text-xs font-medium text-slate-600 mb-1 block">
                                        Top-K
                                    </label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={config.rag_max_k || 50}
                                        value={topK}
                                        onChange={(e) => setTopK(parseInt(e.target.value || '0', 10) || 1)}
                                        className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                                    />
                                </div>
                            ) : (
                                <div>
                                    <label className="text-xs font-medium text-slate-600 mb-1 block">
                                        {t('drbee_min_score') || '最低相似度阈值'}
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        value={minScore}
                                        onChange={(e) => {
                                            const v = parseFloat(e.target.value);
                                            if (Number.isNaN(v)) return;
                                            setMinScore(Math.max(0, Math.min(1, v)));
                                        }}
                                        className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                                    />
                                </div>
                            )}
                        </div>
                        {selectionMode === 'auto' && (
                            <div className="-mt-2 text-[11px] text-slate-500 leading-snug">
                                {t('drbee_auto_hint') ||
                                    `自动按相似度过滤；返回数量在 [${config.rag_min_k}, ${config.rag_max_k}] 之间`}
                            </div>
                        )}

                        {/* System prompt */}
                        <div>
                            <label className="text-xs font-medium text-slate-600 mb-1 block">
                                {t('drbee_system_prompt') || 'System Instruction（角色 / 输出约束）'}
                            </label>
                            <textarea
                                value={systemInstruction}
                                onChange={(e) => setSystemInstruction(e.target.value)}
                                rows={6}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50/50 text-xs font-mono text-slate-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                            />
                        </div>

                        {/* User prompt template */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="text-xs font-medium text-slate-600">
                                    {t('drbee_prompt_template') || 'User Prompt 模板（必含占位符）'}
                                </label>
                                <PlaceholderHints
                                    required={config.required_placeholders}
                                    optional={config.optional_placeholders}
                                />
                            </div>
                            <textarea
                                value={promptTemplate}
                                onChange={(e) => setPromptTemplate(e.target.value)}
                                rows={12}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50/50 text-xs font-mono text-slate-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                            />
                            {missingPlaceholders.length > 0 && (
                                <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                    <span>
                                        {(t('drbee_missing_placeholders') || '缺少必填占位符：') +
                                            missingPlaceholders.join(', ')}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Question */}
                        <div>
                            <label className="text-xs font-medium text-slate-600 mb-1 block">
                                {t('drbee_question') || '用户问题'}
                            </label>
                            <textarea
                                value={question}
                                onChange={(e) => setQuestion(e.target.value)}
                                rows={3}
                                placeholder={t('drbee_question_placeholder') || '比如：理想 L9 在导航场景的回答质量怎么样？'}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                            />
                        </div>

                        <button
                            onClick={handleAsk}
                            disabled={!canAsk}
                            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-white font-medium text-sm shadow-md shadow-primary/20 hover:bg-primary/90 disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed transition-colors"
                        >
                            {askLoading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    {t('drbee_asking') || '请求中…'}
                                </>
                            ) : (
                                <>
                                    <Send className="w-4 h-4" />
                                    {t('drbee_ask') || '发起问答'}
                                </>
                            )}
                        </button>

                        {askError && (
                            <div className="flex items-start gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 text-xs">
                                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                <div className="break-all">{askError}</div>
                            </div>
                        )}
                    </div>

                    {/* ───────── 右：结果 ───────── */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-cta" />
                                {t('drbee_answer') || 'LLM 回答'}
                            </h2>
                            {response && (
                                <div className="text-xs text-slate-500 flex items-center gap-3 font-mono">
                                    <span title="LLM time">{(t('drbee_llm_latency') || 'LLM') + ': ' + response.llm_latency_ms + 'ms'}</span>
                                    <span title="Total">{(t('drbee_total_latency') || '总') + ': ' + response.total_latency_ms + 'ms'}</span>
                                    <span title="Sources">{response.retrieved_count} {t('drbee_sources') || 'sources'}</span>
                                </div>
                            )}
                        </div>

                        {!response && !askLoading && (
                            <div className="text-sm text-slate-400 italic py-12 text-center border border-dashed border-slate-200 rounded-lg">
                                {t('drbee_empty_answer') || '左侧填好后，点「发起问答」开始'}
                            </div>
                        )}

                        {askLoading && (
                            <div className="flex flex-col items-center gap-2 text-slate-500 text-sm py-12">
                                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                                <span>{t('drbee_thinking') || 'LLM 正在生成回答…'}</span>
                            </div>
                        )}

                        {response && (
                            <>
                                <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-xs text-slate-500 font-mono break-all">
                                    {t('drbee_used_model') || '使用模型'}: {response.model_name}
                                </div>

                                {/* 检索统计：auto 模式下展示实际取了 N 条 + top_score + 阈值 */}
                                {response.selection_mode === 'auto' ? (
                                    <div
                                        className={
                                            'px-3 py-2 rounded-lg text-xs font-mono break-all border ' +
                                            (response.low_relevance
                                                ? 'bg-amber-50 border-amber-200 text-amber-800'
                                                : 'bg-emerald-50 border-emerald-100 text-emerald-800')
                                        }
                                    >
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                            <span>
                                                {(t('drbee_actual_retrieved') || '实际取了') + ' '}
                                                <strong>{response.retrieved_count}</strong>{' '}
                                                {t('drbee_items_unit') || '条'}
                                            </span>
                                            {response.top_score !== null && (
                                                <span>top_score = <strong>{response.top_score.toFixed(3)}</strong></span>
                                            )}
                                            {response.min_score_used !== null && (
                                                <span>
                                                    {(t('drbee_threshold') || '阈值')} ={' '}
                                                    <strong>{response.min_score_used.toFixed(2)}</strong>
                                                </span>
                                            )}
                                        </div>
                                        {response.low_relevance && (
                                            <div className="mt-1 flex items-start gap-1.5 text-[11px] font-sans">
                                                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                                <span>
                                                    {t('drbee_low_relevance_warn') ||
                                                        '样本相关度偏低：所有候选都低于阈值或不足兜底数量，结论仅供参考。'}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-xs font-mono text-slate-500 break-all">
                                        {(t('drbee_mode_manual') || '手动')} · Top-K = <strong>{topK}</strong> ·{' '}
                                        {t('drbee_actual_retrieved') || '实际取了'}{' '}
                                        <strong>{response.retrieved_count}</strong> {t('drbee_items_unit') || '条'}
                                    </div>
                                )}

                                <MarkdownAnswer
                                    text={response.answer}
                                    onPlay={(path, title) => {
                                        setVideoModalPath(path);
                                        setVideoModalTitle(title);
                                    }}
                                />

                                {/* Save block */}
                                <div className="pt-4 mt-4 border-t border-slate-100">
                                    <div className="text-xs font-medium text-slate-600 mb-2">
                                        {t('drbee_save_session') || '保存这次对话'}
                                    </div>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={saveTitle}
                                            onChange={(e) => setSaveTitle(e.target.value)}
                                            placeholder={t('drbee_save_title_placeholder') || '可选标题（方便日后查找）'}
                                            className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                                        />
                                        <button
                                            onClick={handleSave}
                                            disabled={saving}
                                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:bg-slate-300 transition-colors"
                                        >
                                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                            {t('save_changes') || '保存'}
                                        </button>
                                    </div>
                                    {saveMsg && <div className="mt-2 text-xs text-slate-500">{saveMsg}</div>}
                                </div>

                                {/* Sources */}
                                {response.sources.length > 0 && (
                                    <div className="pt-4 mt-4 border-t border-slate-100">
                                        <div className="text-xs font-medium text-slate-600 mb-2">
                                            {(t('drbee_sources_label') || '检索来源') + ` (${response.sources.length})`}
                                        </div>
                                        <SourcesList sources={response.sources} onPlay={(path, title) => {
                                            setVideoModalPath(path);
                                            setVideoModalTitle(title);
                                        }} />
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            <VideoPlayerModal
                open={!!videoModalPath}
                videoPath={videoModalPath}
                title={videoModalTitle}
                onClose={() => {
                    setVideoModalPath(null);
                    setVideoModalTitle(null);
                }}
            />
        </div>
    );
};

// ──────────────────────────────────────────────────────────────
// 子组件：占位符提示
// ──────────────────────────────────────────────────────────────
const PlaceholderHints: React.FC<{ required: string[]; optional: string[] }> = ({ required, optional }) => {
    return (
        <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
            <span className="font-medium text-amber-700">必填:</span>
            {required.map((p) => (
                <code key={p} className="px-1 py-0.5 rounded bg-amber-50 border border-amber-200 font-mono text-amber-700">
                    {p}
                </code>
            ))}
            <span className="font-medium ml-2">可选:</span>
            {optional.map((p) => (
                <code key={p} className="px-1 py-0.5 rounded bg-slate-50 border border-slate-200 font-mono text-slate-500">
                    {p}
                </code>
            ))}
        </div>
    );
};

// ──────────────────────────────────────────────────────────────
// 子组件：渲染纯 markdown 答复，自定义 a 标签拦截 .mp4 链接
// ──────────────────────────────────────────────────────────────
export const MarkdownAnswer: React.FC<{
    text: string;
    onPlay: (path: string, title: string) => void;
}> = ({ text, onPlay }) => {
    return (
        <div className="prose prose-sm max-w-none prose-p:my-2 prose-headings:font-bold prose-headings:text-slate-800 prose-strong:text-slate-900 text-slate-700 leading-relaxed">
            <ReactMarkdown
                components={{
                    a: ({ href, children, ...props }) => {
                        const isVideo = !!href && /\.(mp4|mov|m4v|webm|mkv)(\?|$)/i.test(href);
                        if (isVideo && href) {
                            const text = (Array.isArray(children) ? children.join('') : String(children || '')) || href;
                            return (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        onPlay(href, text);
                                    }}
                                    className="inline-flex items-center gap-1 text-secondary hover:text-secondary-dark font-medium bg-secondary/10 hover:bg-secondary/20 border border-secondary/20 px-2 py-0.5 rounded transition-colors text-sm align-middle no-underline"
                                >
                                    <PlayCircle className="w-3.5 h-3.5" />
                                    {text}
                                </button>
                            );
                        }
                        return (
                            <a href={href} {...props} target="_blank" rel="noopener noreferrer">
                                {children}
                            </a>
                        );
                    },
                    p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                    ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 mb-3">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 mb-3">{children}</ol>,
                    code: ({ children }) => <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono text-pink-600">{children}</code>,
                    blockquote: ({ children }) => <blockquote className="border-l-4 border-primary/30 pl-4 my-3 text-slate-600 italic">{children}</blockquote>,
                }}
            >
                {text}
            </ReactMarkdown>
        </div>
    );
};

// ──────────────────────────────────────────────────────────────
// 子组件：检索来源列表
// ──────────────────────────────────────────────────────────────
const SourcesList: React.FC<{
    sources: DrBeeSource[];
    onPlay: (path: string, title: string) => void;
}> = ({ sources, onPlay }) => {
    return (
        <div className="space-y-2 max-h-96 overflow-auto pr-1">
            {sources.map((s, i) => (
                <div key={i} className="text-xs border border-slate-100 rounded-lg p-2.5 hover:border-slate-200 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 truncate">
                            {s.video_path ? (
                                <button
                                    onClick={() => onPlay(s.video_path!, s.video_name || s.video_path!)}
                                    className="text-primary hover:text-primary/80 font-medium truncate inline-flex items-center gap-1"
                                    title={s.video_path}
                                >
                                    <PlayCircle className="w-3.5 h-3.5 shrink-0" />
                                    {s.video_name || s.video_path}
                                </button>
                            ) : (
                                <span className="text-slate-700 font-medium truncate">{s.video_name || '—'}</span>
                            )}
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0">#{i + 1}</span>
                    </div>
                    <div className="text-slate-500 line-clamp-2">{s.summary || s.user_question || ''}</div>
                    <div className="text-[10px] text-slate-400 mt-1 font-mono truncate">
                        {[s.brand_model, s.system_version, s.function_domain].filter(Boolean).join(' · ')}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default DrBeeLab;
