import { z } from 'zod';

const parameter = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const tag = z.string().regex(/^[a-f0-9]{32}$/, 'Use a 32-character lowercase account or zone ID.');
export const sqlParametersSchema = z.union([z.array(parameter), z.record(z.string(), parameter)]);
export const sqlQuerySchema = z.object({
  query: z.string().min(1).max(20000).refine(value => value.trim().length > 0, 'SQL is required.'),
  params: sqlParametersSchema.optional(),
  scope: z.union([
    z.object({ accountTag: tag }).strict(),
    z.object({ zoneTag: tag }).strict(),
  ]).optional(),
  time_range: z.object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }).optional(),
  }).strict().refine(range => !range.end || Date.parse(range.start) <= Date.parse(range.end), 'End must follow start.').optional(),
}).strict();
export type SQLQuery = z.infer<typeof sqlQuerySchema>;
export type SQLTransport = 'binding' | 'http';
export type SQLDataset = {
  name: string; title?: string; description?: string;
  kind?: Record<string, { sampling?: string; valid_aggregations?: string[] }>;
  columns?: { name: string; description?: string; data_type: string }[];
};
export const DEFAULT_SQL = 'SELECT edgeResponseStatus AS status, COUNT(*) AS requests\n' +
  'FROM events.httpRequests\n' +
  'WHERE timestamp >= $start AND timestamp <= $end\n' +
  'GROUP BY edgeResponseStatus\n' +
  'ORDER BY requests DESC\nLIMIT 20';

export const datasetOptionsSchema = z.object({
  dataset_name: z.string().trim().min(1).max(300).optional(),
  include_columns: z.boolean().default(false),
  include_custom_attributes: z.boolean().default(false),
  include_wae: z.boolean().default(true),
  include_lex: z.boolean().default(true),
}).strict().refine(options => !options.include_custom_attributes || !!options.dataset_name,
  'Choose a dataset before discovering custom attributes.');
export type DatasetOptions = z.input<typeof datasetOptionsSchema>;
