import React, { useEffect, useMemo, useState } from 'react';
import {
    listVehiclesForAggregation,
    getVehicleAggregatedScores,
    computeVehicleAggregatedScores,
    type VehicleListItem,
    type VehicleScoreSnapshot,
    type DimensionScore,
} from '../api';
import RadarChart from '../components/RadarChart';
import { Calculator, RefreshCw, Car, Layers, Tag, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { useLanguage } from '../contexts/LanguageContext';

/**
 * 「车辆评分」页面：
 *   1. 顶部下拉框选车（brand_model + system_version 二选一组合）
 *   2. 一键计算按钮 -> 后端 GROUP BY -> 写缓存表 -> 返回快照
 *   3. 雷达图：指标均分（criteria）
 *   4. 柱状图：功能域均分（function_domain）
 *   5. 下方两张明细表
 *
 * 不引第三方图表库，雷达图自绘 SVG，柱状图用纯 CSS。
 */

const formatDateTime = (iso: string | null) => {
    if (!iso) return '从未计算';
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
};

const scoreColor = (score: number) => {
    if (score >= 4) return 'text-emerald-600 bg-emerald-50';
    if (score >= 3) return 'text-amber-600 bg-amber-50';
    return 'text-rose-600 bg-rose-50';
};

const barColor = (score: number) => {
    if (score >= 4) return 'bg-emerald-500';
    if (score >= 3) return 'bg-amber-500';
    return 'bg-rose-500';
};

/** 把 (brand_model, system_version) 拼成稳定字符串作为下拉 value。 */
const vehicleKey = (v: { brand_model: string; system_version: string | null }) =>
    `${v.brand_model}||${v.system_version ?? ''}`;

const parseVehicleKey = (
    key: string,
): { brand_model: string; system_version: string | null } => {
    const [bm, ver] = key.split('||');
    return { brand_model: bm, system_version: ver || null };
};

const VehicleScores: React.FC = () => {
    const { t } = useLanguage();

    const [vehicles, setVehicles] = useState<VehicleListItem[]>([]);
    const [loadingList, setLoadingList] = useState(true);
    const [listError, setListError] = useState<string | null>(null);

    const [selectedKey, setSelectedKey] = useState<string>('');
    const [snapshot, setSnapshot] = useState<VehicleScoreSnapshot | null>(null);
    const [loadingSnapshot, setLoadingSnapshot] = useState(false);
    const [computing, setComputing] = useState(false);
    const [snapshotError, setSnapshotError] = useState<string | null>(null);

    // ── 拉车列表 ──
    const refreshVehicles = async () => {
        setLoadingList(true);
        setListError(null);
        try {
            const list = await listVehiclesForAggregation();
            setVehicles(list);
            // 默认选第一个
            if (list.length > 0 && !selectedKey) {
                setSelectedKey(vehicleKey(list[0]));
            }
        } catch (e: any) {
            setListError(e?.message || '加载车辆列表失败');
        } finally {
            setLoadingList(false);
        }
    };

    useEffect(() => {
        refreshVehicles();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── 切换选车后，拉缓存 ──
    useEffect(() => {
        if (!selectedKey) {
            setSnapshot(null);
            return;
        }
        const { brand_model, system_version } = parseVehicleKey(selectedKey);
        setLoadingSnapshot(true);
        setSnapshotError(null);
        getVehicleAggregatedScores(brand_model, system_version)
            .then((s) => setSnapshot(s))
            .catch((e: any) =>
                setSnapshotError(e?.message || '加载该车均分失败'),
            )
            .finally(() => setLoadingSnapshot(false));
    }, [selectedKey]);

    const handleCompute = async () => {
        if (!selectedKey) return;
        const { brand_model, system_version } = parseVehicleKey(selectedKey);
        setComputing(true);
        setSnapshotError(null);
        try {
            const s = await computeVehicleAggregatedScores(brand_model, system_version);
            setSnapshot(s);
            // 列表里的 last_computed_at 也要刷新
            await refreshVehicles();
        } catch (e: any) {
            setSnapshotError(e?.message || '计算失败');
        } finally {
            setComputing(false);
        }
    };

    const selectedVehicle = useMemo(
        () => vehicles.find((v) => vehicleKey(v) === selectedKey),
        [vehicles, selectedKey],
    );

    const hasData = !!snapshot && (
        snapshot.criteria_scores.length > 0 ||
        snapshot.function_domain_scores.length > 0
    );

    // 柱状图最大宽度按 score / 5 来算
    const renderBarRow = (item: DimensionScore) => {
        const widthPct = Math.max(2, Math.min(100, (item.avg_score / 5) * 100));
        return (
            <div key={item.dimension_key} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">
                        {item.dimension_key}
                    </span>
                    <span className={clsx(
                        'px-2 py-0.5 rounded text-xs font-bold tabular-nums',
                        scoreColor(item.avg_score),
                    )}>
                        {item.avg_score.toFixed(2)} / 5
                        <span className="text-slate-400 font-normal ml-2">
                            ({item.sample_count})
                        </span>
                    </span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                        className={clsx(
                            'h-full rounded-full transition-all duration-500',
                            barColor(item.avg_score),
                        )}
                        style={{ width: `${widthPct}%` }}
                    />
                </div>
            </div>
        );
    };

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-6">
            {/* 标题 */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <Car className="w-7 h-7 text-secondary" />
                        {t('vehicle_scores') || '车辆评分'}
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        {t('vehicle_scores_desc') ||
                            '按车型 + 系统版本聚合每个指标和功能域的均分。点「一键计算」更新数据。'}
                    </p>
                </div>
            </div>

            {/* 选车 + 计算控制条 */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                {loadingList ? (
                    <div className="text-sm text-slate-400">
                        {t('loading_data') || '加载中…'}
                    </div>
                ) : listError ? (
                    <div className="text-sm text-rose-600 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        {listError}
                    </div>
                ) : vehicles.length === 0 ? (
                    <div className="text-sm text-slate-500">
                        {t('vehicle_scores_no_data') ||
                            '当前还没有任何打分视频，无法生成均分。'}
                    </div>
                ) : (
                    <div className="flex flex-col md:flex-row gap-4 md:items-end">
                        <div className="flex-1 min-w-0">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                {t('select_vehicle') || '选择车辆'}
                            </label>
                            <select
                                value={selectedKey}
                                onChange={(e) => setSelectedKey(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-secondary focus:border-secondary"
                            >
                                {vehicles.map((v) => {
                                    const k = vehicleKey(v);
                                    return (
                                        <option key={k} value={k}>
                                            {v.brand_model}
                                            {v.system_version ? ` · ${v.system_version}` : ''}
                                            {' '}({v.video_count} videos
                                            {v.has_cache ? ' · 已计算' : ''})
                                        </option>
                                    );
                                })}
                            </select>
                        </div>

                        <div className="text-sm text-slate-500 md:w-64 shrink-0">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">
                                {t('last_computed_at') || '上次计算'}
                            </div>
                            <div>{formatDateTime(snapshot?.last_computed_at ?? selectedVehicle?.last_computed_at ?? null)}</div>
                        </div>

                        <button
                            onClick={handleCompute}
                            disabled={computing || !selectedKey}
                            className={clsx(
                                'px-4 py-2 rounded-lg text-white font-medium flex items-center gap-2 shrink-0 transition-colors',
                                computing
                                    ? 'bg-slate-400 cursor-not-allowed'
                                    : 'bg-secondary hover:bg-secondary/90',
                            )}
                        >
                            {computing
                                ? <RefreshCw className="w-4 h-4 animate-spin" />
                                : <Calculator className="w-4 h-4" />
                            }
                            {computing
                                ? (t('computing') || '计算中…')
                                : (t('compute_scores') || '一键计算')}
                        </button>
                    </div>
                )}
            </div>

            {/* 错误条 */}
            {snapshotError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {snapshotError}
                </div>
            )}

            {/* 数据为空提示 */}
            {!loadingSnapshot && snapshot && !hasData && !snapshotError && (
                <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-6 rounded-lg text-center">
                    {t('no_aggregated_yet') ||
                        '该车暂无均分缓存，请点击「一键计算」生成。'}
                </div>
            )}

            {/* 主体：两张图 */}
            {hasData && snapshot && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 雷达图 - 指标均分 */}
                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="font-bold text-slate-900 flex items-center gap-2">
                                <Tag className="w-5 h-5 text-blue-500" />
                                {t('criteria_scores') || '指标均分'}
                            </h2>
                            <span className="text-xs text-slate-400">
                                {snapshot.criteria_scores.length} {t('metrics') || '个指标'}
                            </span>
                        </div>
                        {snapshot.criteria_scores.length >= 3 ? (
                            <div className="flex justify-center">
                                <RadarChart
                                    data={snapshot.criteria_scores.map((c) => ({
                                        label: c.dimension_key,
                                        value: c.avg_score,
                                    }))}
                                    size={400}
                                />
                            </div>
                        ) : (
                            <div className="space-y-2 mt-2">
                                {snapshot.criteria_scores.map(renderBarRow)}
                            </div>
                        )}

                        {/* 指标明细表 */}
                        <details className="mt-4 group">
                            <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700">
                                {t('view_details') || '查看明细'}
                            </summary>
                            <table className="w-full text-sm mt-3">
                                <thead>
                                    <tr className="text-left text-xs uppercase text-slate-400 border-b border-slate-200">
                                        <th className="py-2">{t('metric_name') || '指标'}</th>
                                        <th className="py-2 text-right">{t('avg_score') || '均分'}</th>
                                        <th className="py-2 text-right">{t('samples') || '样本'}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {snapshot.criteria_scores.map((c) => (
                                        <tr key={c.dimension_key} className="border-b border-slate-100">
                                            <td className="py-2 text-slate-700">{c.dimension_key}</td>
                                            <td className="py-2 text-right font-mono">
                                                {c.avg_score.toFixed(2)}
                                            </td>
                                            <td className="py-2 text-right text-slate-500">
                                                {c.sample_count}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </details>
                    </div>

                    {/* 柱状图 - 功能域均分 */}
                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="font-bold text-slate-900 flex items-center gap-2">
                                <Layers className="w-5 h-5 text-purple-500" />
                                {t('function_domain_scores') || '功能域均分'}
                            </h2>
                            <span className="text-xs text-slate-400">
                                {snapshot.function_domain_scores.length} {t('domains') || '个功能域'}
                            </span>
                        </div>
                        {snapshot.function_domain_scores.length === 0 ? (
                            <div className="text-sm text-slate-400 italic py-8 text-center">
                                {t('no_domain_data') ||
                                    '没有功能域分组数据（视频文件名可能未带功能域）。'}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {snapshot.function_domain_scores.map(renderBarRow)}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default VehicleScores;
