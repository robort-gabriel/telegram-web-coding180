// Sub-screens in the left column (contacts, wizards, settings), right info panel, conference screen, pickers.
import { h, $, avatar, toast, modal, confirmBox, showMenu, closeMenu, readImage, debounce, lastSeen, timeOf } from './util.js';
import { icon } from './icons.js';
import { S, api, on, user, chatTitle, chatAvatarProps, isGroup, isAdminOf, myRole, mergeChat, mergeUsers, pref, setPref } from './state.js';

const emit2 = t => document.dispatchEvent(new CustomEvent(t));

// ---------- sub-screen stack (slides over the chat list) ----------
export function pushSub(title, content, { right, onclose } = {}) {
  const stack = $('#sub-stack');
  const scr = h('div.sub', h('div.sub-header', h('button.icon-btn', { 'aria-label': 'Back', html: icon('back', 24), onclick: () => popSub() }), h('div.sub-title', title), right || null), h('div.sub-body', content));
  scr._onclose = onclose;
  stack.append(scr); stack.classList.add('has');
  requestAnimationFrame(() => scr.classList.add('in'));
  return scr;
}
export function popSub() {
  const stack = $('#sub-stack'); const scr = stack.lastElementChild; if (!scr) return;
  scr.classList.remove('in'); scr._onclose?.();
  setTimeout(() => { scr.remove(); if (!stack.children.length) stack.classList.remove('has'); }, 220);
}
export function clearSubs() { const st = $('#sub-stack'); [...st.children].forEach(s => s.remove()); st.classList.remove('has'); }

// ---------- contact picker ----------
function contactPicker({ multi, onPick, onChange, exclude = [], hint }) {
  const selected = new Map();
  const chips = h('div.chips'), list = h('div.picker-list');
  const input = h('input.picker-search', { placeholder: multi ? 'Add People…' : 'Search by name or @username', autocomplete: 'off', 'aria-label': 'Search people' });
  let found = [];
  const render = () => {
    const q = input.value.trim().toLowerCase().replace(/^@/, '');
    const base = S.contacts.map(id => user(id)).filter(u => !exclude.includes(u.id));
    const filtered = base.filter(u => !q || u.name.toLowerCase().includes(q) || u.username.includes(q));
    const extra = found.filter(u => !exclude.includes(u.id) && !filtered.some(f => f.id === u.id));
    chips.replaceChildren(...[...selected.values()].map(u => h('div.chip', { onclick: () => toggle(u) }, avatar({ name: u.name, color: u.color, photo: u.avatar, size: 28 }), h('span', u.name.split(' ')[0]), h('span.x', '×'))));
    const rows = [...filtered, ...extra].map(u => h('div.chat-item.compact' + (selected.has(u.id) ? '.sel' : ''), { dataset: { uid: u.id }, role: 'button', tabIndex: 0, onclick: () => multi ? toggle(u) : onPick(u) },
      avatar({ name: u.name, color: u.color, photo: u.avatar, size: 46 }),
      h('div.chat-info', h('div.chat-name', h('span.fullName', u.name)), h('div.chat-preview', lastSeen(u))),
      multi ? h('div.check' + (selected.has(u.id) ? '.on' : ''), { html: selected.has(u.id) ? icon('check', 16) : '' }) : null));
    list.replaceChildren(...(rows.length ? rows : [h('div.empty-list', q ? 'No people found' : 'No contacts yet. Search by @username.')]));
  };
  const toggle = u => { selected.has(u.id) ? selected.delete(u.id) : selected.set(u.id, u); input.value = ''; render(); onChange?.([...selected.values()]); };
  const search = debounce(async () => {
    const q = input.value.trim();
    found = q.length >= 2 ? (await api('GET', '/users?q=' + encodeURIComponent(q)).catch(() => ({ users: [] }))).users : [];
    found.forEach(u => (S.users[u.id] = u)); render();
  }, 200);
  input.addEventListener('input', () => { render(); search(); });
  render();
  return { el: h('div.picker', h('div.picker-top', chips, input), hint ? h('div.hint', hint) : null, list), selected, input };
}

