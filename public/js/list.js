// Left column: header, search, folders, archive, chat list, floating compose button.
import { h, $, avatar, listTime, showMenu, closeMenu, debounce, toast, confirmBox, esc } from './util.js';
import { icon, ticks } from './icons.js';
import { S, api, on, user, chatTitle, chatAvatarProps, isGroup, mergeChat, mergeUsers, pref, setPref, myRole } from './state.js';
import { openContacts, openSettings, openNewGroup, openNewChannel, openNewPrivate, newConference, openProfile, openAbout } from './panels.js';

let listEl, folderEl, searchInput, searchPane, mainEl, fabBtn, fabMenuOpen = false, fabMenuEl;
let folder = 'all', inArchive = false;
const FOLDERS = [['all', 'All'], ['private', 'Personal'], ['group', 'Groups'], ['channel', 'Channels'], ['unread', 'Unread']];

export function previewOf(c) {
  const m = c.last;
  if (!m) return c.type === 'saved' ? 'Save messages here' : '';
  let t = m.service ? m.text : m.attachment ? (m.attachment.type.startsWith('image/') ? '🖼 Photo' + (m.text ? ', ' + m.text : '') : '📎 ' + m.attachment.name + (m.text ? ', ' + m.text : '')) : m.text;
  return t.replace(/\s+/g, ' ');
}
const visible = c => (inArchive ? c.state.archived : !c.state.archived) && (folder === 'all' || (folder === 'unread' ? c.unread > 0 : folder === 'private' ? (c.type === 'private' || c.type === 'saved') : c.type === folder));
const lastTs = c => c.last ? c.last.ts : 0;
function sorted() {
  return [...S.chats.values()].filter(visible).sort((a, b) => (b.state.pinned - a.state.pinned) || lastTs(b) - lastTs(a));
}

function chatItem(c) {
  const typers = Object.keys(S.typing[c.id] || {});
  const m = c.last;
  const av = avatar({ ...chatAvatarProps(c), size: 54 });
  if (c.type === 'private' && user(c.id).online) av.append(h('span.online-dot'));
  let sender = '';
  if (m && !m.service) sender = m.from === S.me.id ? 'You' : (isGroup(c) && c.type === 'group' ? user(m.from).name.split(' ')[0] : '');
  const preview = typers.length
    ? h('span.typing-text', (isGroup(c) ? user(typers[0]).name.split(' ')[0] + ' is typing' : 'typing') + '…')
    : h('span', sender ? h('span.sender', sender + ': ') : '', previewOf(c));
  const own = m && !m.service && m.from === S.me.id;
  const read = own && c.type === 'private' ? (c.reads[c.id] >= m.id) : own && c.type === 'group' ? Object.values(c.reads).some(r => r >= m.id) : false;
  const badge = c.unread ? h('div.badge' + (c.state.muted ? '.muted' : ''), c.unread > 999 ? Math.floor(c.unread / 100) / 10 + 'K' : String(c.unread))
    : c.state.pinned ? h('div.pin-ic', { html: icon('pin', 18) }) : null;
  const el = h('div.chat-item' + (S.active === c.id ? '.active' : ''), { dataset: { id: c.id }, role: 'button', tabIndex: 0,
    onclick: () => { closeSearch(); location.hash = c.id; },
    oncontextmenu: e => { e.preventDefault(); chatMenu(c, { x: e.clientX, y: e.clientY }); },
  }, av,
    h('div.chat-info',
      h('div.chat-row', h('div.chat-name', h('span.fullName', chatTitle(c)), c.state.muted ? h('span.mute-ic', { html: icon('mute', 16) }) : null),
        h('div.chat-meta', own ? h('span.tick-wrap', { html: ticks(read, true) }) : null, m ? h('span.chat-time', listTime(m.ts)) : null)),
      h('div.chat-row', h('div.chat-preview', preview), badge)));
  // long-press for touch
  let lp; el.addEventListener('touchstart', e => { lp = setTimeout(() => { chatMenu(c, { x: e.touches[0].clientX, y: e.touches[0].clientY }); lp = 'fired'; }, 500); }, { passive: true });
  el.addEventListener('touchend', e => { if (lp === 'fired') e.preventDefault(); clearTimeout(lp); }); el.addEventListener('touchmove', () => clearTimeout(lp), { passive: true });
  return el;
}

