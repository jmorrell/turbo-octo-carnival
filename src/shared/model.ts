import { z } from 'zod';

export const actorSchema = z.object({
  name: z.string().trim().min(1).max(60),
  harness: z.string().trim().max(40).default('human'),
});
export type Actor = z.infer<typeof actorSchema>;
export const viewSchema = z.enum(['line', 'heatmap', 'table', 'json', 'custom']);
export type ViewKind = z.infer<typeof viewSchema>;
export const querySchema = z.object({
  source: z.enum(['demo-telemetry', 'cloudflare']),
  query: z.record(z.string(), z.unknown()),
  transport: z.enum(['binding', 'http']).optional(),
  title: z.string().trim().min(1).max(160),
  branchId: z.string().max(80).default('main'),
  parentIds: z.array(z.string().max(80)).max(20).default([]),
  view: viewSchema.exclude(['custom']).default('json'),
  actor: actorSchema,
});
export const importSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000).default(''),
  branchId: z.string().max(80).default('main'),
  parentIds: z.array(z.string().max(80)).max(20).default([]),
  source: z.object({
    name: z.string().trim().min(1).max(100),
    uri: z.string().max(2000).optional(),
    collectedAt: z.string().datetime().optional(),
  }),
  recipe: z.string().max(12000).optional(),
  data: z.unknown().refine(value => value !== undefined, 'data is required'),
  view: viewSchema.exclude(['custom']).default('json'),
  actor: actorSchema,
});
export const drawingSchema: z.ZodType<Drawing> = z.lazy(() => z.object({
  tag: z.enum(['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'title', 'desc']),
  attrs: z.record(z.string(), z.union([z.string().max(20000), z.number().finite()])).optional(),
  text: z.string().max(20000).optional(),
  children: z.array(drawingSchema).max(2000).optional(),
}));
export type Drawing = {
  tag: 'svg' | 'g' | 'rect' | 'circle' | 'ellipse' | 'line' | 'polyline' | 'polygon' | 'path' | 'text' | 'tspan' | 'title' | 'desc';
  attrs?: Record<string, string | number>;
  text?: string;
  children?: Drawing[];
};
export type Branch = {
  id: string; title: string; parentId?: string; anchorId?: string;
  inheritedIds: string[]; createdAt: string; actor: Actor;
};
export type Evidence = {
  id: string; title: string; description: string; branchId: string;
  parentIds: string[]; createdAt: string; actor: Actor; kind: 'observation' | 'finding';
  source: { name: string; uri?: string; collectedAt?: string };
  origin: 'captured' | 'imported' | 'derived' | 'inference';
  view: ViewKind; rendererVersion: string;
  sha256: string; bytes: number;
  recipe?: { source: string; query?: Record<string, unknown>; instructions?: string; transport?: 'binding' | 'http' };
  component?: { code: string; hash: string; inputIds: string[] };
  status?: 'open' | 'supported' | 'disproven';
};
export type Artifact = Evidence & { data: unknown; fallbackSvg?: string };
export type RoomEvent = { seq: number; type: string; actor: Actor; at: string; targetId?: string };
export type RoomState = {
  id: string; title: string; createdAt: string; branches: Branch[];
  evidence: Evidence[]; events: RoomEvent[]; cursor: number;
};
export type SeriesData = { unit: string; series: { name: string; points: [number, number | null][] }[] };
export type HeatmapData = { times: number[]; buckets: string[]; cells: [number, number, number][]; unit: string };
const timestamp = z.number().finite().min(-8640000000000000).max(8640000000000000);
export const seriesDataSchema = z.object({
  unit: z.string(), series: z.array(z.object({
    name: z.string(), points: z.array(z.tuple([timestamp, z.number().finite().nullable()])),
  })).min(1),
});
export const heatmapDataSchema = z.object({
  unit: z.string(), times: z.array(timestamp).min(1), buckets: z.array(z.string()).min(1),
  cells: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().finite().nonnegative()])),
}).refine(d => d.cells.every(([x, y]) => x < d.times.length && y < d.buckets.length), 'Bucket coordinates must refer to existing axes');
export const DEMO_FROM = Date.UTC(2026, 9, 3, 10, 0);
export const DEMO_TO = DEMO_FROM + 60 * 60 * 1000;
