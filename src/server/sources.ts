import { DEMO_FROM, DEMO_TO, type HeatmapData, type SeriesData } from '../shared/model';
import { captureSQL, type CloudflareSQLEnv } from './cloudflare-sql';
import type { SQLTransport } from '../shared/sql';

export type SourceEnv = CloudflareSQLEnv;
export type Capture = {
  data: unknown;
  query: Record<string, unknown>;
  source: { name: string; uri?: string; collectedAt: string };
  transport?: SQLTransport;
};

export async function capture(source: string, input: Record<string, unknown>, env: SourceEnv, transport?: SQLTransport): Promise<Capture> {
  if (source === 'demo-telemetry') return fixture(input);
  if (source !== 'cloudflare') throw new Error('Unknown source');
  return captureSQL(input, env, transport);
}

function fixture(input: Record<string, unknown>): Capture {
  const metric = String(input.metric ?? 'latency');
  if (!['latency', 'heatmap', 'errors'].includes(metric)) throw new Error('Demo metrics: latency, heatmap, errors.');
  const from = Number(input.from ?? DEMO_FROM), to = Number(input.to ?? DEMO_TO);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || from < DEMO_FROM || to > DEMO_TO) {
    throw new Error('The demo fixture covers 2026-10-03 10:00–11:00 UTC. Select a range inside that hour.');
  }
  const times = Array.from({ length: 61 }, (_, i) => DEMO_FROM + i * 60000).filter(t => t >= from && t <= to);
  if (times.length < 2) throw new Error('Select at least one minute of demo data.');
  const region = String(input.region ?? 'all');
  if (!['all', 'eu-west', 'us-east'].includes(region)) throw new Error('Unknown demo region.');
  const query = { metric, from, to, service: 'checkout-api', region, resolution: '1m' };
  let data: SeriesData | HeatmapData;
  const latency = (t: number, affected: boolean) => {
    const i = (t - DEMO_FROM) / 60000;
    const wave = Math.sin(i * 1.7) * 12 + Math.cos(i * 0.7) * 9;
    return Math.round(108 + wave + (affected && i >= 24 ? Math.min((i - 23) * 90, 560) + Math.sin(i) * 42 : 0));
  };
  if (metric === 'heatmap') {
    const buckets = ['0–100', '100–200', '200–400', '400–800', '800–1600', '1600–3200'];
    const cells: HeatmapData['cells'] = [];
    times.forEach((t, x) => {
      const i = (t - DEMO_FROM) / 60000;
      for (let y = 0; y < buckets.length; y++) {
        const slow = i >= 24 && region !== 'us-east';
        const counts = slow ? [12, 30, 18, 58, 30, 9] : [68, 42, 12, 2, 0, 0];
        cells.push([x, y, Math.max(0, Math.round(counts[y] + Math.sin(i * 0.8 + y) * Math.min(counts[y], 8)))]);
      }
    });
    data = { times, buckets, cells, unit: 'requests / latency bucket (ms)' };
  } else {
    data = {
      unit: metric === 'errors' ? '%' : 'ms',
      series: ['eu-west', 'us-east'].filter(r => region === 'all' || region === r).map(name => ({
        name,
        points: times.map(t => [t, metric === 'errors'
          ? Math.round((name === 'eu-west' && t >= DEMO_FROM + 24 * 60000 ? 4.2 + Math.sin(t / 60000) : 0.15) * 100) / 100
          : latency(t, name === 'eu-west')]),
      })),
    };
  }
  return {
    query, data,
    source: { name: 'Telemetry fixture', uri: 'fixture://checkout-incident/v1', collectedAt: new Date().toISOString() },
  };
}

export const deploymentData = [
  { time: '10:08:12', service: 'payments', version: 'v3.8.1', region: 'all', change: 'Routine release' },
  { time: '10:23:41', service: 'checkout-api', version: 'v2.14.0', region: 'eu-west', change: 'Enable synchronous inventory retries' },
  { time: '10:24:09', service: 'checkout-api', version: 'v2.14.0', region: 'eu-west', change: 'Rollout complete · 100%' },
];
export const retryData = [
  { stage: 'Authenticate', start: 0, duration: 26, type: 'work' },
  { stage: 'Inventory · attempt 1', start: 32, duration: 112, type: 'work' },
  { stage: 'Retry backoff', start: 144, duration: 200, type: 'wait' },
  { stage: 'Inventory · attempt 2', start: 344, duration: 108, type: 'work' },
  { stage: 'Retry backoff', start: 452, duration: 200, type: 'wait' },
  { stage: 'Inventory · attempt 3', start: 652, duration: 105, type: 'work' },
  { stage: 'Complete checkout', start: 757, duration: 31, type: 'work' },
];
