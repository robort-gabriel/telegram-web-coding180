// Middle column: conversation view, composer, message actions.
import { h, $, avatar, linkify, timeOf, dayLabel, sameDay, lastSeen, fmtSize, toast, showMenu, closeMenu, modal, confirmBox } from './util.js';
import { icon, ticks } from './icons.js';
import { emojiPicker, QUICK } from './emoji.js';
import { S, api, upload, user, chatTitle, chatAvatarProps, isGroup, isAdminOf, canPost, mergeChat, mergeUsers, myRole } from './state.js';
import { toggleInfo, closeInfo, renderInfo, pickChat, newConference } from './panels.js';
import { chatMenu } from './list.js';

const NAME_COLORS = ['#e17076', '#faa774', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae'];
let view = null;           // current view refs
let st = { reply: null, edit: null, file: null, firstUnread: 0, pinIdx: 0, lastTyping: 0 };
const emit2 = t => document.dispatchEvent(new CustomEvent(t));

export function showEmpty() {
  S.active = null; view = null;
  $('#middle').replaceChildren(h('div.empty-chat', h('div.empty-pill', 'Select a chat to start messaging')));
  document.body.classList.remove('chat-open');
}

export async function openChat(id) {
  closeMenu();
  const prev = S.active;
  S.active = id; st = { reply: null, edit: null, file: null, firstUnread: 0, pinIdx: 0, lastTyping: 0 };
  document.body.classList.add('chat-open');
  try {
    let c = S.chats.get(id);
    if (!c) { const r = await api('GET', '/chats/' + id); mergeUsers(r.users); mergeChat(r.chat); c = r.chat; }
    const r = await api('GET', `/chats/${id}/messages`);
    if (S.active !== id) return;
    S.msgs[id] = r.messages;
    const readMax = c.state.readMax;
    st.firstUnread = (r.messages.find(m => m.id > readMax && m.from !== S.me.id && !m.service) || {}).id || 0;
    build(c);
    renderMessages(true);
    markRead();
    if (S.infoFor && S.infoFor !== id) { S.infoFor = id; renderInfo(); }
    emit2('chats-changed');
  } catch (e) {
    toast(e.message); S.active = prev === id ? null : prev; showEmpty(); history.replaceState(null, '', location.pathname);
  }
}
export function closeChat() { showEmpty(); }

// ---------- build static frame ----------
function build(c) {
  const grp = isGroup(c);
  const searchInput = h('input.msg-search', { placeholder: 'Search in chat', 'aria-label': 'Search in chat', onkeydown: e => { if (e.key === 'Enter') searchStep(e.shiftKey ? -1 : 1); if (e.key === 'Escape') toggleSearch(false); } });
  const header = h('div.chat-header', { onclick: e => { if (!e.target.closest('button,input')) toggleInfo(c.id); } },
    h('button.icon-btn.back-btn#back-btn', { 'aria-label': 'Back', html: icon('back', 24), onclick: e => { e.stopPropagation(); location.hash = ''; } }),
    h('div.hdr-av'), h('div.hdr-text', h('div.hdr-title'), h('div.hdr-sub')), searchInput,
    h('button.icon-btn#chat-search', { 'aria-label': 'Search', html: icon('search', 22), onclick: e => { e.stopPropagation(); toggleSearch(true); } }),
    c.type === 'private' ? h('button.icon-btn#chat-call', { 'aria-label': 'Call', title: 'Start a simulated call', html: icon('phone', 22), onclick: e => { e.stopPropagation(); newConference(); } }) : null,
    h('button.icon-btn#chat-more', { 'aria-label': 'More', html: icon('more', 22), 'data-menu-anchor': 1, onclick: e => { e.stopPropagation(); chatMenuHdr(e.currentTarget); } }));
  const pinned = h('div.pinned-bar', { hidden: true, onclick: () => pinnedClick() });
  const scroller = h('div.messages', { onscroll: onScroll });
  const list = h('div.msg-list'); scroller.append(list);
  const downBtn = h('button.down-btn', { hidden: true, 'aria-label': 'Scroll to bottom', html: icon('back', 22), onclick: () => scrollBottom(true) });
  const composer = buildComposer(c);
  $('#middle').replaceChildren(h('div.chat-view', header, pinned, h('div.msg-area', scroller, downBtn), composer));
  view = { header, pinned, scroller, list, downBtn, composer, searchInput, matches: [], mi: -1 };
  // drag & drop files
  const area = $('.chat-view');
  area.addEventListener('dragover', e => { e.preventDefault(); });
  area.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files[0]) attach(e.dataTransfer.files[0]); });
  renderHeader();
}

