import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, History, Settings, Activity, Database, ChevronLeft, ChevronRight, Library, Globe, HardDrive, Car } from 'lucide-react';
import clsx from 'clsx';
import { useLanguage } from '../contexts/LanguageContext';

const Sidebar = () => {
    const location = useLocation();
    const [collapsed, setCollapsed] = useState(false);
    const { t, language, toggleLanguage } = useLanguage();
    
    const links = [
        { path: '/', label: t('console'), icon: LayoutDashboard },
        { path: '/test-cases', label: t('test_cases'), icon: Library },
        { path: '/database', label: t('database'), icon: Database },
        { path: '/history', label: t('history'), icon: History },
        { path: '/vehicle-scores', label: t('vehicle_scores') || 'Vehicle Scores', icon: Car },
        { path: '/nas', label: t('nas_browser') || 'NAS Browser', icon: HardDrive },
        { path: '/vector-manager', label: t('vector_manager') || 'Vector Manager', icon: Activity },
        { path: '/settings', label: t('settings'), icon: Settings },
    ];

    return (
        <div className={clsx(
            "h-screen bg-primary-dark text-white flex flex-col border-r border-primary transition-all duration-300 relative shadow-xl z-50",
            collapsed ? "w-20" : "w-64"
        )}>
            {/* Toggle Button */}
            <button 
                onClick={() => setCollapsed(!collapsed)}
                className="absolute -right-3 top-8 bg-primary border border-primary-light rounded-full p-1 text-blue-200 hover:text-white hover:bg-primary-light transition-colors z-20 shadow-sm"
            >
                {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>

            <div className={clsx(
                "p-6 flex items-center gap-3 border-b border-primary transition-all overflow-hidden whitespace-nowrap",
                collapsed ? "justify-center px-0" : ""
            )}>
                <div className="bg-white/10 p-2 rounded-lg">
                    <Activity className="w-6 h-6 text-cta shrink-0" />
                </div>
                <h1 className={clsx(
                    "text-xl font-bold text-white tracking-tight transition-opacity duration-300 font-sans",
                    collapsed ? "opacity-0 w-0" : "opacity-100"
                )}>
                    BeeEVAL
                </h1>
            </div>
            
            <nav className="flex-1 p-4 space-y-2 overflow-x-hidden">
                {links.map((link) => {
                    const Icon = link.icon;
                    const isActive = location.pathname === link.path;
                    
                    return (
                        <Link
                            key={link.path}
                            to={link.path}
                            className={clsx(
                                "flex items-center gap-3 px-4 py-3 rounded-lg transition-all whitespace-nowrap group relative font-sans",
                                isActive 
                                    ? "bg-secondary text-white shadow-md shadow-secondary/20" 
                                    : "hover:bg-primary text-blue-200 hover:text-white",
                                collapsed ? "justify-center px-0" : ""
                            )}
                            title={collapsed ? link.label : undefined}
                        >
                            <Icon className={clsx("w-5 h-5 shrink-0 transition-colors", isActive ? "text-white" : "group-hover:text-white")} />
                            <span className={clsx(
                                "font-medium transition-all duration-300",
                                collapsed ? "opacity-0 w-0 hidden" : "opacity-100"
                            )}>
                                {link.label}
                            </span>
                        </Link>
                    );
                })}
            </nav>
            
            {/* Language Toggle */}
            <div className="px-4 pb-2">
                <button
                    onClick={toggleLanguage}
                    className={clsx(
                        "w-full flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-primary text-blue-200 hover:text-white transition-all whitespace-nowrap",
                        collapsed ? "justify-center px-0" : ""
                    )}
                    title={language === 'zh' ? "Switch to English" : "切换到中文"}
                >
                    <Globe className="w-5 h-5 shrink-0" />
                    <span className={clsx(
                        "font-medium transition-all duration-300 font-sans",
                        collapsed ? "opacity-0 w-0 hidden" : "opacity-100"
                    )}>
                        {language === 'zh' ? 'EN' : 'ZH'}
                    </span>
                </button>
            </div>
            
            <div className={clsx(
                "p-4 border-t border-primary text-xs text-blue-300/60 text-center transition-all overflow-hidden whitespace-nowrap font-mono",
                collapsed ? "opacity-0" : "opacity-100"
            )}>
                {t('version')} <br />
                <span className="opacity-70">Powered by Gemini 1.5 Pro</span>
            </div>
        </div>
    );
};

export default Sidebar;