async function setState(c, patch) {
  await api('POST', `/chats/${c.id}/state`, patch).catch(e => toast(e.message));
}
export function chatMenu(c, anchor) {
  const grp = isGroup(c);
  showMenu([
    { icon: 'pin', label: c.state.pinned ? 'Unpin' : 'Pin', onclick: () => setState(c, { pinned: !c.state.pinned }) },
    { icon: c.state.muted ? 'unmute' : 'mute', label: c.state.muted ? 'Unmute' : 'Mute', onclick: () => setState(c, { muted: !c.state.muted }) },
    c.type !== 'saved' || true ? { icon: 'archive', label: c.state.archived ? 'Unarchive' : 'Archive', onclick: () => setState(c, { archived: !c.state.archived }) } : null,
    { sep: true },
    { icon: 'delete', danger: true, label: grp ? (myRole(c) === 'owner' ? 'Delete and leave' : 'Leave ' + (c.type === 'channel' ? 'channel' : 'group')) : 'Delete chat', onclick: () => deleteChat(c) },
  ], anchor);
}
export async function deleteChat(c) {
  const grp = isGroup(c);
  const owner = grp && myRole(c) === 'owner';
  if (!(await confirmBox(grp ? (owner ? 'Delete group?' : 'Leave?') : 'Delete chat?', grp ? (owner ? `Delete "${chatTitle(c)}" for all members?` : `Leave "${chatTitle(c)}"?`) : `Delete chat with ${chatTitle(c)}? This only clears it for you.`, owner ? 'Delete' : grp ? 'Leave' : 'Delete'))) return;
  await api('DELETE', `/chats/${c.id}${owner ? '?all=1' : ''}`).catch(e => toast(e.message));
}

export function renderList() {
  if (!listEl) return;
  const items = sorted();
  const frag = document.createDocumentFragment();
  if (!inArchive) {
    const arch = [...S.chats.values()].filter(c => c.state.archived);
    if (arch.length) {
      const unread = arch.reduce((n, c) => n + (c.state.muted ? 0 : c.unread), 0);
      frag.append(h('div.chat-item.archive-row', { onclick: () => { inArchive = true; renderHeader(); renderList(); } },
        h('div.avatar.archive-av', { style: { width: '54px', height: '54px' }, html: icon('archive', 28) }),
        h('div.chat-info', h('div.chat-row', h('div.chat-name', 'Archived chats'), unread ? h('div.badge.muted', String(unread)) : null),
          h('div.chat-row', h('div.chat-preview', arch.map(c => chatTitle(c)).join(', '))))));
    }
  }
  for (const c of items) frag.append(chatItem(c));
  if (!frag.childNodes.length) frag.append(h('div.empty-list', inArchive ? 'No archived chats' : folder === 'all' ? 'No chats yet. Tap the pencil to start one.' : 'No chats in this folder'));
  listEl.replaceChildren(frag);
  // folder badges
  for (const [id] of FOLDERS) {
    const tab = folderEl.querySelector(`[data-f="${id}"] .tab-badge`);
    const n = [...S.chats.values()].filter(c => !c.state.archived && c.unread && (id === 'all' || id === 'unread' || (id === 'private' ? (c.type === 'private' || c.type === 'saved') : c.type === id))).length;
    if (tab) tab.textContent = n ? n : '';
  }
  const total = [...S.chats.values()].reduce((n, c) => n + (c.state.muted || c.state.archived ? 0 : c.unread), 0);
  document.title = (total ? `(${total}) ` : '') + 'Telegram Web: REA';
}
export function markActive() { $$all('.chat-item').forEach(el => el.classList.toggle('active', el.dataset.id === S.active)); }
const $$all = s => [...document.querySelectorAll(s)];