function toggleSearch(on) {
  view.header.classList.toggle('searching', on);
  if (on) view.searchInput.focus(); else { view.searchInput.value = ''; view.matches = []; $$('.msg-row.hit').forEach(e => e.classList.remove('hit')); }
}
const $$ = s => [...document.querySelectorAll(s)];
function searchStep(dir) {
  const q = view.searchInput.value.trim().toLowerCase(); if (!q) return;
  view.matches = (S.msgs[S.active] || []).filter(m => m.text && m.text.toLowerCase().includes(q)).map(m => m.id);
  if (!view.matches.length) return toast('No messages found');
  view.mi = (view.mi + dir + view.matches.length) % view.matches.length;
  jumpTo(view.matches[view.mi]);
}

export function renderHeader() {
  if (!view) return;
  const c = S.chats.get(S.active); if (!c) return;
  const [avEl, tEl, sEl] = [$('.hdr-av', view.header), $('.hdr-title', view.header), $('.hdr-sub', view.header)];
  avEl.replaceChildren(avatar({ ...chatAvatarProps(c), size: 42 }));
  tEl.textContent = chatTitle(c);
  const typers = Object.keys(S.typing[c.id] || {});
  let sub;
  if (typers.length) sub = (isGroup(c) ? user(typers[0]).name.split(' ')[0] + ' is typing' : 'typing') + '…';
  else if (c.type === 'saved') sub = 'Your personal cloud chat';
  else if (c.type === 'channel') sub = `${Object.keys(c.members).length} subscribers`;
  else if (c.type === 'group') { const ids = Object.keys(c.members); const on = ids.filter(i => user(i).online || i === S.me.id).length; sub = `${ids.length} members, ${on} online`; }
  else sub = lastSeen(user(c.id));
  sEl.textContent = sub; sEl.classList.toggle('online', !typers.length && c.type === 'private' && !!user(c.id).online); sEl.classList.toggle('typing', typers.length > 0);
  // composer swap for channels
  const comp = view.composer;
  const postable = canPost(c);
  comp.classList.toggle('readonly', !postable);
  const ro = $('.readonly-bar', comp);
  if (ro) { ro.textContent = c.state.muted ? 'Unmute' : 'Mute'; }
  renderPinned(c);
}
function chatMenuHdr(anchor) {
  const c = S.chats.get(S.active);
  showMenu([
    { icon: 'info', label: c.type === 'private' ? 'View profile' : 'View info', onclick: () => toggleInfo(c.id) },
    { icon: c.state.muted ? 'unmute' : 'mute', label: c.state.muted ? 'Unmute' : 'Mute', onclick: () => api('POST', `/chats/${c.id}/state`, { muted: !c.state.muted }) },
    { icon: 'archive', label: c.state.archived ? 'Unarchive' : 'Archive', onclick: () => api('POST', `/chats/${c.id}/state`, { archived: !c.state.archived }) },
    { icon: 'pin', label: c.state.pinned ? 'Unpin chat' : 'Pin chat', onclick: () => api('POST', `/chats/${c.id}/state`, { pinned: !c.state.pinned }) },
    { sep: true },
    { icon: 'delete', danger: true, label: isGroup(c) ? (myRole(c) === 'owner' ? 'Delete and leave' : 'Leave') : 'Delete chat', onclick: async () => { const { deleteChat } = await import('./list.js'); deleteChat(c); } },
  ], anchor, { align: 'right' });
}

