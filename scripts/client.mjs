export function connection() {
  return {
    url: (process.env.FIELDWORK_URL || 'http://127.0.0.1:8787').replace(/\/$/, ''),
    room: process.env.FIELDWORK_ROOM,
    key: process.env.FIELDWORK_KEY,
    actor: { name: process.env.FIELDWORK_ACTOR || 'Local investigator', harness: process.env.FIELDWORK_HARNESS || 'cli' },
    branchId: process.env.FIELDWORK_BRANCH || 'main',
  };
}
export async function call(path = '', payload, options = {}) {
  const config = connection();
  if (!options.global && (!config.room || !config.key)) {
    throw new Error('Set FIELDWORK_ROOM and FIELDWORK_KEY from the investigation invite.');
  }
  const url = config.url + (options.global ? '/api' : '/api/rooms/' + encodeURIComponent(config.room)) + path;
  const key = options.global ? process.env.FIELDWORK_WORKSPACE_KEY : config.key;
  const response = await fetch(url, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: {
      ...(key ? { Authorization: 'Bearer ' + key } : {}),
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': options.idempotencyKey || crypto.randomUUID() }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Fieldwork returned HTTP ' + response.status);
  return data;
}
export function attributed(payload = {}) {
  const { actor, branchId } = connection();
  return { actor, branchId, ...payload };
}