export function openContacts() {
  const p = contactPicker({ multi: false, onPick: u => { clearSubs(); location.hash = u.id; } });
  pushSub('Contacts', p.el); p.input.focus();
}
export function openNewPrivate() {
  const p = contactPicker({ multi: false, onPick: async u => { await api('POST', '/contacts', { userId: u.id }).catch(() => {}); if (!S.contacts.includes(u.id)) S.contacts.push(u.id); clearSubs(); location.hash = u.id; } });
  pushSub('New Private Chat', p.el); p.input.focus();
}

// ---------- photo chooser ----------
function photoPicker(initial = '') {
  let data = initial;
  const box = h('div.photo-pick', { role: 'button', tabIndex: 0, 'aria-label': 'Set photo', onclick: () => file.click() });
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => { if (file.files[0]) { data = await readImage(file.files[0]); draw(); } } });
  const draw = () => { box.style.background = data ? `center/cover url(${data})` : ''; box.innerHTML = data ? '' : icon('camera', 32); };
  draw();
  return { el: h('div', box, file), get: () => data };
}

// ---------- New Group wizard ----------
export function openNewGroup() {
  const picker = contactPicker({ multi: true, hint: 'Select members to add. You can search by @username too.' });
  const next = h('button.round-fab', { 'aria-label': 'Next', html: icon('forward', 26).replace('M14 9V5', 'M14 9V5'), onclick: () => step2() });
  next.innerHTML = icon('check', 26).replace(/<path/, '<path transform="translate(0 0)"');
  next.setAttribute('aria-label', 'Next');
  const scr = pushSub('Add Members', h('div.wiz', picker.el, next)); picker.input.focus();
  function step2() {
    const members = [...picker.selected.values()];
    const photo = photoPicker(); const name = h('input.field-input#group-name', { placeholder: 'Group Name', maxLength: 64, 'aria-label': 'Group name' });
    const create = h('button.round-fab', { 'aria-label': 'Create', html: icon('check', 26), onclick: async () => {
      if (!name.value.trim()) { name.focus(); return toast('Please enter a group name'); }
      create.disabled = true;
      try { const r = await api('POST', '/chats', { type: 'group', title: name.value, members: members.map(m => m.id), photo: photo.get() }); mergeUsers(r.users); mergeChat(r.chat); clearSubs(); emit2('chats-changed'); location.hash = r.id; }
      catch (e) { toast(e.message); create.disabled = false; }
    } });
    pushSub('New Group', h('div.wiz', h('div.form-top', photo.el, name),
      h('div.section-title', `${members.length + 1} member${members.length ? 's' : ''}`),
      h('div.picker-list', [S.me, ...members].map(u => h('div.chat-item.compact', avatar({ name: u.name, color: u.color, photo: u.avatar, size: 46 }), h('div.chat-info', h('div.chat-name', u.name), h('div.chat-preview', u.id === S.me.id ? 'owner' : lastSeen(user(u.id))))))), create));
    name.focus();
  }
}

// ---------- New Channel ----------
export function openNewChannel() {
  const photo = photoPicker();
  const name = h('input.field-input#channel-name', { placeholder: 'Channel name', maxLength: 64, 'aria-label': 'Channel name' });
  const desc = h('input.field-input#channel-desc', { placeholder: 'Description (optional)', maxLength: 255, 'aria-label': 'Description' });
  const next = h('button.round-fab', { 'aria-label': 'Next', html: icon('check', 26), onclick: () => {
    if (!name.value.trim()) { name.focus(); return toast('Please enter a channel name'); }
    const p = contactPicker({ multi: true, hint: 'Subscribers' });
    const create = h('button.round-fab', { 'aria-label': 'Create channel', html: icon('check', 26), onclick: async () => {
      create.disabled = true;
      try { const r = await api('POST', '/chats', { type: 'channel', title: name.value, description: desc.value, members: [...p.selected.keys()], photo: photo.get() }); mergeUsers(r.users); mergeChat(r.chat); clearSubs(); emit2('chats-changed'); location.hash = r.id; }
      catch (e) { toast(e.message); create.disabled = false; }
    } });
    pushSub('Subscribers', h('div.wiz', p.el, create));
  } });
  pushSub('New Channel', h('div.wiz', h('div.form-top', photo.el, name), desc, h('p.hint', 'You can provide an optional description for your channel.'), next));
  name.focus();
}