function renderHeader() {
  const hdr = $('#left-header');
  const menuBtn = h('button.icon-btn#menu-btn', { 'aria-label': 'Menu', html: icon(inArchive ? 'back' : 'menu', 24), 'data-menu-anchor': 1,
    onclick: e => { if (inArchive) { inArchive = false; renderHeader(); renderList(); } else hamburger(e.currentTarget); } });
  hdr.replaceChildren(menuBtn, inArchive ? h('div.left-title', 'Archived Chats') : searchBox());
  $('#folders').hidden = inArchive || !pref('folders', false); // like Telegram, the folder bar only shows when folders are enabled
}
function searchBox() {
  searchInput = h('input#search-input.search-input', { placeholder: 'Search', autocomplete: 'off', 'aria-label': 'Search',
    onfocus: () => openSearch(), oninput: debounce(() => runSearch(), 200),
    onkeydown: e => { if (e.key === 'Escape') closeSearch(); } });
  return h('div.search-wrap', h('span.search-ic', { html: icon('search', 22) }), searchInput,
    h('button.icon-btn.search-clear', { hidden: true, id: 'search-clear', onclick: () => closeSearch(), html: icon('close', 20), 'aria-label': 'Clear' }));
}
function openSearch() { searchPane.classList.add('open'); $('#search-clear').hidden = false; if (!searchInput.value) showSearchHome(); }
export function closeSearch() { if (!searchInput) return; searchInput.value = ''; searchInput.blur(); searchPane.classList.remove('open'); const c = $('#search-clear'); if (c) c.hidden = true; }
function showSearchHome() {
  searchPane.replaceChildren(h('div.section-title', 'Contacts'), ...S.contacts.slice(0, 12).map(id => userRow(user(id))));
  if (!S.contacts.length) searchPane.append(h('div.empty-list', 'Type a name or @username'));
}
function userRow(u, sub) {
  return h('div.chat-item.compact', { onclick: () => { closeSearch(); location.hash = u.id; } }, avatar({ name: u.name, color: u.color, photo: u.avatar, size: 46 }),
    h('div.chat-info', h('div.chat-name', h('span.fullName', u.name)), h('div.chat-preview', sub || (u.username ? '@' + u.username : ''))));
}
async function runSearch() {
  const q = searchInput.value.trim();
  if (!q) return showSearchHome();
  try {
    const r = await api('GET', '/search?q=' + encodeURIComponent(q));
    if (searchInput.value.trim() !== q) return;
    mergeUsers(r.usersById); r.users.forEach(u => (S.users[u.id] = u));
    const frag = [];
    const chats = r.chats.map(id => S.chats.get(id)).filter(Boolean);
    if (chats.length) frag.push(h('div.section-title', 'Chats'), ...chats.map(c => chatItem(c)));
    const known = new Set(chats.filter(c => c.type === 'private').map(c => c.id));
    const us = r.users.filter(u => !known.has(u.id));
    if (us.length) frag.push(h('div.section-title', 'Contacts and People'), ...us.map(u => userRow(u)));
    if (r.messages.length) frag.push(h('div.section-title', 'Messages'), ...r.messages.map(({ chatId, message }) => {
      const c = S.chats.get(chatId) || { id: chatId, type: 'private' };
      const title = isGroup(c) || c.type === 'saved' ? chatTitle(c) : user(chatId).name;
      const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      return h('div.chat-item.compact', { onclick: () => { closeSearch(); S.jump = message.id; if (location.hash === '#' + chatId) emit2('jump'); else location.hash = chatId; } },
        avatar({ ...chatAvatarProps(c), size: 46 }), h('div.chat-info', h('div.chat-row', h('div.chat-name', h('span.fullName', title)), h('span.chat-time', listTime(message.ts))),
          h('div.chat-preview', { html: esc(message.text).replace(re, '<mark>$1</mark>') })));
    }));
    if (!frag.length) frag.push(h('div.empty-list', 'No results for "' + q + '"'));
    searchPane.replaceChildren(...frag);
  } catch (e) { searchPane.replaceChildren(h('div.empty-list', e.message)); }
}
const emit2 = t => document.dispatchEvent(new CustomEvent(t));

