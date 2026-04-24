
import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, X, Bot, User, Loader2, PlayCircle, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import clsx from 'clsx';
import { chatQuery, getAllResults, getVideoUrl, ragQuery, getVectorStats } from '../api';
import { useLanguage } from '../contexts/LanguageContext';

const AskBeeEval = () => {
    const { language } = useLanguage();
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [messages, setMessages] = useState<{role: 'user' | 'assistant', content: string, sources?: any[]}[]>([]);
    const [loading, setLoading] = useState(false);
    const [videoMap, setVideoMap] = useState<Record<string, string>>({});
    const [useRag, setUseRag] = useState(true);  // RAG 开关
    const [vectorStats, setVectorStats] = useState<{total_vectors: number; dimension: number} | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Fetch all results to build filename -> fullpath map
    useEffect(() => {
        const fetchVideoPaths = async () => {
            try {
                const res = await getAllResults({ limit: 5000 });
                const map: Record<string, string> = {};
                res.data.forEach((r: any) => {
                    if (r.video_name && r.metadata?.path) {
                        map[r.video_name] = r.metadata.path;
                    }
                });
                setVideoMap(map);
            } catch (error) {
                console.error("Failed to load video paths for chat links", error);
            }
        };

        fetchVideoPaths();
    }, []);

    // Fetch vector stats when opening
    useEffect(() => {
        if (isOpen && useRag) {
            getVectorStats().then(stats => {
                setVectorStats({ total_vectors: stats.total_vectors, dimension: stats.dimension });
            }).catch(err => {
                console.error("Failed to fetch vector stats", err);
            });
        }
    }, [isOpen, useRag]);

    const handleSend = async () => {
        if (!query.trim()) return;
        
        const userQuery = query;
        // Optimistically add user message
        setMessages(prev => [...prev, { role: 'user', content: userQuery }]);
        setQuery('');
        setLoading(true);

        try {
            let response;
            if (useRag && vectorStats && vectorStats.total_vectors > 0) {
                // Use RAG-enhanced query
                response = await ragQuery(userQuery, 5);
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: response.answer,
                    sources: response.sources || []
                }]);
            } else {
                // Use original chat query
                response = await chatQuery(userQuery, language);
                setMessages(prev => [...prev, { role: 'assistant', content: response.answer }]);
            }
        } catch (error) {
            console.error(error);
            const message = (() => {
                if (typeof error === 'object' && error && 'response' in error) {
                    const resp: any = (error as any).response;
                    const detail = resp?.data?.detail;
                    if (typeof detail === 'string' && detail.trim()) return `请求失败：${detail}`;
                }
                return '请求失败：后端服务不可用或网络异常。';
            })();
            setMessages(prev => [...prev, { role: 'assistant', content: message }]);
        } finally {
            setLoading(false);
        }
    };

    // Helper to render content with clickable video links
    const renderContent = (content: string) => {
        // Updated regex to match [Video Name](Video Path) format from LLM
        // We look for markdown links where the URL (second part) ends in .mp4
        const parts = content.split(/(\[.*?\]\(.*?\.mp4\)|`.*?`)/g);
        
        return (
            <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-3 prose-headings:my-4 prose-headings:font-bold prose-headings:text-slate-800 prose-ul:my-3 prose-li:my-1 prose-strong:text-slate-900 prose-strong:font-bold text-slate-700 leading-relaxed font-sans">
                {parts.map((part, i) => {
                    // Check for markdown link format [text](url) where url ends in .mp4
                    const mdLinkMatch = part.match(/\[(.*?)\]\((.*?\.mp4)\)/);
                    if (mdLinkMatch) {
                        const displayText = mdLinkMatch[1];
                        const fullPath = mdLinkMatch[2]; // LLM now provides the full path directly
                        
                        return (
                            <a 
                                key={i}
                                href={getVideoUrl(fullPath)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-secondary hover:text-secondary-dark font-semibold bg-secondary/10 px-2.5 py-1 rounded-md mx-1 transition-all hover:bg-secondary/20 no-underline border border-secondary/20 text-xs align-middle shadow-sm"
                            >
                                <PlayCircle className="w-3.5 h-3.5" />
                                {displayText}
                            </a>
                        );
                    }
                    
                    // Render regular text with markdown
                    return <ReactMarkdown key={i} components={{ 
                        p: ({children}) => <p className="mb-3 last:mb-0 leading-relaxed text-slate-700">{children}</p>,
                        ul: ({children}) => <ul className="list-disc pl-5 space-y-1.5 mb-3 marker:text-slate-400">{children}</ul>,
                        ol: ({children}) => <ol className="list-decimal pl-5 space-y-1.5 mb-3 marker:text-slate-500 font-medium">{children}</ol>,
                        h3: ({children}) => <h3 className="text-base font-bold text-slate-900 mt-5 mb-2.5 pb-1 border-b border-slate-100">{children}</h3>,
                        h4: ({children}) => <h4 className="text-sm font-bold text-slate-800 mt-4 mb-2">{children}</h4>,
                        strong: ({children}) => <span className="font-bold text-slate-900 bg-slate-100/80 px-1 rounded-sm">{children}</span>,
                        blockquote: ({children}) => <blockquote className="border-l-4 border-primary/30 pl-4 py-1 my-3 bg-slate-50/50 rounded-r text-slate-600 italic">{children}</blockquote>,
                        code: ({children}) => <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono text-pink-600">{children}</code>
                    }}>{part}</ReactMarkdown>;
                })}
            </div>
        );
    };

    return (
        <>
            {/* Toggle Button */}
            {!isOpen && (
                <button 
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-8 right-8 bg-cta text-white p-4 rounded-full shadow-xl hover:bg-cta-hover hover:scale-110 transition-all z-50 flex items-center gap-2 group animate-in slide-in-from-bottom-4 duration-500"
                >
                    <MessageSquare className="w-6 h-6 group-hover:rotate-12 transition-transform" />
                    <span className="font-bold pr-1">Ask AI</span>
                </button>
            )}

            {/* Drawer Backdrop */}
            {isOpen && (
                <div 
                    className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40 transition-opacity animate-in fade-in duration-300" 
                    onClick={() => setIsOpen(false)}
                />
            )}

            {/* Drawer Panel */}
            <div className={clsx(
                "fixed top-0 right-0 h-full bg-white shadow-2xl z-50 transition-transform duration-300 ease-out flex flex-col border-l border-slate-100",
                isOpen ? "translate-x-0" : "translate-x-full",
                "w-full sm:w-[480px] md:w-[550px]"
            )}>
                {/* Header */}
                <div className="bg-white/80 backdrop-blur-md p-5 flex justify-between items-center border-b border-slate-100 shrink-0 sticky top-0 z-10">
                    <div className="flex items-center gap-3">
                        <div className="bg-gradient-to-br from-primary to-secondary p-2.5 rounded-xl shadow-lg shadow-primary/20">
                            <Bot className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-slate-900 font-sans tracking-tight">BeeEVAL Assistant</h3>
                            <div className="flex items-center gap-2">
                                <p className="text-xs text-slate-500 font-medium flex items-center gap-1">
                                    <Sparkles className="w-3 h-3 text-cta" />
                                    Powered by Gemini 1.5 Pro
                                </p>
                                {useRag && vectorStats && (
                                    <span className="text-[10px] text-primary font-medium bg-primary/10 px-1.5 py-0.5 rounded-full">
                                        {language === 'zh' ? `${vectorStats.total_vectors} 条向量` : `${vectorStats.total_vectors} vectors`}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => setIsOpen(false)}
                        className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* RAG Toggle */}
                <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className={clsx("w-2 h-2 rounded-full", useRag && vectorStats && vectorStats.total_vectors > 0 ? "bg-green-500 animate-pulse" : "bg-slate-300")} />
                        <span className="text-sm font-medium text-slate-700">
                            {language === 'zh' ? '向量检索增强' : 'Vector Retrieval'}
                        </span>
                    </div>
                    <button
                        onClick={() => setUseRag(!useRag)}
                        className={clsx(
                            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                            useRag ? "bg-primary" : "bg-slate-300"
                        )}
                    >
                        <span
                            className={clsx(
                                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                                useRag ? "translate-x-6" : "translate-x-1"
                            )}
                        />
                    </button>
                </div>
                
                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50 scrollbar-thin scrollbar-thumb-slate-200">
                    {messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 p-8 animate-in zoom-in-95 duration-500">
                            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6">
                                <Bot className="w-10 h-10 text-slate-300" />
                            </div>
                            <h4 className="font-bold text-slate-700 mb-3 text-lg">{language === 'zh' ? '我能为您做些什么？' : 'How can I help you?'}</h4>
                            <div className="space-y-2 w-full max-w-sm">
                                <button onClick={() => setQuery(language === 'zh' ? "哪个视频的回复质量最高？" : "Which video has the highest response quality?")} className="w-full p-3 text-sm text-slate-600 bg-white border border-slate-200 rounded-xl hover:border-primary hover:text-primary transition-colors text-left">
                                    {language === 'zh' ? "“哪个视频的回复质量最高？”" : "\"Which video has the highest response quality?\""}
                                </button>
                                <button onClick={() => setQuery(language === 'zh' ? "总结最近测试中的问题。" : "Summarize the issues in the latest test.")} className="w-full p-3 text-sm text-slate-600 bg-white border border-slate-200 rounded-xl hover:border-primary hover:text-primary transition-colors text-left">
                                    {language === 'zh' ? "“总结最近测试中的问题。”" : "\"Summarize the issues in the latest test.\""}
                                </button>
                            </div>
                        </div>
                    )}
                    
                    {messages.map((msg, idx) => (
                        <div key={idx} className={clsx("flex gap-4 animate-in slide-in-from-bottom-2 duration-300", msg.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                            <div className={clsx(
                                "w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-sm border-2 border-white",
                                msg.role === 'user' ? "bg-secondary text-white" : "bg-white text-primary"
                            )}>
                                {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                            </div>
                            <div className={clsx(
                                "max-w-[85%] rounded-2xl p-5 text-sm shadow-sm",
                                msg.role === 'user'
                                    ? "bg-secondary text-white rounded-tr-none shadow-md shadow-secondary/10"
                                    : "bg-white border border-slate-100 text-slate-700 rounded-tl-none shadow-sm"
                            )}>
                                {msg.role === 'user' ? msg.content : renderContent(msg.content)}
                                {/* Render sources for RAG responses */}
                                {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-slate-100">
                                        <details className="text-xs">
                                            <summary className="cursor-pointer text-slate-500 hover:text-slate-700 font-medium flex items-center gap-1">
                                                <Sparkles className="w-3 h-3" />
                                                {language === 'zh' ? `参考了 ${msg.sources.length} 个案例` : `Referenced ${msg.sources.length} case(s)`}
                                            </summary>
                                            <div className="mt-2 space-y-2">
                                                {msg.sources.map((source: any, i: number) => (
                                                    <div key={i} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                                                        {/* Structured Info */}
                                                        <div className="grid grid-cols-4 gap-2 mb-2">
                                                            {source.case_id && (
                                                                <div className="bg-white rounded px-2 py-1 border border-slate-200">
                                                                    <div className="text-[9px] text-slate-500">Case ID</div>
                                                                    <div className="text-xs font-mono font-medium">{source.case_id}</div>
                                                                </div>
                                                            )}
                                                            {source.brand_model && (
                                                                <div className="bg-white rounded px-2 py-1 border border-slate-200">
                                                                    <div className="text-[9px] text-slate-500">品牌车型</div>
                                                                    <div className="text-xs font-medium">{source.brand_model}</div>
                                                                </div>
                                                            )}
                                                            {source.system_version && (
                                                                <div className="bg-white rounded px-2 py-1 border border-slate-200">
                                                                    <div className="text-[9px] text-slate-500">系统版本</div>
                                                                    <div className="text-xs font-mono">{source.system_version}</div>
                                                                </div>
                                                            )}
                                                            {source.function_domain && (
                                                                <div className="bg-white rounded px-2 py-1 border border-slate-200">
                                                                    <div className="text-[9px] text-slate-500">功能域</div>
                                                                    <div className="text-xs font-medium">{source.function_domain}</div>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="text-slate-600 text-xs">
                                                            <span className="font-medium">{language === 'zh' ? '问题：' : 'Question: '}</span>
                                                            {source.user_question}
                                                        </div>
                                                        <div className="text-slate-600 text-xs mt-1">
                                                            <span className="font-medium">{language === 'zh' ? '回复：' : 'Response: '}</span>
                                                            {source.system_response?.slice(0, 100)}...
                                                        </div>
                                                        <div className="text-slate-500 text-xs mt-1 flex items-center gap-1">
                                                            <Sparkles className="w-3 h-3" />
                                                            <span className="font-medium">{language === 'zh' ? '相似度：' : 'Similarity: '}</span>
                                                            {(source.score * 100).toFixed(1)}%
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </details>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    
                    {loading && (
                        <div className="flex gap-4 animate-pulse">
                            <div className="w-9 h-9 rounded-full bg-white border border-slate-100 flex items-center justify-center shrink-0">
                                <Bot className="w-5 h-5 text-primary" />
                            </div>
                            <div className="bg-white border border-slate-100 p-5 rounded-2xl rounded-tl-none shadow-sm">
                                <div className="flex gap-1.5">
                                    <div className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" />
                                    <div className="w-2 h-2 bg-primary/40 rounded-full animate-bounce delay-75" />
                                    <div className="w-2 h-2 bg-primary/40 rounded-full animate-bounce delay-150" />
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-5 bg-white border-t border-slate-100 shrink-0 pb-8">
                    <div className="relative shadow-sm rounded-2xl bg-slate-50 border border-slate-200 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all">
                        <textarea
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                            placeholder={language === 'zh' ? "在此输入您的问题..." : "Type your question here..."}
                            className="w-full bg-transparent border-none px-4 py-4 text-sm focus:ring-0 outline-none resize-none min-h-[60px] max-h-[150px] pr-14 placeholder-slate-400"
                            rows={1}
                        />
                        <button 
                            onClick={handleSend}
                            disabled={loading || !query.trim()}
                            className="absolute right-2 bottom-2 p-2 bg-primary text-white rounded-xl hover:bg-primary-dark disabled:opacity-50 disabled:bg-slate-300 transition-all shadow-sm"
                        >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                        </button>
                    </div>
                    <div className="text-center mt-3 text-[10px] text-slate-400 font-medium">
                        {language === 'zh' ? 'AI 生成内容可能存在误差，请核实重要信息。' : 'AI-generated content may be inaccurate. Verify important information.'}
                    </div>
                </div>
            </div>
        </>
    );
};

export default AskBeeEval;