// ---------- Conference (simulated group call) ----------
let confTimer;
export async function newConference() {
  try { const c = await api('POST', '/conferences', { title: 'New Conference' }); showConference(c); location.hash = ''; }
  catch (e) { toast(e.message); }
}
export async function joinConference(code) {
  try { showConference(await api('POST', `/conferences/${code}/join`)); } catch (e) { toast(e.message); }
}
function showConference(c) {
  S.conf = c; closeConference(true);
  const root = h('div.conf#conf', { role: 'dialog', 'aria-label': 'Conference' });
  document.body.append(root); requestAnimationFrame(() => root.classList.add('open'));
  const render = () => {
    const cf = S.conf; if (!cf) return;
    const mine = cf.participants.find(p => p.id === S.me.id);
    const link = `${location.origin}/#conf=${cf.code}`;
    root.replaceChildren(
      h('div.conf-top', h('div.conf-title', cf.title), h('div.conf-sub', `${cf.participants.length} participant${cf.participants.length === 1 ? '' : 's'} · simulated call`)),
      h('div.conf-grid', cf.participants.map(p => h('div.tile' + (p.muted ? '.muted' : '.live'), { dataset: { uid: p.id } }, avatar({ name: p.name, color: p.color, photo: p.avatar, size: 84 }),
        h('div.tile-name', p.id === S.me.id ? 'You' : p.name, p.muted ? h('span.tile-mic', { html: icon('micoff', 16) }) : null)))),
      h('div.conf-invite', h('span.conf-link', { title: link }, link), h('button.text-btn#conf-copy', { onclick: () => { navigator.clipboard?.writeText(link); toast('Invite link copied'); } }, 'Copy link')),
      h('div.conf-controls', h('button.call-btn' + (mine?.muted ? '.off' : ''), { id: 'conf-mute', 'aria-label': mine?.muted ? 'Unmute' : 'Mute', html: icon(mine?.muted ? 'micoff' : 'mic', 28) + `<span>${mine?.muted ? 'Unmute' : 'Mute'}</span>`,
        onclick: () => api('POST', `/conferences/${cf.code}/mute`, { muted: !mine?.muted }).catch(e => toast(e.message)) }),
        h('button.call-btn.leave#conf-leave', { 'aria-label': 'Leave', html: icon('callend', 28) + '<span>Leave</span>', onclick: leaveConference })));
  };
  render(); S._confRender = render;
  clearInterval(confTimer);
  confTimer = setInterval(() => { // fake speaking animation
    const live = [...document.querySelectorAll('.tile.live')]; live.forEach(t => t.classList.remove('speaking'));
    if (live.length) live[Math.floor(Math.random() * live.length)].classList.add('speaking');
  }, 1100);
}
export function onConference(c) { if (S.conf && S.conf.code === c.code) { S.conf = c; S._confRender?.(); } }
function closeConference(quick) {
  clearInterval(confTimer);
  const el = $('#conf'); if (!el) return;
  if (quick) el.remove(); else { el.classList.remove('open'); setTimeout(() => el.remove(), 250); }
}
async function leaveConference() {
  const code = S.conf?.code; S.conf = null; closeConference();
  if (code) await api('POST', `/conferences/${code}/leave`).catch(() => {});
  if (location.hash.startsWith('#conf=')) history.replaceState(null, '', location.pathname);
}

// ---------- About ----------
const FORUM_URL = 'https://coding180.com/forum';
const MORE_APPS_URL = 'https://coding180.com/forum/reverse-engineer';
const CONTACT_URL = 'https://coding180.com/contact';
export function openAbout() {
  const link = (url, text, cls) => h('a.about-btn' + (cls ? '.' + cls : ''), { href: url, target: '_blank', rel: 'noopener noreferrer' }, text);
  pushSub('About', h('div.settings.set-bg.about',
    h('div.card.about-card', h('h3', 'Telegram Web by coding180'),
      h('p', 'A Telegram Web-style chat app with real-time messaging, groups, channels. It is an independent, clean-room project built with the REA (reverse-engineer-anything) tool. Not affiliated with or endorsed by Telegram.'),
      h('p.hint', 'All chats, names and data in this demo are placeholders.')),
    h('div.card.about-card', h('h3', 'About the developer'),
      h('p', 'Hi, I\u2019m ', h('strong', 'Robort Gabriel'), ', the developer behind ', h('strong', 'coding180'), '. I reverse-engineer apps and rebuild them from scratch so we can all see how they work, learn from them and make them better.'),
      h('p', 'Want the source code, or more reverse-engineered tools and apps? Join the community, ask questions and share what you build.'),
      h('p', 'Need changes or a version made for you? Contact me for modifications and personalization.'),
      h('div.about-actions', link(FORUM_URL, 'Join the community forum', 'primary'), link(MORE_APPS_URL, 'More reverse-engineered tools'), link(CONTACT_URL, 'Contact the developer')))));
}