// ---------- pinned ----------
function renderPinned(c) {
  const ids = (c.pinned || []).filter(id => (S.msgs[c.id] || []).some(m => m.id === id));
  const bar = view.pinned;
  bar.hidden = !ids.length; if (!ids.length) return;
  st.pinIdx = Math.min(st.pinIdx, ids.length - 1); if (st.pinIdx < 0) st.pinIdx = ids.length - 1;
  const m = S.msgs[c.id].find(x => x.id === ids[ids.length - 1 - st.pinIdx]);
  bar.replaceChildren(h('div.pin-bar-line'), h('div.pin-body', h('div.pin-title', ids.length > 1 ? `Pinned Message #${ids.length - st.pinIdx}` : 'Pinned Message'), h('div.pin-text', previewText(m))),
    (c.type === 'private' || c.type === 'saved' || isAdminOf(c)) ? h('button.icon-btn', { 'aria-label': 'Unpin', title: 'Unpin', html: icon('close', 20), onclick: e => { e.stopPropagation(); api('POST', `/chats/${c.id}/messages/${m.id}/unpin`); } }) : null);
  bar._id = m.id; bar._n = ids.length;
}
function pinnedClick() { const b = view.pinned; jumpTo(b._id); st.pinIdx = (st.pinIdx + 1) % b._n; renderPinned(S.chats.get(S.active)); }
const previewText = m => !m ? '' : m.attachment ? (m.attachment.type.startsWith('image/') ? 'Photo' : m.attachment.name) + (m.text ? ', ' + m.text : '') : m.text;

// ---------- messages ----------
function renderMessages(initial) {
  if (!view) return;
  const c = S.chats.get(S.active), msgs = S.msgs[S.active] || [];
  const near = isNearBottom();
  const prevH = view.scroller.scrollHeight, prevT = view.scroller.scrollTop;
  const frag = document.createDocumentFragment();
  let prev = null;
  const showName = c.type === 'group';
  msgs.forEach((m, i) => {
    if (!prev || !sameDay(prev.ts, m.ts)) frag.append(h('div.day-sep', h('span', dayLabel(m.ts))));
    if (st.firstUnread && m.id === st.firstUnread) frag.append(h('div.unread-sep#unread-sep', h('span', 'Unread messages')));
    if (m.service) { frag.append(h('div.service-msg', h('span', m.text))); prev = m; return; }
    const next = msgs[i + 1];
    const sameAsPrev = prev && !prev.service && prev.from === m.from && sameDay(prev.ts, m.ts) && m.ts - prev.ts < 5 * 60e3 && !(st.firstUnread && m.id === st.firstUnread);
    const sameAsNext = next && !next.service && next.from === m.from && sameDay(next.ts, m.ts) && next.ts - m.ts < 5 * 60e3 && !(st.firstUnread && next.id === st.firstUnread);
    frag.append(messageEl(m, c, { first: !sameAsPrev, last: !sameAsNext, showName: showName && !sameAsPrev }));
    prev = m;
  });
  if (!msgs.length) frag.append(h('div.empty-chat-msg', h('span', c.type === 'channel' ? 'No posts yet' : 'No messages here yet…')));
  view.list.replaceChildren(frag);
  if (initial) {
    const sep = $('#unread-sep');
    if (S.jump) { const id = S.jump; S.jump = null; setTimeout(() => jumpTo(id), 30); }
    else if (sep) view.scroller.scrollTop = sep.offsetTop - 60; else view.scroller.scrollTop = view.scroller.scrollHeight;
  } else if (near) scrollBottom(); else view.scroller.scrollTop = prevT + (view.scroller.scrollHeight - prevH) * 0;
  onScroll();
}

