// DOM helpers, formatting, avatars, menus, toasts.
import { icon } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// h('div.cls#id', {onclick, dataset}, ...children)  children: node | string | html via {html}
export function h(tag, props, ...kids) {
  const m = tag.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)/i);
  const el = document.createElement(m[1] || 'div');
  for (const t of (m[2] || '').match(/[.#][\w-]+/g) || []) t[0] === '.' ? el.classList.add(t.slice(1)) : (el.id = t.slice(1));
  if (props && (props.nodeType || typeof props === 'string' || Array.isArray(props) || props.html !== undefined && Object.keys(props).length === 1 && false)) { kids.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.className += ' ' + v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)"'])/gi;
export function linkify(text) {
  return esc(text).replace(URL_RE, u => `<a href="${u.startsWith('www.') ? 'https://' + u : u}" target="_blank" rel="noopener noreferrer">${u}</a>`)
    .replace(/(^|\s)@([a-z][a-z0-9_]{3,31})\b/gi, '$1<a class="mention" data-username="$2" href="javascript:void 0">@$2</a>').replace(/\n/g, '<br>');
}

// ---- time ----
const pad = n => String(n).padStart(2, '0');
export const timeOf = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
export function listTime(ts) {
  const d = new Date(ts), now = Date.now();
  if (sameDay(ts, now)) return timeOf(ts);
  if (now - ts < 6 * 864e5) return DAYS[d.getDay()];
  if (d.getFullYear() === new Date(now).getFullYear()) return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}
export function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  if (sameDay(ts, now)) return 'Today';
  if (sameDay(ts, now - 864e5)) return 'Yesterday';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== now.getFullYear() ? ', ' + d.getFullYear() : ''}`;
}
export function lastSeen(u) {
  if (!u) return '';
  if (u.online) return 'online';
  const ago = Date.now() - u.lastSeen;
  if (ago < 60e3) return 'last seen just now';
  if (ago < 36e5) return `last seen ${Math.floor(ago / 6e4)} minutes ago`;
  if (sameDay(u.lastSeen, Date.now())) return `last seen today at ${timeOf(u.lastSeen)}`;
  if (sameDay(u.lastSeen, Date.now() - 864e5)) return `last seen yesterday at ${timeOf(u.lastSeen)}`;
  return `last seen ${dayLabel(u.lastSeen)}`;
}
export const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

// ---- avatars (Telegram palette: [top, bottom] gradient) ----
export const AV = [['#FF885E', '#FF516A'], ['#FFCD6A', '#FFA85C'], ['#82B1FF', '#665FFF'], ['#A0DE7E', '#54CB68'], ['#53EDD6', '#28C9B7'], ['#72D5FD', '#2A9EF1'], ['#E0A2F3', '#D669ED']];
export const initials = name => { const p = String(name || '?').trim().split(/\s+/); return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?'; };
export function avatar({ name, color = 0, photo, saved, size = 54 }) {
  const el = h('div.avatar', { style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.4) + 'px' } });
  if (saved) { el.style.background = 'linear-gradient(#8FBDF6,#4D8EEB)'; el.innerHTML = icon('saved', Math.round(size * 0.55)); }
  else if (photo) { el.style.background = `center/cover url("${photo}")`; }
  else { const [a, b] = AV[color % 7]; el.style.background = `linear-gradient(${a},${b})`; el.textContent = initials(name); }
  return el;
}

// ---- toasts ----
export function toast(msg) {
  const t = h('div.toast', msg); document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

// ---- popup menus (context menu, dropdowns) ----
let openMenu = null;
export function closeMenu() { if (openMenu) { const m = openMenu; openMenu = null; m.classList.remove('open'); setTimeout(() => m.remove(), 150); m._onclose?.(); } }
// items: [{icon,label,danger,onclick,sep,checked}] ; anchor: {x,y} or element; opts {align:'right'|'left', top:node}
export function showMenu(items, anchor, opts = {}) {
  closeMenu();
  const menu = h('div.menu.popup', { oncontextmenu: e => e.preventDefault() });
  if (opts.top) menu.append(opts.top);
  for (const it of items.filter(Boolean)) {
    if (it.sep) { menu.append(h('div.menu-sep')); continue; }
    const row = h('div.menu-item' + (it.danger ? '.danger' : ''), {
      onclick: e => { e.stopPropagation(); if (!it.keepOpen) closeMenu(); it.onclick?.(e); },
    }, it.icon ? h('span.mi', { html: icon(it.icon, 20) }) : null, h('span.ml', it.label), it.right ? h('span.mr', { html: it.right }) : null);
    menu.append(row);
  }
  document.body.append(menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let x, y;
  if (anchor instanceof Element) {
    const r = anchor.getBoundingClientRect();
    x = opts.align === 'right' ? r.right - mw : r.left; y = opts.above ? r.top - mh - 8 : r.bottom + 4;
  } else { x = anchor.x; y = anchor.y; }
  x = Math.max(8, Math.min(x, innerWidth - mw - 8)); y = Math.max(8, Math.min(y, innerHeight - mh - 8));
  Object.assign(menu.style, { left: x + 'px', top: y + 'px', transformOrigin: opts.origin || 'top left' });
  requestAnimationFrame(() => menu.classList.add('open'));
  openMenu = menu; menu._onclose = opts.onclose;
  return menu;
}
document.addEventListener('mousedown', e => { if (openMenu && !openMenu.contains(e.target) && !e.target.closest('[data-menu-anchor]')) closeMenu(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

// ---- modal ----
export function modal({ title, body, actions = [], onclose, cls = '' }) {
  const close = () => { back.classList.remove('open'); setTimeout(() => back.remove(), 180); onclose?.(); };
  const box = h('div.modal' + (cls ? '.' + cls : ''),
    h('div.modal-head', h('div.modal-title', title), h('button.icon-btn', { onclick: close, html: icon('close', 22), 'aria-label': 'Close' })),
    h('div.modal-body', body),
    actions.length ? h('div.modal-actions', actions.map(a => h('button.text-btn' + (a.danger ? '.danger' : ''), { onclick: () => { if (a.onclick?.() !== false) close(); } }, a.label))) : null);
  const back = h('div.modal-back', { onmousedown: e => { if (e.target === back) close(); } }, box);
  document.body.append(back); requestAnimationFrame(() => back.classList.add('open'));
  return { close, box };
}
export const confirmBox = (title, text, label, danger = true) => new Promise(ok => {
  let done = false;
  modal({ title, body: h('p.modal-text', text), actions: [{ label: 'Cancel', onclick: () => { done = true; ok(false); } }, { label, danger, onclick: () => { done = true; ok(true); } }], onclose: () => { if (!done) ok(false); } });
});

export async function readImage(file, max = 256) { // resize to a small data URL for avatars
  const url = URL.createObjectURL(file);
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
  const s = Math.min(1, max / Math.min(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c.toDataURL('image/jpeg', 0.85);
}
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