// ---------- Settings ----------
export function openProfile() { openSettings(true); }
export function openSettings(editNow) {
  const body = h('div.settings.set-bg');
  const na = () => toast('Not implemented in this demo');
  const draw = () => {
    const u = S.me;
    body.replaceChildren(
      h('div.profile-card', avatar({ name: u.name, color: u.color, photo: u.avatar, size: 120 }), h('div.pc-name', u.name), h('div.pc-status', 'online')),
      h('div.card',
        crow('#4cc764', 'phone', u.phone ? u.phone.replace(/^(\+\d)(\d{3})(\d+)/, '$1 $2 $3') : 'No phone', 'Phone'),
        crow('#3a8ff0', 'at', u.username ? '@' + u.username : 'None', 'Username'),
        u.bio ? crow('#8e8e93', 'info', u.bio, 'Bio') : null),
      h('div.card',
        crow('#3a8ff0', 'user', 'Account', 'Name, Username, Bio', editProfile, true),
        crow('#f39a30', 'settings', 'General Settings', 'Wallpaper, Theme, Text size', chatSettings, true),
        crow('#f0524f', 'bell', 'Notifications', 'Sounds, Preview, Desktop', notifSettings, true),
        crow('#8e8e93', 'lock', 'Privacy and Security', 'Last Seen, Password, Blocked Users', na, true),
        crow('#4cc764', 'archive', 'Data and Storage', 'Network usage, Auto-download', na, true),
        crow('#3a8ff0', 'saved', 'Chat Folders', 'Show the folder bar', chatSettings, true),
        crow('#9b6bf0', 'at', 'Language', 'English', na, true)));
  };
  draw();
  const more = h('button.icon-btn', { 'aria-label': 'More', 'data-menu-anchor': 1, html: icon('more', 22), onclick: e => showMenu([{ icon: 'logout', danger: true, label: 'Log Out', onclick: () => emit2('logout') }], e.currentTarget, { align: 'right' }) });
  const scr = pushSub('Settings', body, { right: h('div.hdr-actions', h('button.icon-btn', { 'aria-label': 'Edit profile', html: icon('edit', 22), onclick: editProfile }), more) });
  scr.classList.add('alt'); S._settingsRedraw = draw;
  if (editNow === true) editProfile();
}
// Settings row: coloured rounded-square icon + title + subtitle (Telegram style)
const crow = (color, ic, title, sub, fn, clickable) => h('div.set-row' + (fn ? '.click' : ''), fn ? { role: 'button', tabIndex: 0, onclick: fn } : null,
  h('span.cicon', { style: { background: color }, html: icon(ic, 22) }), h('div.sr-t', h('div.sr-title', title), sub ? h('div.sr-sub', sub) : null));
const row = (ic, v, label) => h('div.info-row', h('span.ir-ic', { html: icon(ic, 24) }), h('div', h('div.ir-v', v), h('div.ir-l', label)));
const srow = (ic, label, fn, danger) => h('div.settings-row' + (danger ? '.danger' : ''), { role: 'button', tabIndex: 0, onclick: fn }, h('span.ir-ic', { html: icon(ic, 24) }), h('span', label));