function hamburger(anchor) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const top = h('div.menu-profile', { onclick: () => { closeMenu(); openProfile(); } }, avatar({ name: S.me.name, color: S.me.color, photo: S.me.avatar, size: 36 }), h('span', S.me.name));
  showMenu([
    { icon: 'user', label: 'My Profile', onclick: () => openProfile() },
    { icon: 'saved', label: 'Saved Messages', onclick: () => { location.hash = S.me.id; } },
    { icon: 'group', label: 'Contacts', onclick: () => openContacts() },
    { icon: 'archive', label: 'Archived Chats', onclick: () => { inArchive = true; renderHeader(); renderList(); } },
    { icon: 'settings', label: 'Settings', onclick: () => openSettings() },
    { icon: 'moon', label: 'Night Mode', keepOpen: true, right: `<span class="switch ${dark ? 'on' : ''}"><i></i></span>`, onclick: e => { setPref('theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); closeMenu(); } },
    { icon: 'info', label: 'About', onclick: () => openAbout() },
    { sep: true },
    { icon: 'logout', label: 'Log Out', danger: true, onclick: () => emit2('logout') },
  ], anchor, { top, origin: 'top left' });
}

// --- floating compose button: pencil -> X, dark rounded menu opens above it ---
function toggleFab(force) {
  fabMenuOpen = force ?? !fabMenuOpen;
  fabBtn.classList.toggle('open', fabMenuOpen);
  fabBtn.setAttribute('aria-expanded', String(fabMenuOpen));
  fabMenuEl.classList.toggle('open', fabMenuOpen);
}
function buildFab() {
  const items = [['channel', 'New Channel', openNewChannel], ['group', 'New Group', openNewGroup], ['call', 'New Conference', newConference], ['user', 'New Private Chat', openNewPrivate]];
  fabMenuEl = h('div.fab-menu#fab-menu', { role: 'menu' }, items.map(([ic, label, fn]) => h('div.menu-item', { role: 'menuitem', tabIndex: 0, onclick: e => { e.stopPropagation(); toggleFab(false); fn(); } }, h('span.mi', { html: icon(ic, 22) }), h('span.ml', label))));
  fabBtn = h('button.fab#fab', { 'aria-label': 'New message', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: e => { e.stopPropagation(); toggleFab(); } },
    h('span.fab-ic.pencil', { html: icon('edit', 26) }), h('span.fab-ic.x', { html: icon('close', 26) }));
  document.addEventListener('mousedown', e => { if (fabMenuOpen && !fabMenuEl.contains(e.target) && !fabBtn.contains(e.target)) toggleFab(false); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && fabMenuOpen) toggleFab(false); });
  return h('div.fab-wrap', fabMenuEl, fabBtn);
}

export function initList(root) {
  mainEl = h('div.left-main',
    h('div#left-header.left-header'),
    (folderEl = h('div#folders.folders', { role: 'tablist' }, FOLDERS.map(([id, label]) => h('button.folder' + (id === folder ? '.active' : ''), { dataset: { f: id }, role: 'tab', onclick: () => { folder = id; $$all('.folder').forEach(b => b.classList.toggle('active', b.dataset.f === id)); renderList(); } }, h('span', label), h('span.tab-badge'))))),
    h('div.list-area', (listEl = h('div#chat-list.chat-list')), (searchPane = h('div#search-pane.search-pane')), buildFab()));
  root.append(mainEl, h('div#sub-stack.sub-stack'));
  renderHeader(); renderList();
  on('chats', () => { renderList(); });
  on('pref', k => { if (k === 'folders') { if (!pref('folders', false)) folder = 'all'; renderHeader(); renderList(); } });
  on('presence-ui', () => renderList());
}
export { toggleFab };
