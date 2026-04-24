import React from 'react';
import { translateText } from '../api';
import { useLanguage } from '../contexts/LanguageContext';
import { useQuery } from '@tanstack/react-query';

interface SmartTextProps {
    text: string;
    className?: string;
    as?: any;
    fallback?: React.ReactNode;
}

const SmartText: React.FC<SmartTextProps> = ({ text, className, as: Component = 'span', fallback }) => {
    const { language } = useLanguage();
    
    // Heuristic: Is text mostly Chinese?
    const isChinese = (str: string) => /[\u4e00-\u9fa5]/.test(str);
    
    // Determine if translation is needed
    // Simple logic: If we want EN and text is ZH, translate.
    // If we want ZH and text is EN (and long enough), translate.
    const shouldTranslate = 
        (language === 'en' && isChinese(text)) || 
        (language === 'zh' && !isChinese(text) && text.length > 20);

    const { data: translated, isLoading } = useQuery({
        queryKey: ['translate', text, language],
        queryFn: async () => {
            const res = await translateText(text, language);
            return res.translated;
        },
        enabled: !!text && shouldTranslate,
        staleTime: Infinity, 
        retry: false
    });

    if (!text) return <>{fallback || null}</>;

    // If translating, show loading state (pulse)
    if (shouldTranslate && isLoading) {
        return (
            <span className={className}>
                 <span className="animate-pulse bg-slate-200 text-transparent rounded select-none inline-block min-w-[50px]">{text}</span>
            </span>
        );
    }

    // Use translated text if available, otherwise original
    const displayText = (shouldTranslate && translated) ? translated : text;

    return (
        <Component className={className} title={shouldTranslate ? "Translated by AI" : undefined}>
            {displayText}
        </Component>
    );
};

export default SmartText;