function editProfile() {
  const photo = photoPicker(S.me.avatar);
  const parts = S.me.name.split(' ');
  const first = h('input.field-input#edit-first', { value: parts[0], placeholder: 'Name', maxLength: 64, 'aria-label': 'Name' });
  const last = h('input.field-input#edit-last', { value: parts.slice(1).join(' '), placeholder: 'Last name (optional)', maxLength: 64 });
  const bio = h('input.field-input#edit-bio', { value: S.me.bio || '', placeholder: 'Bio', maxLength: 200, 'aria-label': 'Bio' });
  const un = h('input.field-input#edit-username', { value: S.me.username || '', placeholder: 'Username', maxLength: 32, 'aria-label': 'Username' });
  const err = h('div.auth-error');
  const save = h('button.round-fab#profile-save', { 'aria-label': 'Save', html: icon('check', 26), onclick: async () => {
    err.textContent = '';
    try {
      const r = await api('PATCH', '/me', { name: (first.value + ' ' + last.value).trim(), bio: bio.value, username: un.value, avatar: photo.get() });
      S.me = { ...S.me, ...r.user }; S.users[S.me.id] = { ...S.users[S.me.id], ...r.user }; popSub(); S._settingsRedraw?.(); emit2('chats-changed'); toast('Profile updated');
    } catch (e) { err.textContent = e.message; }
  } });
  pushSub('Edit Profile', h('div.wiz', h('div.form-top', photo.el), first, last, bio, h('p.hint', 'Any details such as age, occupation or city.'), un, h('p.hint', 'You can choose a username. People can then find you and contact you without your phone number. Use a-z, 0-9 and underscores, at least 4 characters.'), err, save));
}
const switchRow = (label, key, def, onchange) => {
  const sw = h('span.switch' + (pref(key, def) ? '.on' : ''), h('i'));
  return h('div.settings-row.sw', { role: 'switch', tabIndex: 0, 'aria-checked': String(!!pref(key, def)), onclick: async e => {
    const v = !pref(key, def);
    if (key === 'desktopNotif' && v && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    setPref(key, v); sw.classList.toggle('on', v); e.currentTarget.setAttribute('aria-checked', String(v)); onchange?.(v);
  } }, h('span', label), sw);
};
function notifSettings() {
  pushSub('Notifications', h('div.settings', h('div.section-title', 'Message notifications'),
    switchRow('Desktop notifications', 'desktopNotif', false), switchRow('Message preview', 'preview', true), switchRow('Sound', 'sound', true),
    h('p.hint', 'Muted chats never notify you. Notifications appear when the tab is in the background.')));
}
export const WALLPAPERS = [
  ['default', 'Default', ''], ['blue', 'Sky', 'linear-gradient(160deg,#9dc4f0,#d3e6f8)'], ['green', 'Meadow', 'linear-gradient(160deg,#c2dd9a,#e5f1c8)'],
  ['sunset', 'Sunset', 'linear-gradient(160deg,#f6b98e,#f4d9a8)'], ['violet', 'Violet', 'linear-gradient(160deg,#6a4fc9,#a58de8)'], ['night', 'Night', 'linear-gradient(160deg,#0f1b2d,#1d3350)'], ['plain', 'Plain', 'var(--color-background-secondary)'],
];
function chatSettings() {
  const themes = [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']];
  const themeBox = h('div.radio-group'), wpBox = h('div.wp-grid');
  const draw = () => {
    const t = pref('themeMode', 'system'), w = pref('wallpaper', 'default');
    themeBox.replaceChildren(...themes.map(([id, l]) => h('div.settings-row.radio' + (t === id ? '.on' : ''), { role: 'radio', 'aria-checked': String(t === id), tabIndex: 0, onclick: () => { setPref('themeMode', id); draw(); } }, h('span.radio-dot'), h('span', l))));
    wpBox.replaceChildren(...WALLPAPERS.map(([id, l, bg]) => h('div.wp' + (w === id ? '.on' : ''), { role: 'button', title: l, tabIndex: 0, dataset: { wp: id }, style: { background: bg || 'var(--color-background-secondary)' }, onclick: () => { setPref('wallpaper', id); draw(); } }, id === 'default' ? h('span.wp-pat') : null, h('span.wp-l', l))));
  };
  draw();
  const size = h('input', { type: 'range', min: 12, max: 20, value: pref('textSize', 16), 'aria-label': 'Message text size', oninput: e => setPref('textSize', +e.target.value) });
  pushSub('General Settings', h('div.settings', switchRow('Show chat folders', 'folders', false), h('div.section-title', 'Color theme'), themeBox, h('div.section-title', 'Chat wallpaper'), wpBox, h('div.section-title', 'Message text size'), h('div.slider-row', h('span', 'A'), size, h('span.big', 'A'))));
}

// ---------- chat picker (forward) ----------
export function pickChat(title, onPick) {
  const items = [...S.chats.values()].sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0));
  const m = modal({ title, cls: 'picker-modal', body: h('div.picker-list', items.map(c => h('div.chat-item.compact', { role: 'button', tabIndex: 0, onclick: () => { m.close(); onPick(c); } },
    avatar({ ...chatAvatarProps(c), size: 46 }), h('div.chat-info', h('div.chat-name', h('span.fullName', chatTitle(c))), h('div.chat-preview', c.type === 'saved' ? 'You' : c.type))))) });
}

