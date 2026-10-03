import type { Actor, Artifact, Evidence, RoomState } from '../shared/model';

export type State = RoomState & { sample: boolean; peers: Actor[] };
export async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Request failed');
  return data as T;
}
export function roomKey(id: string): string {
  const key = new URLSearchParams(location.hash.slice(1)).get('key');
  if (key) {
    sessionStorage.setItem('fieldwork:' + id, key);
    const url = new URL(location.href); url.hash = '';
    history.replaceState(null, '', url);
    return key;
  }
  return sessionStorage.getItem('fieldwork:' + id) ?? '';
}
export class RoomClient {
  constructor(readonly id: string, readonly key: string) {}
  path(path = '') { return '/api/rooms/' + this.id + path; }
  get<T>(path = '') { return request<T>(this.path(path), { headers: { Authorization: 'Bearer ' + this.key } }); }
  post<T>(path: string, data: unknown) {
    return request<T>(this.path(path), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(data),
    });
  }
  state() { return this.get<State>(); }
  artifact(id: string) { return this.get<Artifact>('/evidence/' + id); }
  rerun(evidence: Evidence, actor: Actor, branchId: string) {
    return this.post<Evidence>('/evidence/' + evidence.id + '/rerun', { actor, branchId });
  }
}
export function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
