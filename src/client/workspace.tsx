import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, Braces, Check, ChevronDown, CircleHelp,
  Code2, Copy, Database, ExternalLink, FileJson, FlaskConical, GitBranch, GitFork,
  Layers, Link2, LoaderCircle, MessageSquare, MoreHorizontal, Play, Plus,
  Radio, RefreshCw, Search, ShieldCheck, Sparkles, Terminal, X, Zap,
} from 'lucide-react';
import type { Actor, Artifact, Branch, Evidence, ViewKind } from '../shared/model';
import { DEMO_FROM, DEMO_TO } from '../shared/model';
import { download, request, RoomClient, roomKey, type State } from './api';
import { ArtifactView, type Selection } from './views';

const originLabel = { captured: 'Adapter capture', imported: 'Agent-supplied origin', derived: 'Saved transformation', inference: 'Investigator interpretation' };
const viewLabel = { line: 'Time series', heatmap: 'Heatmap', table: 'Table', json: 'JSON', custom: 'Custom component' };
const when = (date: string) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }) + ' UTC';
const initialActor = (): Actor => {
  try { return JSON.parse(localStorage.getItem('fieldwork:actor') ?? 'null') ?? { name: 'You', harness: 'human' }; }
  catch { return { name: 'You', harness: 'human' }; }
};
function Mark({ small = false }: { small?: boolean }) {
  return <span className={'mark ' + (small ? 'small' : '')}><span /><span /><span /><i /></span>;
}
function Button({ children, onClick, primary, disabled, className = '', title, type = 'button' }: {
  children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean; className?: string; title?: string; type?: 'button' | 'submit';
}) {
  return <button type={type} title={title} className={'button ' + (primary ? 'primary ' : '') + className} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Modal({ title, subtitle, children, onClose, wide }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => { const close = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={'modal ' + (wide ? 'wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>{children}
    </section></div>;
}

export default function App() {
  const id = location.pathname.match(/^\/r\/([a-f0-9-]{36})/)?.[1];
  return id ? <Workspace id={id} /> : <Landing />;
}
function Landing() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [key, setKey] = useState('');
  const [title, setTitle] = useState('Checkout latency regression');
  async function create(sample: boolean) {
    setBusy(true); setError('');
    try {
      const room = await request<{ url: string }>('/api/rooms', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
        body: JSON.stringify({ title: sample ? 'Checkout latency regression' : title, sample, actor: initialActor() }),
      });
      location.assign(room.url);
    } catch (e) { setError(String((e as Error).message)); setBusy(false); }
  }
  return <div className="landing">
    <nav className="landing-nav"><a href="/" className="brand"><Mark />fieldwork<span className="poc">LAB / 01</span></a><span className="mono muted">HUMANS + AGENTS</span></nav>
    <main className="landing-main">
      <div className="eyebrow"><span className="status-dot" /> A SHARED PLACE TO FIGURE THINGS OUT</div>
      <h1>Follow the evidence.<br /><span>Bring your own agent.</span></h1>
      <p className="landing-description">Turn scattered queries, one-off charts, and “I think it’s this” into an investigation your whole team can see, verify, and continue.</p>
      <div className="landing-actions"><Button primary disabled={busy} onClick={() => create(true)}>{busy ? <LoaderCircle className="spin" size={17} /> : <FlaskConical size={17} />} Explore an example <ArrowRight size={17} /></Button><span>Synthetic incident · real persistence</span></div>
      <div className="landing-preview">
        <div className="preview-top"><span className="status-dot" /><span>checkout-api / eu-west</span><span className="mono">10:00 — 11:00 UTC</span></div>
        <svg viewBox="0 0 760 160" aria-label="Illustration of latency increasing after a deployment">
          {[40, 80, 120].map(y => <line key={y} x1="20" x2="740" y1={y} y2={y} stroke="#2b383b" strokeDasharray="4 5" />)}
          <path d="M20 130 L60 127 L100 131 L140 125 L180 128 L220 122 L260 126 L300 121 L340 126 L360 127 L380 105 L400 71 L420 35 L440 42 L460 28 L480 36 L500 24 L520 31 L540 39 L560 26 L580 37 L600 28 L620 31 L640 23 L680 33 L720 27 L740 31" stroke="#98d7b9" strokeWidth="2.5" fill="none" />
          <path d="M20 131 L80 128 L140 132 L200 129 L260 134 L320 128 L380 133 L440 130 L500 135 L560 130 L620 136 L680 132 L740 129" stroke="#7192b4" strokeWidth="2" fill="none" />
          <line x1="375" x2="375" y1="12" y2="150" stroke="#d1aa70" strokeDasharray="4 5" /><text x="386" y="15" fill="#d1aa70" fontSize="10" fontFamily="monospace">DEPLOY v2.14.0</text>
        </svg>
        <div className="preview-bottom"><span><ShieldCheck size={14} /> Original query + saved result</span><span><GitFork size={14} /> Ready to fork</span><span><Braces size={14} /> Your tools, your views</span></div>
      </div>
      <div className="new-room"><div><h3>Have a different question?</h3><p>Start empty and let your agent add evidence from any source.</p></div>
        <form onSubmit={e => { e.preventDefault(); void create(false); }}><input aria-label="Investigation title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Investigation title" required maxLength={160} /><Button type="submit" disabled={busy || !title.trim()}>Start investigation <ArrowRight size={15} /></Button></form>
        <details><summary>Hosted workspace access</summary><input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="Workspace creation key" aria-label="Workspace creation key" autoComplete="off" /></details>
      </div>{error && <div className="error">{error}</div>}
    </main><footer className="landing-footer"><span>Open evidence. Extensible views. Shared understanding.</span><span className="mono">BUILT ON CLOUDFLARE</span></footer>
  </div>;
}

function Workspace({ id }: { id: string }) {
  const client = useMemo(() => new RoomClient(id, roomKey(id)), [id]);
  const [state, setState] = useState<State | null>(null), [artifacts, setArtifacts] = useState<Record<string, Artifact>>({});
  const [branchId, setBranch] = useState('main'), [actor, setActor] = useState<Actor>(initialActor);
  const [selected, setSelected] = useState<string | null>(new URLSearchParams(location.search).get('evidence'));
  const [dialog, setDialog] = useState<string | null>(null), [error, setError] = useState(''), [toast, setToast] = useState('');
  const [connected, setConnected] = useState(false), [busy, setBusy] = useState(false), [search, setSearch] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null), [queryInitial, setQueryInitial] = useState<Selection | null>(null);
  const refreshGeneration = useRef(0);
  const artifactCache = useRef<Record<string, Artifact>>({});
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    try {
      const next = await client.state();
      if (generation !== refreshGeneration.current) return;
      setState(next); setError('');
      const missing = next.evidence.filter(e => !artifactCache.current[e.id]);
      const fetched = await Promise.allSettled(missing.map(e => client.artifact(e.id)));
      for (const result of fetched) if (result.status === 'fulfilled') artifactCache.current[result.value.id] = result.value;
      setArtifacts({ ...artifactCache.current });
      if (fetched.some(r => r.status === 'rejected')) setError('Some saved artifacts could not be loaded. Refresh to retry.');
    } catch (e) { setError((e as Error).message); }
  }, [client]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    let socket: WebSocket | undefined, reconnect: ReturnType<typeof setTimeout> | undefined, stopped = false;
    let attempts = 0;
    function connect() {
      const url = new URL(client.path('/live'), location.origin);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('name', actor.name); url.searchParams.set('harness', actor.harness);
      socket = new WebSocket(url, ['fieldwork', client.key]);
      socket.onopen = () => { attempts = 0; setConnected(true); void refresh(); };
      socket.onmessage = e => { if (e.data !== 'pong') void refresh(); };
      socket.onclose = () => { setConnected(false); if (!stopped) reconnect = setTimeout(connect, Math.min(5000, 500 * 2 ** attempts++)); };
      socket.onerror = () => socket?.close();
    }
    if (client.key) connect();
    const heartbeat = setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send('ping'); }, 25000);
    const focus = () => void refresh(); window.addEventListener('focus', focus);
    return () => { stopped = true; clearTimeout(reconnect); clearInterval(heartbeat); socket?.close(); window.removeEventListener('focus', focus); };
  }, [client, actor, refresh]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => {
    const url = new URL(location.href);
    if (selected) url.searchParams.set('evidence', selected); else url.searchParams.delete('evidence');
    history.replaceState(null, '', url);
  }, [selected]);
  const branch = state?.branches.find(b => b.id === branchId);
  const visible = state?.evidence.filter(e => (e.branchId === branchId || branch?.inheritedIds.includes(e.id)) && (
    !search || [e.title, e.source.name, e.description, e.actor.name, e.actor.harness].join(' ').toLowerCase().includes(search.toLowerCase())
  )) ?? [];
  const current = selected ? state?.evidence.find(e => e.id === selected) : undefined;
  const pickRange = useCallback((value: Selection) => setSelection(value), []);
  async function run<T>(operation: () => Promise<T>, success: string): Promise<T | undefined> {
    setBusy(true); setError('');
    try { const result = await operation(); await refresh(); setToast(success); return result; }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function copy(value: string, success = 'Copied to clipboard') {
    try { await navigator.clipboard.writeText(value); setToast(success); } catch { setError('Clipboard is unavailable. Copy the text from the dialog.'); }
  }
  async function exportRoom() {
    const result = await run(() => client.get('/export'), 'Investigation exported');
    if (result) download('fieldwork-' + id.slice(0, 8) + '.json', JSON.stringify(result, null, 2));
  }
  if (!state) return <div className="loading-page"><Mark /><h2>{error ? 'Unable to open this investigation' : 'Opening the investigation…'}</h2>
    {error ? <><p>{error}</p><a href="/" className="button">Back to Fieldwork</a><Button onClick={() => void refresh()}>Retry</Button></> : <LoaderCircle className="spin" />}</div>;
  return <div className="workspace">
    <header className="topbar">
      <a href="/" className="brand"><Mark small />fieldwork</a><span className="breadcrumb"><ChevronDown size={12} /> Investigations <span>/</span> <strong>{state.title}</strong></span>
      <div className="topbar-right"><span className={'live-status ' + (connected ? '' : 'offline')}><span className="status-dot" />{connected ? 'Live workspace' : 'Reconnecting'}</span><Button onClick={() => setDialog('agent')}><Terminal size={14} /> Connect agent</Button><Button primary onClick={() => setDialog('share')}><Link2 size={14} /> Share</Button></div>
    </header>
    <div className="workspace-body">
      <aside className="sidebar">
        <div className="sidebar-heading"><span>INVESTIGATION</span><span className="mono">01</span></div>
        <button className={'nav-item ' + (branchId === 'main' ? 'active' : '')} onClick={() => setBranch('main')}><Layers size={16} />Shared evidence<span className="count">{state.evidence.filter(e => e.branchId === 'main').length}</span></button>
        <div className="sidebar-heading threads-heading"><span>THREADS</span><button className="icon-button" aria-label="New investigation thread" onClick={() => setDialog('fork')}><Plus size={14} /></button></div>
        {state.branches.filter(b => b.id !== 'main').map(b => <button key={b.id} className={'nav-item thread ' + (branchId === b.id ? 'active' : '')} onClick={() => { setBranch(b.id); setSearch(''); }}><GitBranch size={15} /><span>{b.title}<small>{b.actor.name} · {b.actor.harness}</small></span></button>)}
        {state.branches.length === 1 && <div className="sidebar-hint">Follow a different lead.<br />Fork any piece of evidence.</div>}
        <button className="new-thread" onClick={() => setDialog('fork')}><Plus size={13} /> New thread</button>
        <div className="sidebar-heading sources-heading"><span>SOURCES</span><button className="icon-button" aria-label="View data sources" onClick={() => setDialog('sources')}><Plus size={14} /></button></div>
        {[...new Set(state.evidence.filter(e => e.kind !== 'finding' && e.origin !== 'derived').map(e => e.source.name))].map((s, i) => <div className="source-item" key={s}><span className={'source-dot source-' + i} /><span>{s}</span></div>)}
        <button className="new-thread" onClick={() => setDialog('import')}><Plus size={13} /> Bring your own data</button>
        <div className="sidebar-bottom"><div className="sidebar-heading"><span>IN THIS WORKSPACE</span><Radio size={13} /></div>
          {[...new Map(state.peers.map(p => [p.name + p.harness, p])).values()].map((p, i) => <div className="person" key={p.name + p.harness}><span className={'avatar avatar-' + i}>{p.name.slice(0, 1).toUpperCase()}</span><span>{p.name}<small>{p.harness === 'human' ? 'Here now' : p.harness}</small></span><span className="presence-dot" /></div>)}
          <button className="identity" onClick={() => setDialog('identity')}><span className="avatar">{actor.name.slice(0, 1)}</span><span>{actor.name}<small>Edit your display name</small></span><MoreHorizontal size={16} /></button>
        </div>
      </aside>
      <main className={'main-content ' + (selected ? 'with-inspector' : '')}>
        <div className="page-heading">
          <div className="eyebrow"><span className="incident-state"><span className="status-dot" /> INVESTIGATING</span><span className="mono">{state.sample ? 'SYNTHETIC INCIDENT' : 'SHARED WORKSPACE'}</span></div>
          <div className="title-row"><h1>{branchId === 'main' ? state.title : branch?.title}</h1><Button title="Export the investigation and all saved outputs" disabled={busy} onClick={() => void exportRoom()}><ArrowDownToLine size={15} /><span>Export</span></Button></div>
          <p className="page-description">{branchId === 'main' ? 'Every finding has a trail. Every trail is yours to follow.' : 'An independent thread with a snapshot of the evidence it started from.'}</p>
          <div className="investigation-meta"><span><Database size={13} />{new Set(state.evidence.filter(e => e.kind !== 'finding' && e.origin !== 'derived').map(e => e.source.name)).size} sources</span><span><FileJson size={13} />{state.evidence.filter(e => e.kind !== 'finding').length} saved artifacts</span><span><GitBranch size={13} />{state.branches.length} {state.branches.length === 1 ? 'thread' : 'threads'}</span>{state.sample && <span className="time-range">03 OCT 2026 <i />10:00 — 11:00 UTC</span>}</div>
        </div>
        <label className="mobile-thread-picker">Investigation thread<select aria-label="Investigation thread" value={branchId} onChange={e => setBranch(e.target.value)}>{state.branches.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</select></label>
        {error && <div className="error banner"><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
        {selection && <div className="selection-bar"><Search size={15} /><span>Selected <strong>{when(new Date(selection.from).toISOString())} – {when(new Date(selection.to).toISOString())}</strong></span><Button primary onClick={() => { setQueryInitial(selection); setDialog('query'); }}>Investigate this range <ArrowRight size={14} /></Button><Button onClick={() => void copy(JSON.stringify(selection, null, 2), 'Structured selection copied for your agent')}><Copy size={13} /></Button><button className="icon-button" onClick={() => setSelection(null)} aria-label="Clear selection"><X size={14} /></button></div>}
        <div className="board-toolbar"><div className="board-tabs"><button className="board-tab active"><Layers size={14} />Evidence<span>{visible.length}</span></button><button className="board-tab" onClick={() => setDialog('activity')}><Radio size={14} />Activity</button></div><div className="board-actions"><label className="search-input"><Search size={14} /><input aria-label="Search evidence" placeholder="Find evidence…" value={search} onChange={e => setSearch(e.target.value)} /></label><Button onClick={() => { setQueryInitial(null); setDialog('query'); }}><Play size={13} />Query</Button><Button onClick={() => setDialog('import')}><Plus size={14} />Add evidence</Button></div></div>
        <div className="evidence-grid">
          {visible.map(e => <EvidenceCard key={e.id} evidence={e} artifact={artifacts[e.id]} selected={selected === e.id}
            inherited={e.branchId !== branchId} onInspect={() => setSelected(e.id)} onFork={() => { setSelected(e.id); setDialog('fork'); }}
            onSelect={pickRange} onCitation={id => setSelected(id)} allEvidence={state.evidence} />)}
          {visible.length === 0 && <div className="empty-state"><FlaskConical size={34} /><h2>{search ? 'No matching evidence' : 'A question is a good place to start.'}</h2><p>{search ? 'Try a source, investigator, or a word from a finding.' : 'Run a query, import what you already found, or connect your agent.'}</p>{!search && <Button primary onClick={() => setDialog('import')}><Plus size={15} />Add the first artifact</Button>}</div>}
        </div>
        <div className="board-footer"><span><ShieldCheck size={13} />Published outputs are saved independently of the source.</span><button onClick={() => setDialog('finding')}><MessageSquare size={14} /> Add a finding</button></div>
      </main>
      {current && <Inspector evidence={current} artifact={artifacts[current.id]} allEvidence={state.evidence} busy={busy}
        onClose={() => setSelected(null)} onSelect={id => setSelected(id)} onFork={() => setDialog('fork')}
        onRerun={() => void run(() => client.rerun(current, actor, branchId), 'New revision saved. Original evidence preserved.')}
        onComponent={() => setDialog('component')} onCopy={() => void copy(location.href, 'Evidence link copied')} />}
    </div>
    {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    {dialog === 'query' && <QueryDialog actor={actor} branchId={branchId} initial={queryInitial} onClose={() => setDialog(null)} onSubmit={async data => {
      const result = await run(() => client.post<Evidence>('/query', data), 'Query captured and saved');
      if (result) { setSelected(result.id); setDialog(null); setSelection(null); }
    }} busy={busy} />}
    {dialog === 'import' && <ImportDialog actor={actor} branchId={branchId} onClose={() => setDialog(null)} busy={busy} onSubmit={async data => {
      const result = await run(() => client.post<Evidence>('/evidence', data), 'Evidence saved');
      if (result) { setSelected(result.id); setDialog(null); }
    }} />}
    {dialog === 'fork' && <TextDialog title="Follow another lead" subtitle={current ? 'Fork from “' + current.title + '”. Its saved evidence stays attached.' : 'Create an independent thread from the current investigation.'} label="Thread name" placeholder="Is the retry policy amplifying latency?" action="Create thread" onClose={() => setDialog(null)} busy={busy} onSubmit={async title => {
      const anchor = current && (current.branchId === branchId || branch?.inheritedIds.includes(current.id)) ? current.id : undefined;
      const result = await run(() => client.post<Branch>('/branches', { title, fromBranchId: branchId, anchorId: anchor, actor }), 'Investigation thread created');
      if (result) { setBranch(result.id); setDialog(null); setSelected(null); }
    }} />}
    {dialog === 'identity' && <TextDialog title="Your place in the investigation" subtitle="Display names are self-declared in this PoC. Invite keys control access." label="Display name" placeholder="Your name" action="Save name" initial={actor.name} onClose={() => setDialog(null)} onSubmit={name => {
      const next = { name, harness: 'human' }; localStorage.setItem('fieldwork:actor', JSON.stringify(next)); setActor(next); setDialog(null);
    }} />}
    {dialog === 'share' && <Modal title="Bring someone into the investigation" subtitle="An invite grants read and edit access to this room, including every thread and saved artifact." onClose={() => setDialog(null)}>
      <div className="share-visual"><span className="avatar">{actor.name.slice(0, 1)}</span><span className="share-line" /><Mark /><span className="share-line" /><span className="avatar invite-avatar"><Plus size={20} /></span></div>
      <label>Investigation invite<input readOnly value={location.origin + '/r/' + id + '#key=' + client.key} onFocus={e => e.target.select()} /></label>
      <div className="modal-actions"><Button onClick={() => setDialog(null)}>Done</Button><Button primary onClick={() => void copy(location.origin + '/r/' + id + '#key=' + client.key, 'Invite link copied')}><Copy size={14} />Copy invite</Button></div>
    </Modal>}
    {dialog === 'agent' && <AgentDialog client={client} branchId={branchId} onClose={() => setDialog(null)} onCopy={copy} />}
    {dialog === 'sources' && <SourcesDialog onClose={() => setDialog(null)} onImport={() => setDialog('import')} />}
    {dialog === 'finding' && <FindingDialog evidence={visible.filter(e => e.kind === 'observation')} actor={actor} branchId={branchId} busy={busy} onClose={() => setDialog(null)} onSubmit={async data => {
      const result = await run(() => client.post('/findings', data), 'Finding published with evidence links'); if (result) setDialog(null);
    }} />}
    {dialog === 'component' && current && <ComponentDialog evidence={current} actor={actor} branchId={branchId} busy={busy} onClose={() => setDialog(null)} onSubmit={async data => {
      const result = await run(() => client.post<Evidence>('/components', data), 'Custom view rendered and archived');
      if (result) { setDialog(null); setSelected(result.id); }
    }} />}
    {dialog === 'activity' && <Modal title="Investigation activity" subtitle="Observable actions, shared by humans and agents." onClose={() => setDialog(null)}>
      <div className="activity-list">{[...state.events].reverse().map(e => <div key={e.seq}><span className="activity-dot" /><p><strong>{e.actor.name}</strong> {e.type}<small>{when(e.at)} · {e.actor.harness} · event {e.seq}</small></p>{e.targetId && state.evidence.some(a => a.id === e.targetId) && <button className="icon-button" aria-label="Inspect activity evidence" onClick={() => { setSelected(e.targetId!); setDialog(null); }}><ArrowRight size={15} /></button>}</div>)}</div>
    </Modal>}
    {dialog && error && <div className="dialog-error error" role="alert">{error}</div>}
  </div>;
}

function EvidenceCard({ evidence: e, artifact, selected, inherited, onInspect, onFork, onSelect, onCitation, allEvidence }: {
  evidence: Evidence; artifact?: Artifact; selected: boolean; inherited: boolean; onInspect: () => void; onFork: () => void;
  onSelect: (s: Selection) => void; onCitation: (id: string) => void; allEvidence: Evidence[];
}) {
  if (e.kind === 'finding') return <article className={'evidence-card finding-card ' + (selected ? 'selected' : '')} data-testid="evidence-card">
    <div className="finding-icon"><Sparkles size={18} /></div><div className="finding-content"><div className="card-eyebrow"><span>WORKING HYPOTHESIS</span><span className={'finding-status ' + e.status}>{e.status === 'open' ? 'Needs verification' : e.status}</span></div>
      <button className="card-title" onClick={onInspect}>{e.title}</button><p>{e.description}</p>
      <div className="citations">{e.parentIds.map((id, i) => <button key={id} onClick={() => onCitation(id)} title={allEvidence.find(a => a.id === id)?.title}><span>{i + 1}</span>{allEvidence.find(a => a.id === id)?.title ?? id}<ArrowRight size={11} /></button>)}</div>
      <div className="finding-byline">{e.actor.name} <span>via {e.actor.harness}</span><button onClick={onFork}><GitFork size={12} />Explore this lead</button></div>
    </div></article>;
  return <article className={'evidence-card ' + (selected ? 'selected ' : '') + (e.view === 'table' ? 'table-card ' : '')} data-testid="evidence-card">
    <div className="card-top"><div className="card-eyebrow"><span className={'source-dot ' + (e.origin === 'derived' ? 'source-2' : e.origin === 'imported' ? 'source-1' : 'source-0')} />{e.source.name}<span className="card-type">{e.view === 'custom' ? <><Code2 size={10} />CUSTOM</> : viewLabel[e.view]}</span></div><button className="icon-button" aria-label={'Inspect ' + e.title} onClick={onInspect}><MoreHorizontal size={17} /></button></div>
    <button className="card-title" onClick={onInspect}>{e.title}</button>
    <div className="card-view">{artifact ? <ArtifactView artifact={artifact} onSelect={onSelect} /> : <div className="card-loading"><LoaderCircle size={20} className="spin" /></div>}</div>
    <div className="card-bottom"><button className="provenance-button" onClick={onInspect}><ShieldCheck size={12} />Saved output <span>· {e.origin === 'captured' ? 'query attached' : e.origin === 'derived' ? 'code attached' : 'imported'}</span></button><span className="card-actor">{inherited && <span title="Inherited from the parent thread"><GitBranch size={11} /></span>}{e.actor.name}<span className="harness">{e.actor.harness}</span></span><button className="fork-button" aria-label={'Fork ' + e.title} onClick={onFork}><GitFork size={13} /></button></div>
  </article>;
}

function Inspector({ evidence: e, artifact, allEvidence, busy, onClose, onSelect, onFork, onRerun, onComponent, onCopy }: {
  evidence: Evidence; artifact?: Artifact; allEvidence: Evidence[]; busy: boolean; onClose: () => void; onSelect: (id: string) => void; onFork: () => void; onRerun: () => void; onComponent: () => void; onCopy: () => void;
}) {
  const [tab, setTab] = useState('origin');
  useEffect(() => setTab('origin'), [e.id]);
  return <aside className="inspector"><div className="inspector-top"><span><ShieldCheck size={15} />EVIDENCE DETAILS</span><button className="icon-button" onClick={onClose} aria-label="Close evidence details"><X size={17} /></button></div>
    <h2>{e.title}</h2><div className="inspector-id mono">{e.id.slice(0, 8)} <span>IMMUTABLE REVISION</span></div>
    <div className="inspector-actions"><Button onClick={onFork}><GitFork size={13} />Fork</Button><Button onClick={onCopy}><Link2 size={13} />Link</Button><Button title="Download complete artifact" disabled={!artifact} onClick={() => artifact && download(e.id + '.json', JSON.stringify(artifact, null, 2))}><ArrowDownToLine size={13} /></Button></div>
    <div className="inspector-tabs">{['origin', 'data', 'recipe'].map(t => <button className={tab === t ? 'active' : ''} key={t} onClick={() => setTab(t)}>{t === 'recipe' && e.component ? 'Code' : t[0].toUpperCase() + t.slice(1)}</button>)}</div>
    <div className="inspector-content">
      {tab === 'origin' && <><div className="origin-banner"><ShieldCheck size={16} /><div><span>{originLabel[e.origin]}</span><small>{e.origin === 'imported' ? 'Output is preserved. Source details were supplied by the investigator.' : e.origin === 'captured' ? 'The adapter recorded this query and its output together.' : e.origin === 'derived' ? 'Generated from saved inputs using the attached code.' : 'A conclusion to examine against its cited evidence.'}</small></div></div>
        <dl className="metadata"><dt>Source</dt><dd>{e.source.name}</dd><dt>Published by</dt><dd>{e.actor.name} · {e.actor.harness}</dd><dt>Saved</dt><dd>{new Date(e.createdAt).toLocaleDateString('en-GB')} · {when(e.createdAt)}</dd><dt>Output size</dt><dd>{(e.bytes / 1024).toFixed(1)} KiB</dd><dt>Renderer</dt><dd className="mono">{e.rendererVersion}</dd></dl>
        {e.source.uri && <><h4>SOURCE REFERENCE</h4><div className="code-block source-uri">{e.source.uri}</div></>}
        {e.description && <p className="inspector-description">{e.description}</p>}
        <h4>DATA SHA-256</h4><div className="hash code-block">{e.sha256}</div>
        {e.parentIds.length > 0 && <><h4>BUILT ON</h4>{e.parentIds.map(id => <button className="parent-link" key={id} onClick={() => onSelect(id)}><GitBranch size={13} /><span>{allEvidence.find(a => a.id === id)?.title ?? id}</span><ArrowRight size={13} /></button>)}</>}
        {e.kind !== 'finding' && <Button className="full-width make-component" onClick={onComponent}><Code2 size={14} />Build a custom view</Button>}
      </>}
      {tab === 'data' && <><p className="muted">The original saved output. Viewing this never queries the source.</p><pre className="code-block data-code">{artifact ? JSON.stringify(artifact.data, null, 2) : 'Loading…'}</pre></>}
      {tab === 'recipe' && <>{e.component ? <><p className="muted">JavaScript function over saved input artifacts. Runs in an isolated Worker with no network or secrets.</p><pre className="code-block data-code">{e.component.code}</pre><small className="muted">Code SHA-256: {e.component.hash}</small></> : e.recipe ? <><p className="muted">{e.recipe.query ? 'Exact resolved request. A rerun creates a new revision; results may change.' : 'Instructions supplied by the investigator. Your agent can execute these with its own tools.'}</p><pre className="code-block data-code">{e.recipe.query ? JSON.stringify(e.recipe, null, 2) : e.recipe.instructions}</pre></> : <div className="recipe-empty"><FileJson size={26} /><h3>Evidence is still useful without a recipe.</h3><p>This artifact has no rerun instructions. Its saved output remains available.</p></div>}
        {(e.component || e.recipe?.query) && <Button primary disabled={busy} className="full-width" onClick={onRerun}>{busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}Run again as a new revision</Button>}</>}
    </div>
  </aside>;
}

function TextDialog({ title, subtitle, label, placeholder, initial = '', action, onClose, onSubmit, busy }: {
  title: string; subtitle: string; label: string; placeholder: string; initial?: string; action: string; onClose: () => void; onSubmit: (text: string) => void; busy?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return <Modal title={title} subtitle={subtitle} onClose={onClose}><form onSubmit={e => { e.preventDefault(); onSubmit(value); }}><label>{label}<input autoFocus value={value} onChange={e => setValue(e.target.value)} required maxLength={60} placeholder={placeholder} /></label><div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button primary type="submit" disabled={busy || !value.trim()}>{busy && <LoaderCircle className="spin" size={14} />}{action}<ArrowRight size={14} /></Button></div></form></Modal>;
}
function QueryDialog({ actor, branchId, initial, onClose, onSubmit, busy }: { actor: Actor; branchId: string; initial: Selection | null; onClose: () => void; onSubmit: (data: unknown) => void; busy: boolean }) {
  const [source, setSource] = useState('demo-telemetry'), [view, setView] = useState<ViewKind>('line');
  const [title, setTitle] = useState(initial ? 'Closer look at the selected window' : 'Explore checkout latency');
  const [query, setQuery] = useState(JSON.stringify({ metric: 'latency', from: initial?.from ?? DEMO_FROM, to: initial?.to ?? DEMO_TO, region: 'all' }, null, 2));
  const [error, setError] = useState('');
  function changeSource(value: string) {
    setSource(value);
    if (value === 'cloudflare') { setView('json'); setQuery(JSON.stringify({ view: 'events', timeframe: { from: Date.now() - 3600000, to: Date.now() }, limit: 100, queryId: 'fieldwork', parameters: { datasets: ['cloudflare-workers'] } }, null, 2)); }
    else { setView('line'); setQuery(JSON.stringify({ metric: 'latency', from: DEMO_FROM, to: DEMO_TO }, null, 2)); }
  }
  return <Modal title="Ask the data a question" subtitle="The request and its output will be captured together. Your agent can use this same API." onClose={onClose} wide>
    <form onSubmit={e => { e.preventDefault(); try { setError(''); onSubmit({ title, source, query: JSON.parse(query), view, actor, branchId, parentIds: initial ? [initial.parentId] : [] }); } catch { setError('The query must be valid JSON.'); } }}>
      <label>Evidence title<input autoFocus value={title} onChange={e => setTitle(e.target.value)} required maxLength={160} /></label>
      <div className="form-row"><label>Data source<select value={source} onChange={e => changeSource(e.target.value)}><option value="demo-telemetry">Telemetry fixture</option><option value="cloudflare">Cloudflare O11y · requires connection</option></select></label><label>Visualization<select value={view} onChange={e => {
        const next = e.target.value as ViewKind; setView(next);
        if (source === 'demo-telemetry' && ['line', 'heatmap'].includes(next)) { try { setQuery(JSON.stringify({ ...JSON.parse(query), metric: next === 'heatmap' ? 'heatmap' : 'latency' }, null, 2)); } catch { /* keep edits */ } }
      }}><option value="line">Line chart</option><option value="heatmap">Heatmap</option><option value="table">Table</option><option value="json">JSON</option></select></label></div>
      <label>Native query<textarea className="code-editor" rows={10} value={query} onChange={e => setQuery(e.target.value)} spellCheck={false} /></label>
      <div className="form-note"><ShieldCheck size={14} />Outputs are saved before they appear in the investigation.</div>{error && <div className="error">{error}</div>}
      <div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button primary type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />}Run & capture</Button></div>
    </form>
  </Modal>;
}
function ImportDialog({ actor, branchId, onClose, onSubmit, busy }: { actor: Actor; branchId: string; onClose: () => void; onSubmit: (data: unknown) => void; busy: boolean }) {
  const [title, setTitle] = useState(''), [source, setSource] = useState('External tool'), [uri, setUri] = useState('');
  const [data, setData] = useState('[\n  { "service": "checkout-api", "observation": "Add what you found" }\n]'), [recipe, setRecipe] = useState('');
  const [view, setView] = useState('table'), [error, setError] = useState('');
  return <Modal title="Bring your evidence" subtitle="Any source. Any tool. A rerun recipe is useful, but optional." onClose={onClose} wide>
    <form onSubmit={e => { e.preventDefault(); try { setError(''); onSubmit({ title, source: { name: source, ...(uri ? { uri } : {}) }, data: JSON.parse(data), recipe: recipe || undefined, view, branchId, actor }); } catch { setError('The output must be valid JSON. Plain text can be a JSON string.'); } }}>
      <label>What did you find?<input autoFocus value={title} onChange={e => setTitle(e.target.value)} required maxLength={160} placeholder="Describe this piece of evidence" /></label>
      <div className="form-row"><label>Source name<input value={source} onChange={e => setSource(e.target.value)} required maxLength={100} /></label><label>Source reference · optional<input value={uri} onChange={e => setUri(e.target.value)} placeholder="URL, file path, or tool name" maxLength={2000} /></label></div>
      <label className="upload-label">Saved output <span><input type="file" accept=".json,.txt" aria-label="Load JSON file" onChange={async e => { const f = e.target.files?.[0]; if (f) { if (f.size > 1000000) return setError('Choose a file under 1 MiB.'); setData(await f.text()); if (!title) setTitle(f.name); } }} /></span></label>
      <textarea className="code-editor" aria-label="Evidence JSON" rows={8} value={data} onChange={e => setData(e.target.value)} spellCheck={false} />
      <div className="form-row"><label>View<select value={view} onChange={e => setView(e.target.value)}><option value="table">Table</option><option value="json">JSON</option><option value="line">Line chart · series schema</option><option value="heatmap">Heatmap · bucket schema</option></select></label><label>Rerun instructions · optional<input value={recipe} onChange={e => setRecipe(e.target.value)} placeholder="Command, query, or instructions" /></label></div>
      {error && <div className="error">{error}</div>}<div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button primary type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}Publish evidence</Button></div>
    </form>
  </Modal>;
}
function AgentDialog({ client, branchId, onClose, onCopy }: { client: RoomClient; branchId: string; onClose: () => void; onCopy: (value: string) => void }) {
  const config = JSON.stringify({ FIELDWORK_URL: location.origin, FIELDWORK_ROOM: client.id, FIELDWORK_KEY: client.key, FIELDWORK_ACTOR: 'Your name', FIELDWORK_HARNESS: 'codex', FIELDWORK_BRANCH: branchId }, null, 2);
  const prompt = 'Use Fieldwork to share this investigation. Read the room and recent changes, then use your existing tools freely. Publish relevant outputs with their known source and optional rerun recipe. Cite artifact IDs in findings. Fork a thread when pursuing a separate hypothesis. Imported origin is self-reported; do not claim adapter capture. Do not expose the invite key in artifacts or messages.';
  return <Modal title="Your agent, in the same workspace" subtitle="Codex, pi, OpenCode, or any tool that can call HTTP. No model credentials belong here." onClose={onClose} wide>
    <div className="agent-steps"><span>01</span><div><h3>Configure the CLI or MCP adapter</h3><p>Set these environment variables in your agent’s process. The room key grants access to this investigation.</p></div></div>
    <pre className="code-block agent-config">{config}</pre><Button onClick={() => onCopy(config)}><Copy size={13} />Copy connection settings</Button>
    <div className="agent-steps"><span>02</span><div><h3>Use the tools you already have</h3><p>From the repository, run the CLI or start the MCP stdio server.</p></div></div>
    <pre className="code-block">npm run --silent agent -- state{'\n'}npm run --silent agent -- publish --file artifact.json{'\n'}npm run --silent agent -- changes --after 0{'\n'}npm run --silent mcp</pre>
    <div className="agent-steps"><span>03</span><div><h3>Give your agent the shared context</h3></div></div><p className="agent-prompt">{prompt}</p>
    <div className="modal-actions"><Button onClick={onClose}>Done</Button><Button primary onClick={() => onCopy(prompt)}><Copy size={14} />Copy agent instructions</Button></div>
  </Modal>;
}
function SourcesDialog({ onClose, onImport }: { onClose: () => void; onImport: () => void }) {
  const [sources, setSources] = useState<{ id: string; name: string; ready: boolean; description: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { request<{ sources: typeof sources }>('/api/sources').then(r => setSources(r.sources)).catch(e => setError(e.message)); }, []);
  return <Modal title="Evidence can come from anywhere" subtitle="Adapters capture provenance automatically. Imports keep your agent free to explore." onClose={onClose}>
    <div className="source-list">{sources.map(s => <div key={s.id}><Database size={20} /><div><h3>{s.name}</h3><p>{s.description}</p></div><span className={s.ready ? 'source-ready' : 'source-pending'}>{s.ready ? 'Available' : 'Not connected'}</span></div>)}</div>
    {error && <div className="error">{error}</div>}<p className="muted">Add Cloudflare credentials on the server to enable live telemetry. Other tools can publish JSON directly; they do not need a native adapter.</p><div className="modal-actions"><Button onClick={onClose}>Done</Button><Button primary onClick={onImport}><Plus size={14} />Import evidence</Button></div>
  </Modal>;
}
function FindingDialog({ evidence, actor, branchId, onClose, onSubmit, busy }: { evidence: Evidence[]; actor: Actor; branchId: string; onClose: () => void; onSubmit: (data: unknown) => void; busy: boolean }) {
  const [title, setTitle] = useState(''), [text, setText] = useState(''), [status, setStatus] = useState('open');
  const [parents, setParents] = useState<string[]>([]);
  return <Modal title="Make the reasoning inspectable" subtitle="Publish a finding and link the evidence that supports or challenges it." onClose={onClose} wide>
    <form onSubmit={e => { e.preventDefault(); onSubmit({ title, text, status, actor, branchId, parentIds: parents }); }}>
      <label>Finding<input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="What do you think is happening?" required maxLength={160} /></label>
      <label>Explanation<textarea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder="Explain the observation, uncertainty, and useful next step." required /></label>
      <label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="open">Working hypothesis</option><option value="supported">Supported by evidence</option><option value="disproven">Disproven</option></select></label>
      <label>Link supporting or opposing evidence</label><div className="evidence-checks">{evidence.map(e => <label key={e.id}><input type="checkbox" checked={parents.includes(e.id)} onChange={event => setParents(p => event.target.checked ? [...p, e.id] : p.filter(id => id !== e.id))} /><span>{e.title}<small>{e.source.name}</small></span></label>)}</div>
      <div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button primary type="submit" disabled={busy || (status === 'supported' && !parents.length)}>{busy && <LoaderCircle className="spin" size={14} />}Publish finding</Button></div>
    </form>
  </Modal>;
}
const defaultRenderer = '(inputs) => ({\n  tag: "svg",\n  attrs: { viewBox: "0 0 640 180" },\n  children: [\n    { tag: "rect", attrs: { x: 0, y: 0, width: 640, height: 180, rx: 12, fill: "#18282b" } },\n    { tag: "text", attrs: { x: 28, y: 55, fill: "#92d4b8", "font-size": 20 }, text: inputs[0].title },\n    { tag: "text", attrs: { x: 28, y: 96, fill: "#a7b8ba", "font-size": 14 }, text: "A custom view over preserved evidence" }\n  ]\n})';
function ComponentDialog({ evidence, actor, branchId, onClose, onSubmit, busy }: { evidence: Evidence; actor: Actor; branchId: string; onClose: () => void; onSubmit: (data: unknown) => void; busy: boolean }) {
  const [title, setTitle] = useState('A different view of ' + evidence.title), [code, setCode] = useState(evidence.component?.code ?? defaultRenderer);
  return <Modal title="A view shaped around the question" subtitle="Write a JavaScript function over saved input artifacts. Return a declarative SVG drawing." onClose={onClose} wide>
    <form onSubmit={e => { e.preventDefault(); onSubmit({ title, code, inputIds: evidence.component?.inputIds ?? [evidence.id], actor, branchId }); }}>
      <label>View title<input value={title} onChange={e => setTitle(e.target.value)} required maxLength={160} /></label>
      <div className="component-input"><Database size={14} />{evidence.component ? evidence.component.inputIds.length + ' saved input(s) from the original component' : evidence.title}</div>
      <label>Renderer function<textarea className="code-editor" rows={16} value={code} onChange={e => setCode(e.target.value)} spellCheck={false} /></label>
      <div className="form-note"><ShieldCheck size={15} />Isolated Worker · no network · no credentials · 50 ms CPU limit. Drawing output is validated and archived.</div>
      <div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button primary type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : <Code2 size={14} />}Render & publish</Button></div>
    </form>
  </Modal>;
}