// ---------- invite link join ----------
export async function handleInvite(code) {
  try {
    const info = await api('GET', '/invite/' + code);
    if (info.joined) { location.hash = info.id; return; }
    modal({ title: 'Join ' + (info.type === 'channel' ? 'channel' : 'group') + '?', body: h('p.modal-text', `${info.title} · ${info.members} member${info.members === 1 ? '' : 's'}`), actions: [{ label: 'Cancel', onclick: () => { history.replaceState(null, '', location.pathname); } }, { label: 'Join', onclick: async () => { try { const r = await api('POST', '/invite/' + code); await new Promise(r => setTimeout(r, 150)); location.hash = r.id; } catch (e) { toast(e.message); } } }] });
  } catch (e) { toast(e.message); history.replaceState(null, '', location.pathname); }
}

// ---------- right info panel ----------
export function closeInfo() { document.body.classList.remove('info-open'); S.infoFor = null; $('#right')?.replaceChildren(); }
export function toggleInfo(id) { document.body.classList.contains('info-open') && S.infoFor === id ? closeInfo() : openInfo(id); }
export function openInfo(id) {
  S.infoFor = id; document.body.classList.add('info-open'); renderInfo();
}
export function renderInfo() {
  const right = $('#right'); const id = S.infoFor; if (!right || !id) return;
  const c = S.chats.get(id) || { id, type: 'private', members: {}, state: {} };
  const grp = isGroup(c), admin = grp && isAdminOf(c);
  const title = c.type === 'channel' ? 'Channel Info' : c.type === 'group' ? 'Group Info' : c.type === 'saved' ? 'Saved Messages' : 'User Info';
  const u = !grp && c.type !== 'saved' ? user(c.id) : null;
  const memberCount = grp ? Object.keys(c.members || {}).length : 0;
  const rows = [];
  if (u) {
    if (u.bio) rows.push(row('info', u.bio, 'Bio'));
    if (u.username) rows.push(row('at', '@' + u.username, 'Username'));
  }
  if (grp) {
    if (c.description) rows.push(row('info', c.description, 'Description'));
    if (c.invite) {
      const link = `${location.origin}/#join=${c.invite}`;
      rows.push(h('div.info-row.link', { role: 'button', tabIndex: 0, id: 'invite-row', onclick: () => { navigator.clipboard?.writeText(link); toast('Invite link copied'); } }, h('span.ir-ic', { html: icon('link', 24) }), h('div', h('div.ir-v', link), h('div.ir-l', 'Invite link · click to copy')),
        h('button.icon-btn', { title: 'Revoke and create new link', 'aria-label': 'Reset link', html: icon('close', 18), onclick: async e => { e.stopPropagation(); const r = await api('POST', `/chats/${c.id}/invite-reset`).catch(er => toast(er.message)); if (r) toast('New invite link created'); } })));
    }
  }
  const memberList = grp ? Object.entries(c.members).sort((a, b) => ({ owner: 0, admin: 1, member: 2 }[a[1].role] - { owner: 0, admin: 1, member: 2 }[b[1].role])).map(([uid, m]) => {
    const mu = user(uid);
    return h('div.chat-item.compact.member', { dataset: { uid }, role: 'button', tabIndex: 0, onclick: e => memberMenu(c, uid, e.currentTarget), oncontextmenu: e => { e.preventDefault(); memberMenu(c, uid, { x: e.clientX, y: e.clientY }); } },
      avatar({ name: mu.name, color: mu.color, photo: mu.avatar, size: 44 }),
      h('div.chat-info', h('div.chat-name', h('span.fullName', uid === S.me.id ? mu.name + ' (you)' : mu.name)), h('div.chat-preview', lastSeen(mu))),
      m.role !== 'member' ? h('span.role', m.role === 'owner' ? 'owner' : 'admin') : null);
  }) : [];
  right.replaceChildren(
    h('div.right-header', h('button.icon-btn', { 'aria-label': 'Close', html: icon(innerWidth < 1000 ? 'back' : 'close', 24), onclick: closeInfo }), h('div.sub-title', title), admin ? h('button.icon-btn#edit-group', { 'aria-label': 'Edit', html: icon('edit', 22), onclick: () => editGroup(c) }) : null),
    h('div.right-body',
      h('div.info-hero', avatar({ ...chatAvatarProps(c), size: 120 }), h('div.hero-name', chatTitle(c)),
        h('div.hero-sub', grp ? `${memberCount} ${c.type === 'channel' ? 'subscriber' : 'member'}${memberCount === 1 ? '' : 's'}` : c.type === 'saved' ? 'Your cloud notebook' : lastSeen(u))),
      h('div.info-rows', rows),
      c.type !== 'saved' ? h('div.settings-row.sw', { role: 'switch', tabIndex: 0, 'aria-checked': String(!!c.state.muted), onclick: () => api('POST', `/chats/${c.id}/state`, { muted: !c.state.muted }) }, h('span', 'Notifications'), h('span.switch' + (c.state.muted ? '' : '.on'), h('i'))) : null,
      grp ? h('div.section-title', 'Members') : null,
      grp && admin && c.type !== 'channel' || grp && c.type === 'channel' && admin ? h('div.settings-row#add-members', { role: 'button', tabIndex: 0, onclick: () => addMembers(c) }, h('span.ir-ic', { html: icon('plus', 24) }), h('span', c.type === 'channel' ? 'Add Subscribers' : 'Add Members')) : null,
      ...memberList,
      grp ? h('div.section-gap') : null,
      grp ? h('div.settings-row.danger#leave-group', { role: 'button', tabIndex: 0, onclick: async () => { const { deleteChat } = await import('./list.js'); deleteChat(c); } }, h('span.ir-ic', { html: icon('logout', 24) }), h('span', myRole(c) === 'owner' ? 'Delete and leave' : `Leave ${c.type}`)) : null));
}
function memberMenu(c, uid, anchor) {
  const role = c.members[uid]?.role, admin = isAdminOf(c), owner = myRole(c) === 'owner';
  showMenu([
    uid !== S.me.id ? { icon: 'user', label: 'Send Message', onclick: () => { location.hash = uid; } } : null,
    owner && uid !== S.me.id && role !== 'owner' && c.type === 'group' || owner && uid !== S.me.id && role !== 'owner' ? { icon: 'verified', label: role === 'admin' ? 'Dismiss as admin' : 'Promote to admin', onclick: () => api('POST', `/chats/${c.id}/admins/${uid}`, { admin: role !== 'admin' }).catch(e => toast(e.message)) } : null,
    admin && uid !== S.me.id && role !== 'owner' && (owner || role !== 'admin') ? { icon: 'delete', danger: true, label: 'Remove from group', onclick: async () => { if (await confirmBox('Remove member?', `Remove ${user(uid).name} from "${c.title}"?`, 'Remove')) api('DELETE', `/chats/${c.id}/members/${uid}`).catch(e => toast(e.message)); } } : null,
  ].filter(Boolean), anchor);
}
function addMembers(c) {
  const p = contactPicker({ multi: true, exclude: Object.keys(c.members), hint: 'Add people to ' + c.title });
  const go = h('button.round-fab', { 'aria-label': 'Add', html: icon('check', 26), onclick: async () => { if (!p.selected.size) return toast('Select at least one person'); await api('POST', `/chats/${c.id}/members`, { userIds: [...p.selected.keys()] }).catch(e => toast(e.message)); popSub(); } });
  pushSub('Add Members', h('div.wiz', p.el, go));
}
function editGroup(c) {
  const photo = photoPicker(c.photo);
  const name = h('input.field-input#edit-title', { value: c.title, maxLength: 64, 'aria-label': 'Name' });
  const desc = h('input.field-input#edit-desc', { value: c.description || '', maxLength: 255, placeholder: 'Description', 'aria-label': 'Description' });
  modal({ title: 'Edit ' + c.type, body: h('div.edit-group', photo.el, name, desc), actions: [{ label: 'Cancel' }, { label: 'Save', onclick: () => { api('PATCH', '/chats/' + c.id, { title: name.value, description: desc.value, photo: photo.get() || '' }).catch(e => toast(e.message)); } }] });
}
on('srv:conference', onConference);
