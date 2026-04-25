import React from 'react';

/**
 * 简易雷达图（纯 SVG，无第三方依赖）。
 * 用于展示一台车在多个评测指标上的均分（0-5）。
 *
 * 设计取舍：
 * - 标签太多时（>10）会显得拥挤；上层调用者负责裁剪/选最重要的指标。
 * - 不做交互（hover 高亮等），保持组件最小、依赖为零；
 *   后续如果要加 tooltip，再换 recharts/d3 也来得及。
 */

interface RadarChartProps {
    /** 维度标签（指标名）和对应均分（0-5）。 */
    data: Array<{ label: string; value: number }>;
    /** 评分上限，默认 5（与业务一致）。 */
    max?: number;
    /** SVG 整体宽高。 */
    size?: number;
    /** 描边/填充颜色，可覆盖。 */
    strokeColor?: string;
    fillColor?: string;
}

const RadarChart: React.FC<RadarChartProps> = ({
    data,
    max = 5,
    size = 360,
    strokeColor = '#3b82f6',
    fillColor = 'rgba(59, 130, 246, 0.18)',
}) => {
    const n = data.length;
    if (n < 3) {
        return (
            <div
                className="flex items-center justify-center text-sm text-slate-400 italic"
                style={{ width: size, height: size }}
            >
                指标数据不足以绘制雷达图（至少需要 3 个维度）
            </div>
        );
    }

    // 给标签留 padding；半径用 size/2 - padding。
    const padding = 60;
    const radius = size / 2 - padding;
    const cx = size / 2;
    const cy = size / 2;

    // 第 i 个轴的角度：从顶部开始，顺时针均匀分布。
    const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;

    // 同心环：5 圈分别对应 1..5 分。
    const rings = [1, 2, 3, 4, 5].map((r) => {
        const ratio = r / max;
        const points = Array.from({ length: n }, (_, i) => {
            const a = angle(i);
            const x = cx + Math.cos(a) * radius * ratio;
            const y = cy + Math.sin(a) * radius * ratio;
            return `${x},${y}`;
        }).join(' ');
        return { r, points };
    });

    // 数据多边形顶点
    const dataPoints = data.map((d, i) => {
        const a = angle(i);
        const ratio = Math.max(0, Math.min(1, d.value / max));
        const x = cx + Math.cos(a) * radius * ratio;
        const y = cy + Math.sin(a) * radius * ratio;
        return { x, y, ...d };
    });
    const dataPolyline = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');

    // 标签位置（外推一点点）
    const labels = data.map((d, i) => {
        const a = angle(i);
        const x = cx + Math.cos(a) * (radius + 18);
        const y = cy + Math.sin(a) * (radius + 18);
        // 简单的左右对齐策略：根据象限
        const cos = Math.cos(a);
        const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
        return { label: d.label, value: d.value, x, y, anchor };
    });

    return (
        <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className="select-none"
        >
            {/* 同心环 */}
            {rings.map(({ r, points }) => (
                <polygon
                    key={r}
                    points={points}
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth={1}
                />
            ))}

            {/* 轴线 */}
            {Array.from({ length: n }).map((_, i) => {
                const a = angle(i);
                const x = cx + Math.cos(a) * radius;
                const y = cy + Math.sin(a) * radius;
                return (
                    <line
                        key={i}
                        x1={cx}
                        y1={cy}
                        x2={x}
                        y2={y}
                        stroke="#e2e8f0"
                        strokeWidth={1}
                    />
                );
            })}

            {/* 同心环刻度（最外圈标 5、中间标 3） */}
            {[1, 2, 3, 4, 5].map((r) => (
                <text
                    key={`tick-${r}`}
                    x={cx + 4}
                    y={cy - (radius * r) / max}
                    fontSize={10}
                    fill="#94a3b8"
                    dominantBaseline="middle"
                >
                    {r}
                </text>
            ))}

            {/* 数据多边形 */}
            <polygon
                points={dataPolyline}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={2}
            />

            {/* 数据点 */}
            {dataPoints.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={strokeColor} />
            ))}

            {/* 标签 */}
            {labels.map((l, i) => (
                <g key={i}>
                    <text
                        x={l.x}
                        y={l.y}
                        fontSize={11}
                        fill="#475569"
                        textAnchor={l.anchor}
                        dominantBaseline="middle"
                    >
                        {l.label}
                    </text>
                    <text
                        x={l.x}
                        y={l.y + 13}
                        fontSize={10}
                        fill={strokeColor}
                        textAnchor={l.anchor}
                        dominantBaseline="middle"
                        fontWeight="bold"
                    >
                        {l.value.toFixed(2)}
                    </text>
                </g>
            ))}
        </svg>
    );
};

export default RadarChart;
