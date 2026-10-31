// Shared client state, API wrapper, SSE connection and a tiny event bus.
export const S = {
  token: localStorage.getItem('tgrea:token') || '',
  me: null,
  chats: new Map(),      // viewer-chat-id -> summary
  users: {},             // id -> public user
  contacts: [],          // user ids
  msgs: {},              // chat id -> message[] (loaded on open)
  active: null,          // open chat id
  typing: {},            // chatId -> {userId: timeout}
  conf: null,
};
const bus = new EventTarget();
export const on = (t, fn) => bus.addEventListener(t, e => fn(e.detail));
export const emit = (t, d) => bus.dispatchEvent(new CustomEvent(t, { detail: d }));

export async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method, headers: { 'content-type': 'application/json', ...(S.token ? { authorization: 'Bearer ' + S.token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { if (res.status === 401 && S.token) { setToken(''); location.reload(); } throw new Error(data.error || res.statusText); }
  return data;
}
export function setToken(t) { S.token = t; t ? localStorage.setItem('tgrea:token', t) : localStorage.removeItem('tgrea:token'); }

export async function upload(file) {
  const res = await fetch('/api/upload', { method: 'POST', headers: { authorization: 'Bearer ' + S.token, 'x-filename': encodeURIComponent(file.name), 'content-type': file.type || 'application/octet-stream' }, body: file });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

let es;
export function connect() {
  es?.close();
  es = new EventSource('/api/events?token=' + encodeURIComponent(S.token));
  for (const t of ['message', 'message_edit', 'message_delete', 'read', 'typing', 'presence', 'chat', 'chat_removed', 'conference'])
    es.addEventListener(t, e => emit('srv:' + t, JSON.parse(e.data)));
  es.onopen = () => emit('srv:open');
}

export const user = id => S.users[id] || { id, name: 'Unknown', color: 0, username: '' };
export const isGroup = c => c && (c.type === 'group' || c.type === 'channel');
export function chatTitle(c) {
  if (!c) return '';
  if (c.type === 'saved') return 'Saved Messages';
  return isGroup(c) ? c.title : user(c.id).name;
}
export const chatAvatarProps = c => c.type === 'saved' ? { saved: true } : isGroup(c) ? { name: c.title, color: c.color, photo: c.photo } : { name: user(c.id).name, color: user(c.id).color, photo: user(c.id).avatar };
export const myRole = c => c?.members?.[S.me.id]?.role || 'member';
export const isAdminOf = c => ['owner', 'admin'].includes(myRole(c));
export const canPost = c => c && (c.type !== 'channel' || isAdminOf(c));
export function mergeUsers(u) { if (u) for (const [k, v] of Object.entries(u)) S.users[k] = v; }
export function mergeChat(c) { if (c) { const old = S.chats.get(c.id); S.chats.set(c.id, c); return old; } }

// settings (local only)
export const pref = (k, d) => { try { const v = localStorage.getItem('tgrea:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
export const setPref = (k, v) => { try { localStorage.setItem('tgrea:' + k, JSON.stringify(v)); } catch {} emit('pref', k); };
