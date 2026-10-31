// Boot, theme, hash routing, server-event wiring.
import { h, $, toast } from './util.js';
import { S, api, on, emit, connect, setToken, mergeChat, mergeUsers, pref, setPref, user } from './state.js';
import { showAuth } from './auth.js';
import { initList, renderList, markActive, closeSearch } from './list.js';
import { openChat, closeChat, showEmpty, handleMessage, handleEdit, handleDelete, handleRead, handleChat, handleTyping, renderHeader } from './chat.js';
import { joinConference, handleInvite, closeInfo, renderInfo, clearSubs, WALLPAPERS } from './panels.js';

const root = document.getElementById('app');

// /k/ is the older flat layout, /a/ (default) the floating-panel layout
document.documentElement.dataset.variant = location.pathname.startsWith('/k') ? 'k' : 'a';

// ---------- theme / wallpaper / text size ----------
const mq = matchMedia('(prefers-color-scheme: dark)');
function applyPrefs() {
  const mode = pref('themeMode', 'system');
  const dark = mode === 'system' ? mq.matches : mode === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.wallpaper = pref('wallpaper', 'default');
  const wp = WALLPAPERS.find(w => w[0] === pref('wallpaper', 'default'));
  document.documentElement.style.setProperty('--wallpaper', wp && wp[2] ? wp[2] : '');
  document.documentElement.style.setProperty('--msg-font-size', pref('textSize', 16) + 'px');
}
mq.addEventListener('change', applyPrefs);
on('pref', k => { if (k === 'theme') { setPref('themeMode', pref('theme', 'light')); } applyPrefs(); });
applyPrefs();

// ---------- notifications ----------
let audio;
function beep() {
  try { audio ||= new AudioContext(); const o = audio.createOscillator(), g = audio.createGain(); o.connect(g); g.connect(audio.destination); o.frequency.value = 880; g.gain.value = 0.05; o.start(); o.stop(audio.currentTime + 0.12); } catch {}
}
function notify({ chatId, message }) {
  const c = S.chats.get(chatId);
  if (!c || message.from === S.me.id || c.state.muted || message.service) return;
  if (chatId === S.active && document.visibilityState === 'visible') return;
  if (pref('sound', true)) beep();
  if (pref('desktopNotif', false) && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
    new Notification(user(message.from).name, { body: pref('preview', true) ? (message.text || 'Attachment') : 'New message' });
  }
}

// ---------- routing: #<chatId> ; #conf=<code> ; #join=<code> ----------
async function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  closeSearch();
  if (hash.startsWith('conf=')) { await joinConference(hash.slice(5)); return; }
  if (hash.startsWith('join=')) { await handleInvite(hash.slice(5)); return; }
  if (!hash || hash === '?') { if (S.active) { closeChat(); S.active = null; markActive(); } else showEmpty(); document.body.classList.remove('chat-open'); return; }
  if (hash === S.active && $('.chat-view')) return;
  await openChat(hash);
  markActive();
}
window.addEventListener('hashchange', route);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.querySelector('.menu,.modal-back,.lightbox,.emoji-picker') && !document.activeElement?.closest('input,textarea')) {
    if (document.body.classList.contains('info-open')) closeInfo(); else if ($('#sub-stack.has')) $('#sub-stack .sub:last-child .icon-btn')?.click(); else if (S.active) location.hash = '';
  }
});

// ---------- server events ----------
function wire() {
  on('srv:message', d => { mergeUsers(d.users); handleMessage(d); notify(d); });
  on('srv:message_edit', handleEdit);
  on('srv:message_delete', handleDelete);
  on('srv:read', handleRead);
  on('srv:chat', d => { mergeUsers(d.users); handleChat(d); });
  on('srv:typing', d => { if (d.user !== S.me.id) handleTyping(d); });
  on('srv:presence', u => { S.users[u.id] = { ...S.users[u.id], ...u }; if (u.id === S.me.id) S.me = { ...S.me, ...u }; renderHeader(); renderList(); if (S.infoFor) renderInfo(); });
  on('srv:chat_removed', ({ chatId }) => {
    S.chats.delete(chatId); delete S.msgs[chatId];
    if (S.active === chatId) { S.active = null; location.hash = ''; }
    if (S.infoFor === chatId) closeInfo();
    renderList();
  });
  on('srv:open', refresh);
  document.addEventListener('chats-changed', () => { markActive(); renderList(); });
  document.addEventListener('logout', logout);
  setInterval(() => { renderHeader(); }, 30000);
}
async function refresh() { // initial load and re-sync after an SSE reconnect
  const b = await api('GET', '/bootstrap');
  S.me = b.me; S.users = b.users; S.contacts = b.contacts;
  const prev = S.chats; S.chats = new Map();
  for (const c of b.chats) { const o = prev.get(c.id); if (o && c.id === S.active) c.state.readMax = Math.max(c.state.readMax, o.state.readMax); S.chats.set(c.id, c); }
  for (const [id, c] of prev) if (!S.chats.has(id) && !id.startsWith('-') && c.last === null) S.chats.set(id, c); // keep freshly opened empty chats
  renderList();
  if (S.active && S.msgs[S.active]) { const r = await api('GET', `/chats/${S.active}/messages`).catch(() => null); if (r) { S.msgs[S.active] = r.messages; handleChat({ chat: S.chats.get(S.active) }); } }
}
async function logout() {
  await api('POST', '/auth/logout').catch(() => {});
  setToken(''); location.hash = ''; location.reload();
}

// ---------- start ----------
async function start() {
  if (!S.token) { await showAuth(root); }
  try { await api('GET', '/bootstrap'); } catch { setToken(''); await showAuth(root); }
  root.replaceChildren(h('div#main.main', h('aside#left.left'), h('main#middle.middle'), h('aside#right.right')));
  const b = await api('GET', '/bootstrap');
  S.me = b.me; S.users = b.users; S.contacts = b.contacts; for (const c of b.chats) S.chats.set(c.id, c);
  initList($('#left'));
  wire();
  showEmpty();
  connect();
  await route();
}
start().catch(e => { console.error(e); root.textContent = 'Failed to start: ' + e.message; });