function messageEl(m, c, { first, last, showName }) {
  const own = m.from === S.me.id;
  const sender = user(m.from);
  const readBy = c.reads || {};
  const read = c.type === 'private' ? readBy[c.id] >= m.id : c.type === 'saved' ? true : Object.values(readBy).some(r => r >= m.id);
  const meta = h('span.meta', m.edited ? h('span.edited', 'edited') : null, h('span.time', timeOf(m.ts)), own && c.type !== 'channel' ? h('span.tk', { html: ticks(read, true) }) : null);
  const bubble = h('div.bubble');
  if (showName && !own) bubble.append(h('div.sender', { style: { color: NAME_COLORS[sender.color % 7] } }, sender.name));
  if (c.type === 'channel') bubble.append(h('div.sender', { style: { color: 'var(--color-primary)' } }, c.title));
  if (m.forward) bubble.append(h('div.fwd', h('span.fwd-l', 'Forwarded from'), ' ', h('b', m.forward.name)));
  if (m.replyTo) {
    const r = (S.msgs[c.id] || []).find(x => x.id === m.replyTo);
    bubble.append(h('div.reply', { onclick: e => { e.stopPropagation(); r && jumpTo(r.id); } }, h('div.reply-name', r ? user(r.from).name : 'Message'), h('div.reply-text', r ? previewText(r) || '…' : 'Deleted message')));
  }
  const a = m.attachment;
  const isImg = a && a.type.startsWith('image/');
  if (isImg) bubble.append(h('img.att-img', { src: a.url, alt: a.name, loading: 'lazy', onclick: e => { e.stopPropagation(); lightbox(a.url); }, onload: () => { if (isNearBottomPrev) scrollBottom(); } }));
  else if (a) bubble.append(h('a.att-file', { href: a.url, download: a.name, onclick: e => e.stopPropagation() }, h('span.file-ic', { html: icon('file', 26) }), h('span.file-info', h('b', a.name), h('span', fmtSize(a.size)))));
  const hasText = !!m.text;
  if (hasText) bubble.append(h('span.text', { html: linkify(m.text) }));
  bubble.append(meta);
  if (isImg && !hasText) bubble.classList.add('img-only');
  if (m.reactions) bubble.append(h('div.reactions', Object.entries(m.reactions).map(([e, users]) => h('button.reaction' + (users.includes(S.me.id) ? '.mine' : ''), { title: users.map(u => user(u).name).join(', '), onclick: ev => { ev.stopPropagation(); react(m, e); } }, h('span', e), h('span.rc', String(users.length))))));
  const row = h('div.msg-row' + (own ? '.own' : '.in') + (first ? '.first' : '') + (last ? '.last' : '') + (st.hl === m.id ? '.hit' : ''), { dataset: { id: m.id },
    oncontextmenu: e => { e.preventDefault(); msgMenu(m, c, { x: e.clientX, y: e.clientY }); },
    ondblclick: e => { if (!e.target.closest('a,img,button')) react(m, '❤️'); } });
  if (c.type === 'group' && !own) row.append(last ? h('div.row-av', avatar({ name: sender.name, color: sender.color, photo: sender.avatar, size: 36 })) : h('div.row-av.ph'));
  row.append(bubble);
  let lp; row.addEventListener('touchstart', e => { lp = setTimeout(() => { lp = 'f'; msgMenu(m, c, { x: e.touches[0].clientX, y: e.touches[0].clientY }); }, 450); }, { passive: true });
  row.addEventListener('touchend', e => { if (lp === 'f') e.preventDefault(); clearTimeout(lp); }); row.addEventListener('touchmove', () => clearTimeout(lp), { passive: true });
  return row;
}
let isNearBottomPrev = true;
const isNearBottom = () => !view || view.scroller.scrollHeight - view.scroller.scrollTop - view.scroller.clientHeight < 140;
function scrollBottom(smooth) { if (view) view.scroller.scrollTo({ top: view.scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); }
function onScroll() {
  if (!view) return;
  isNearBottomPrev = isNearBottom();
  const c = S.chats.get(S.active);
  view.downBtn.hidden = isNearBottomPrev;
  view.downBtn.dataset.n = c?.unread || '';
  if (isNearBottomPrev) markRead();
}
export function jumpTo(id) {
  const el = view?.list.querySelector(`[data-id="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400);
}
document.addEventListener('jump', () => { if (S.jump) { const id = S.jump; S.jump = null; jumpTo(id); } });

function lightbox(url) {
  const b = h('div.lightbox', { onclick: () => b.remove() }, h('img', { src: url, alt: '' }), h('button.icon-btn', { 'aria-label': 'Close', html: icon('close', 28) }));
  document.body.append(b);
}

// ---------- read receipts ----------
export function markRead() {
  const c = S.chats.get(S.active); if (!c || document.visibilityState !== 'visible' || !document.hasFocus() && false) return;
  const msgs = S.msgs[S.active] || []; const last = msgs[msgs.length - 1];
  if (!last || last.id <= c.state.readMax || !isNearBottom()) return;
  c.state.readMax = last.id; c.unread = 0;
  api('POST', `/chats/${c.id}/read`, { upTo: last.id }).catch(() => {});
  emit2('chats-changed');
}
document.addEventListener('visibilitychange', () => markRead());

// ---------- server events ----------
export function handleMessage({ chatId, message, chat }) {
  const list = S.msgs[chatId];
  const wasNear = isNearBottom();
  if (S.typing[chatId]?.[message.from]) { clearTimeout(S.typing[chatId][message.from]); delete S.typing[chatId][message.from]; }
  if (list && !list.some(m => m.id === message.id)) list.push(message);
  if (chat && chatId === S.active) { const old = S.chats.get(chatId); if (old) chat.state.readMax = Math.max(chat.state.readMax, old.state.readMax); }
  if (chat) mergeChat(chat);
  if (chatId === S.active && view) {
    renderMessages();
    if (message.from === S.me.id || wasNear) scrollBottom(message.from === S.me.id);
    renderHeader();
    if (message.from !== S.me.id) markRead();
    else { const cc = S.chats.get(chatId); if (cc) { cc.state.readMax = Math.max(cc.state.readMax, message.id); cc.unread = 0; } }
  }
  if (S.typing[chatId]?.[message.from]) { clearTimeout(S.typing[chatId][message.from]); delete S.typing[chatId][message.from]; }
  emit2('chats-changed');
}
export function handleEdit({ chatId, message, chat }) {
  const list = S.msgs[chatId]; const i = list ? list.findIndex(m => m.id === message.id) : -1;
  if (i >= 0) list[i] = message;
  if (chat) mergeChat(chat);
  if (chatId === S.active) renderMessages();
  emit2('chats-changed');
}
export function handleDelete({ chatId, ids, chat }) {
  if (S.msgs[chatId]) S.msgs[chatId] = S.msgs[chatId].filter(m => !ids.includes(m.id));
  if (chat) mergeChat(chat);
  if (chatId === S.active) { renderMessages(); renderHeader(); }
  emit2('chats-changed');
}
export function handleRead({ chat }) { if (chat) { const old = S.chats.get(chat.id); if (old && chat.id === S.active) chat.state.readMax = Math.max(chat.state.readMax, old.state.readMax); mergeChat(chat); } if (view) renderMessages(); emit2('chats-changed'); }
export function handleChat({ chat }) {
  if (!chat) return;
  const old = S.chats.get(chat.id);
  if (old && chat.id === S.active) chat.state.readMax = Math.max(chat.state.readMax, old.state.readMax);
  mergeChat(chat);
  if (chat.id === S.active && view) { renderHeader(); renderMessages(); }
  if (S.infoFor === chat.id) renderInfo();
  emit2('chats-changed');
}
export function handleTyping({ chatId, user: uid }) {
  const t = (S.typing[chatId] ||= {});
  clearTimeout(t[uid]);
  t[uid] = setTimeout(() => { delete t[uid]; if (chatId === S.active) renderHeader(); emit2('chats-changed'); }, 5000);
  if (chatId === S.active) renderHeader(); emit2('chats-changed');
}

// ---------- actions ----------
async function react(m, emoji) { await api('POST', `/chats/${S.active}/messages/${m.id}/react`, { emoji }).catch(e => toast(e.message)); }
function msgMenu(m, c, anchor) {
  const own = m.from === S.me.id;
  const canPin = c.type === 'private' || c.type === 'saved' || isAdminOf(c);
  const pinned = (c.pinned || []).includes(m.id);
  const top = h('div.react-bar', QUICK.map(e => h('button.react-opt', { onclick: () => { closeMenu(); react(m, e); } }, e)));
  showMenu([
    canPost(c) ? { icon: 'reply', label: 'Reply', onclick: () => setReply(m) } : null,
    m.text ? { icon: 'copy', label: 'Copy Text', onclick: () => { navigator.clipboard?.writeText(m.text).then(() => toast('Text copied'), () => toast('Copy failed')); } } : null,
    canPin ? { icon: 'pin', label: pinned ? 'Unpin' : 'Pin', onclick: () => api('POST', `/chats/${c.id}/messages/${m.id}/${pinned ? 'unpin' : 'pin'}`).catch(e => toast(e.message)) } : null,
    { icon: 'forward', label: 'Forward', onclick: () => forward(m) },
    own && m.text && canPost(c) ? { icon: 'edit', label: 'Edit', onclick: () => setEdit(m) } : null,
    own || isAdminOf(c) || c.type === 'private' || c.type === 'saved' ? { sep: true } : null,
    own || isAdminOf(c) || c.type === 'private' || c.type === 'saved' ? { icon: 'delete', danger: true, label: 'Delete', onclick: () => deleteMsg(m, c) } : null,
  ].filter(Boolean), anchor, { top });
}
function deleteMsg(m, c) {
  const own = m.from === S.me.id;
  const all = h('input#del-all', { type: 'checkbox', checked: true });
  const canAll = own || isAdminOf(c);
  const name = c.type === 'private' ? chatTitle(c) : 'everyone';
  modal({ title: 'Delete message?', body: h('div', h('p.modal-text', 'Are you sure you want to delete this message?'), canAll && c.type !== 'saved' ? h('label.auth-check', all, h('span', `Also delete for ${name}`)) : null),
    actions: [{ label: 'Cancel' }, { label: 'Delete', danger: true, onclick: () => { api('DELETE', `/chats/${c.id}/messages/${m.id}?all=${canAll && all.checked ? 1 : 0}`).catch(e => toast(e.message)); } }] });
}
function forward(m) {
  pickChat('Forward to…', async target => {
    try {
      await api('POST', `/chats/${target.id}/messages`, { text: m.text || '', attachment: m.attachment, forward: { name: m.forward ? m.forward.name : user(m.from).name } });
      toast('Message forwarded to ' + chatTitle(target));
    } catch (e) { toast(e.message); }
  });
}
function setReply(m) { st.edit = null; st.reply = m; renderBar(); view.composer.querySelector('textarea').focus(); }
function setEdit(m) { st.reply = null; st.edit = m; renderBar(); const ta = view.composer.querySelector('textarea'); ta.value = m.text; autoGrow(ta); ta.focus(); updateSendBtn(); }
function renderBar() {
  const bar = $('.compose-bar', view.composer);
  const m = st.edit || st.reply;
  bar.hidden = !m;
  if (!m) return bar.replaceChildren();
  bar.replaceChildren(h('span.bar-ic', { html: icon(st.edit ? 'edit' : 'reply', 24) }), h('div.bar-body', h('div.bar-title', st.edit ? 'Edit Message' : 'Reply to ' + user(m.from).name), h('div.bar-text', previewText(m))),
    h('button.icon-btn', { 'aria-label': 'Cancel', html: icon('close', 20), onclick: cancelBar }));
}
function cancelBar() { if (st.edit) { const ta = view.composer.querySelector('textarea'); ta.value = ''; autoGrow(ta); } st.reply = st.edit = null; renderBar(); updateSendBtn(); }

// ---------- composer ----------
function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; }
function updateSendBtn() {
  const ta = view.composer.querySelector('textarea'); const has = ta.value.trim() || st.file;
  const b = $('.send-btn', view.composer); b.classList.toggle('has', !!has);
  b.innerHTML = has ? icon('send', 24) : icon('mic', 24); b.setAttribute('aria-label', has ? 'Send' : 'Voice message');
}
async function attach(file) {
  if (file.size > 15e6) return toast('File is too large (max 15 MB)');
  st.file = { uploading: true, name: file.name, size: file.size, type: file.type || 'application/octet-stream' };
  renderFile();
  try { const r = await upload(file); st.file = r; } catch (e) { st.file = null; toast(e.message); }
  renderFile(); updateSendBtn();
}
function renderFile() {
  const box = $('.file-preview', view.composer);
  box.hidden = !st.file;
  if (!st.file) return box.replaceChildren();
  const f = st.file;
  box.replaceChildren(f.type.startsWith('image/') && f.url ? h('img', { src: f.url, alt: '' }) : h('span.file-ic', { html: icon('file', 24) }), h('div.bar-body', h('div.bar-title', f.name), h('div.bar-text', f.uploading ? 'Uploading…' : fmtSize(f.size))),
    h('button.icon-btn', { 'aria-label': 'Remove attachment', html: icon('close', 20), onclick: () => { st.file = null; renderFile(); updateSendBtn(); } }));
}
async function send() {
  const ta = view.composer.querySelector('textarea');
  const text = ta.value.trim();
  const c = S.chats.get(S.active);
  if (st.file?.uploading) return toast('Please wait for the upload');
  if (!text && !st.file) return toast('Voice messages are not implemented in this demo');
  try {
    if (st.edit) { const m = st.edit; if (text !== m.text) await api('PATCH', `/chats/${c.id}/messages/${m.id}`, { text }); st.edit = null; }
    else {
      const body = { text, replyTo: st.reply?.id };
      if (st.file) body.attachment = { url: st.file.url, name: st.file.name, size: st.file.size, type: st.file.type };
      const r = await api('POST', `/chats/${c.id}/messages`, body);
      handleMessage({ chatId: S.active, message: r.message });
    }
    ta.value = ''; autoGrow(ta); st.reply = null; st.file = null; renderBar(); renderFile(); updateSendBtn(); scrollBottom(true);
  } catch (e) { toast(e.message); }
}
function buildComposer(c) {
  const ta = h('textarea#msg-input', { rows: 1, placeholder: 'Message', 'aria-label': 'Message',
    oninput: () => { autoGrow(ta); updateSendBtn(); typing(); },
    onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } if (e.key === 'Escape') cancelBar(); },
    onpaste: e => { const f = [...(e.clipboardData?.files || [])][0]; if (f) { e.preventDefault(); attach(f); } } });
  const fileIn = h('input', { type: 'file', hidden: true, id: 'file-input', onchange: () => { if (fileIn.files[0]) attach(fileIn.files[0]); fileIn.value = ''; } });
  let picker = null;
  const emojiBtn = h('button.icon-btn#emoji-btn', { 'aria-label': 'Emoji', html: icon('smile', 26), 'data-menu-anchor': 1, onclick: e => {
    e.stopPropagation();
    if (picker) { picker.remove(); picker = null; return; }
    picker = emojiPicker(em => { const s = ta.selectionStart; ta.setRangeText(em, s, ta.selectionEnd, 'end'); autoGrow(ta); updateSendBtn(); ta.focus(); });
    picker.classList.add('align-right'); wrap.append(picker); requestAnimationFrame(() => picker?.classList.add('open'));
    const off = ev => { if (picker && !picker.contains(ev.target) && !emojiBtn.contains(ev.target)) { picker.remove(); picker = null; document.removeEventListener('mousedown', off, true); } };
    document.addEventListener('mousedown', off, true);
  } });
  const wrap = h('div.composer',
    h('div.compose-bar', { hidden: true }), h('div.file-preview', { hidden: true }),
    // Telegram order: attach (left) · text · emoji (right) · round primary send/mic button inside the pill
    h('div.compose-row', h('div.input-box', h('button.icon-btn#attach-btn', { 'aria-label': 'Attach file', html: icon('attach', 26), onclick: () => fileIn.click() }), fileIn, ta, emojiBtn,
      h('button.send-btn#send-btn', { 'aria-label': 'Send', onclick: send, html: icon('mic', 24) }))),
    h('button.readonly-bar', { onclick: () => api('POST', `/chats/${c.id}/state`, { muted: !S.chats.get(S.active).state.muted }) }, 'Mute'));
  return wrap;
}
function typing() {
  const now = Date.now();
  if (now - st.lastTyping > 3000 && S.active && !st.edit) { st.lastTyping = now; api('POST', `/chats/${S.active}/typing`).catch(() => {}); }
}
export const getView = () => view;
