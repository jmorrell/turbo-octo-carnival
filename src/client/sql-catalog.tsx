import { useState } from 'react';
import { RoomClient } from './api';
import type { SQLDataset } from '../shared/sql';

export function SQLCatalog({ client }: { client: RoomClient }) {
  const [datasets, setDatasets] = useState<SQLDataset[]>([]);
  const [selected, setSelected] = useState<SQLDataset | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function load(name?: string, custom = false) {
    setBusy(true); setError('');
    try {
      const options = new URLSearchParams();
      if (name) { options.set('dataset_name', name); options.set('include_columns', 'true'); }
      if (custom) options.set('include_custom_attributes', 'true');
      const result = await client.get<{ datasets: SQLDataset[] }>('/sources/cloudflare/datasets?' + options);
      if (name) setSelected(result.datasets[0] ?? null); else { setDatasets(result.datasets); setSelected(null); }
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <details className="sql-catalog"><summary>Explore datasets and columns</summary>
    <p className="muted">Discover the current catalog before choosing a dataset or field. Sampling and availability vary by dataset.</p>
    <button className="button" type="button" disabled={busy} onClick={() => void load()}>{busy ? 'Loading…' : 'Load dataset catalog'}</button>
    {!!datasets.length && <label>Dataset<select aria-label="Dataset" value={selected?.name ?? ''} onChange={e => void load(e.target.value)} disabled={busy}>
      <option value="" disabled>Select a dataset to inspect its columns</option>
      {datasets.map(dataset => <option key={dataset.name} value={dataset.name}>{dataset.name}</option>)}
    </select></label>}
    {selected && <><p>{selected.description}</p><pre className="code-block data-code">{JSON.stringify(selected, null, 2)}</pre>
      <button className="button" type="button" disabled={busy} onClick={() => void load(selected.name, true)}>Discover recent custom attributes</button>
      <p className="muted">Custom attribute discovery reads the last seven days and may return a partial list.</p></>}
    {error && <div className="error">{error}</div>}
  </details>;
}
