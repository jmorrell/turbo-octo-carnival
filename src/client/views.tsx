import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, HeatmapChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, VisualMapComponent, DataZoomComponent, LegendComponent, BrushComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { Artifact, HeatmapData, SeriesData } from '../shared/model';
import { heatmapDataSchema, seriesDataSchema } from '../shared/model';

echarts.use([LineChart, HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, DataZoomComponent, LegendComponent, BrushComponent, SVGRenderer]);
const time = (n: number) => new Date(n).toISOString().slice(11, 16);
export type Selection = { from: number; to: number; parentId: string };
const palette = ['#87d4b7', '#6e9cbc', '#c6ad79'];
const axis = { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#829396', fontSize: 10, fontFamily: 'monospace' }, splitLine: { lineStyle: { color: '#263236', type: 'dashed' as const } } };

function Chart({ artifact, onSelect }: { artifact: Artifact; onSelect?: (selection: Selection) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'svg' });
    const common = {
      animation: false, backgroundColor: 'transparent',
      textStyle: { fontFamily: 'Arial, sans-serif' },
      tooltip: { trigger: 'axis', renderMode: 'richText', backgroundColor: '#1b292d', borderColor: '#34484a', textStyle: { color: '#dde9e6', fontSize: 11 } },
      grid: { left: 48, right: 18, top: 30, bottom: 48 },
      brush: { toolbox: [], xAxisIndex: 0, brushMode: 'single', transformable: false, brushStyle: { color: '#87d4b722', borderColor: '#87d4b7' } },
    };
    let times: number[] = [];
    if (artifact.view === 'line') {
      const data = artifact.data as SeriesData;
      if (!data?.series?.every(s => Array.isArray(s.points))) { chart.dispose(); return; }
      times = [...new Set(data.series.flatMap(s => s.points.map(p => p[0])))].sort((a, b) => a - b);
      chart.setOption({
        ...common, color: palette,
        legend: { top: 0, right: 12, itemWidth: 14, itemHeight: 2, textStyle: { color: '#a7b6b8', fontSize: 11 } },
        xAxis: { ...axis, type: 'category', boundaryGap: false, data: times.map(time), axisLabel: { ...axis.axisLabel, interval: Math.max(1, Math.floor(times.length / 6)) } },
        yAxis: { ...axis, type: 'value', name: data.unit, nameTextStyle: { color: '#829396', fontSize: 10 }, min: 0 },
        series: data.series.map(s => ({
          name: s.name, type: 'line', data: times.map(t => new Map(s.points).get(t) ?? null), showSymbol: false,
          lineStyle: { width: 2 }, areaStyle: { opacity: 0.035 }, emphasis: { focus: 'series' },
        })),
      });
    } else {
      const data = artifact.data as HeatmapData;
      if (!Array.isArray(data?.cells) || !Array.isArray(data?.times)) { chart.dispose(); return; }
      times = data.times;
      chart.setOption({
        ...common, grid: { left: 76, right: 14, top: 12, bottom: 56 },
        tooltip: { ...common.tooltip, trigger: 'item' },
        xAxis: { ...axis, type: 'category', data: times.map(time), splitArea: { show: false }, axisLabel: { ...axis.axisLabel, interval: Math.max(1, Math.floor(times.length / 6)) } },
        yAxis: { ...axis, type: 'category', data: data.buckets, splitLine: { show: false }, axisLabel: { color: '#829396', fontSize: 10, fontFamily: 'monospace' } },
        visualMap: { min: 0, max: Math.max(1, ...data.cells.map(c => c[2])), calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemWidth: 9, itemHeight: 92, text: ['more requests', 'fewer'], textStyle: { color: '#829396', fontSize: 9 }, inRange: { color: ['#182c2e', '#245a50', '#529a78', '#a9d594', '#e5d6a1'] } },
        series: [{ type: 'heatmap', data: data.cells, itemStyle: { borderWidth: 1, borderColor: '#142025' }, emphasis: { itemStyle: { borderColor: '#e7e4c1', borderWidth: 1 } } }],
      });
    }
    if (onSelect) {
      chart.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: 'lineX', brushMode: 'single' } });
      chart.on('brushEnd', (event: unknown) => {
        const range = (event as { areas?: { coordRange?: number[] }[] }).areas?.[0]?.coordRange;
        if (!range?.length) return;
        const a = Math.max(0, Math.min(times.length - 1, Math.round(range[0])));
        const b = Math.max(0, Math.min(times.length - 1, Math.round(range[1])));
        if (times[a] === times[b]) return;
        onSelect({ from: Math.min(times[a], times[b]), to: Math.max(times[a], times[b]), parentId: artifact.id });
      });
    }
    const resize = new ResizeObserver(() => chart.resize()); resize.observe(ref.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, [artifact, onSelect]);
  return <div ref={ref} className="chart" aria-label={artifact.title} />;
}
export function ArtifactView({ artifact, onSelect }: { artifact: Artifact; onSelect?: (selection: Selection) => void }) {
  if (artifact.view === 'line' || artifact.view === 'heatmap') {
    const valid = artifact.view === 'line' ? seriesDataSchema.safeParse(artifact.data).success : heatmapDataSchema.safeParse(artifact.data).success;
    if (valid) return <Chart artifact={artifact} onSelect={onSelect} />;
    return <div><p className="view-fallback">This output needs a chart transform. The saved JSON is shown below.</p><pre className="json-preview">{JSON.stringify(artifact.data, null, 2)?.slice(0, 16000)}</pre></div>;
  }
  if (artifact.view === 'custom' && artifact.fallbackSvg) {
    // Image documents cannot run scripts; the server additionally validates every SVG node/attribute.
    return <img className="custom-view" src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(artifact.fallbackSvg)} alt={artifact.title} />;
  }
  const tableData = artifact.data && typeof artifact.data === 'object' && 'data' in artifact.data && Array.isArray(artifact.data.data)
    ? artifact.data.data : artifact.data;
  if (artifact.view === 'table' && Array.isArray(tableData)) {
    if (!tableData.length) return <p className="view-fallback">The query returned no rows. Its request and full response are saved.</p>;
    const rows = tableData.slice(0, 100) as Record<string, unknown>[];
    const columns = [...new Set(rows.flatMap(r => r && typeof r === 'object' ? Object.keys(r) : ['value']))].slice(0, 8);
    return <div className="table-scroll"><table className="data-table"><thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{columns.map(c => <td key={c}>{formatValue(r && typeof r === 'object' ? r[c] : r)}</td>)}</tr>)}</tbody></table>
      {tableData.length > 100 && <small>Showing the first 100 rows. Full output is preserved in the artifact.</small>}</div>;
  }
  return <pre className="json-preview">{JSON.stringify(artifact.data, null, 2)?.slice(0, 16000)}</pre>;
}
function formatValue(value: unknown): string {
  return value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
}
