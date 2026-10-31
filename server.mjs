// Telegram Web: REA server. No dependencies: static files, JSON API, SSE, JSON-file store.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const DB_FILE = path.join(DATA, 'db.json');
const PORT = Number(process.env.PORT) || 4530;
const DEMO_CODE = '12345';
fs.mkdirSync(UPLOADS, { recursive: true });
if (process.argv.includes('--reset')) fs.rmSync(DB_FILE, { force: true });

// ---------- store ----------
let db;
function load() {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { db = null; }
  if (!db) { db = { seq: 1000, users: {}, chats: {}, tokens: {}, contacts: {}, state: {}, conferences: {} }; seed(); save(true); }
  if ((db.seedV || 0) < 2) { seedExtra(); db.seedV = 2; save(true); } // adds a long, scrollable chat history for the demo accounts
}

// ~30 placeholder contacts with private chats spread over ~2 months, plus groups and channels.
function seedExtra() {
  const alice = Object.values(db.users).find(u => u.phone === '+15550001');
  const bob = Object.values(db.users).find(u => u.phone === '+15550002');
  if (!alice || !bob) return;
  let s = 20260101; const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = a => a[Math.floor(rand() * a.length)];
  const now = Date.now(), ago = (d, h = 0) => now - d * 864e5 - h * 36e5;
  const NAMES = ['Amaka Obi', 'Tunde Bakare', 'Chioma Eze', 'Femi Adeyemi', 'Sade Johnson', 'Kunle Ade', 'Ngozi Okafor', 'Emeka Nwosu', 'Zainab Musa', 'Ibrahim Sule', 'Bisi Alabi', 'Segun Coker', 'Hauwa Bello', 'Chidi Okeke', 'Yemi Cole', 'Tola Martins', 'Dayo Williams', 'Nneka Umeh', 'Lola Ajayi', 'Kelechi Ibe', 'Maya Chen', 'Liam Carter', 'Sofia Rossi', 'Noah Kim', 'Priya Patel', 'Omar Haddad', 'Elena Petrova', 'Lucas Silva', 'Hana Sato', 'Jonas Weber'];
  const LINES = ['Hey, are you free later?', 'Sure, what time works?', 'Let’s catch up this weekend', 'Sent you the document', 'Thanks a lot!', 'Haha that is hilarious 😂', 'On my way', 'Can you review my pull request?', 'Looks good to me 👍', 'Did you see the news?', 'Happy birthday! 🎉', 'Call me when you can', 'Running late, 10 mins', 'Dinner tonight?', 'Okay, noted', 'See you tomorrow', 'Good morning ☀️', 'Where are you?', 'Please send the invoice', 'Done ✅', 'Check this out https://example.com', 'I will get back to you shortly', 'Perfect, thank you!', 'Can we move the meeting to 3pm?'];
  const people = NAMES.map((n, i) => {
    const u = mkUser('+1555010' + String(i).padStart(2, '0'), n, n.split(' ')[0].toLowerCase() + '_' + i);
    u.lastSeen = ago(0, rand() * 60); u.bio = rand() < .4 ? 'Placeholder contact' : '';
    return u;
  });
  for (const owner of [alice, bob]) {
    const mine = people.filter((_, i) => owner === alice || i % 2 === 0);
    db.contacts[owner.id] = [...new Set([...(db.contacts[owner.id] || []), ...people.map(p => p.id)])];
    mine.forEach((p, i) => {
      const chat = ensurePrivate(owner.id, p.id);
      const n = 2 + Math.floor(rand() * 5), base = i * 1.9 + rand();
      const lastFromPeer = rand() < .45, unread = lastFromPeer && rand() < .6 ? 1 + Math.floor(rand() * 3) : 0;
      for (let k = 0; k < n; k++) {
        const fromPeer = k >= n - unread || (k === n - 1 ? lastFromPeer : rand() < .5);
        addMsg(chat, fromPeer ? p.id : owner.id, pick(LINES), ago(base, (n - k) * 0.2));
      }
      st(owner.id, p.id).readMax = chat.seq - unread;
      st(p.id, owner.id).readMax = rand() < .75 ? chat.seq : 0;
      if (i === 2 || i === 9) st(owner.id, p.id).pinned = true;
      if (i === 14) st(owner.id, p.id).archived = true;
      if (i === 5) st(owner.id, p.id).muted = true;
    });
    const GROUPS = ['Design Team', 'Weekend Football', 'Family Chat', 'Book Club', 'Startup Founders', 'Study Group'];
    GROUPS.forEach((title, gi) => {
      const members = people.slice(gi * 4, gi * 4 + 5).map(p => p.id);
      const g = mkChat('group', title + (owner === bob ? ' B' : ''), owner.id, members);
      const n = 4 + Math.floor(rand() * 6);
      for (let k = 0; k < n; k++) addMsg(g, pick([owner.id, ...members]), pick(LINES), ago(gi * 3.3 + 0.5, (n - k) * 0.3));
      const unread = gi % 2 === 0 ? 1 + Math.floor(rand() * 8) : 0;
      st(owner.id, g.id).readMax = g.seq - unread;
      if (gi === 3) st(owner.id, g.id).muted = true;
    });
    const CHANNELS = ['Tech Daily', 'Lagos Events', 'Movie Night', 'Dev Tips', 'Weekly Digest'];
    CHANNELS.forEach((title, ci) => {
      const publisher = people[10 + ci];
      const c = mkChat('channel', title + (owner === bob ? ' B' : ''), publisher.id, [owner.id]);
      c.description = 'Demo channel with placeholder posts.';
      const n = ci === 0 ? 40 : 3 + ci;
      for (let k = 0; k < n; k++) addMsg(c, publisher.id, ci === 0 ? `Post #${k + 1}: placeholder headline for the day` : pick(LINES), ago(ci * 4.2 + 0.2, (n - k) * 0.5));
      st(owner.id, c.id).readMax = ci === 0 ? 0 : c.seq;
      st(owner.id, c.id).muted = ci % 2 === 0;
    });
  }
}
let saveTimer = null;
function save(now) {
  if (now) { fs.writeFileSync(DB_FILE, JSON.stringify(db)); return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DB_FILE, JSON.stringify(db), () => {}), 150);
}
const nid = () => String(++db.seq);
const rnd = (n = 8) => crypto.randomBytes(n).toString('base64url').slice(0, n);
const COLORS = 7;

function mkUser(phone, name, username, bio = '') {
  const id = nid();
  db.users[id] = { id, phone, name, username, bio, color: Number(id) % COLORS, avatar: '', lastSeen: Date.now() - 3600e3, createdAt: Date.now() };
  db.contacts[id] = [];
  db.state[id] = {};
  return db.users[id];
}
function seed() {
  const a = mkUser('+15550001', 'Alice Demo', 'alice', 'Demo account A');
  const b = mkUser('+15550002', 'Bob Demo', 'bob', 'Demo account B');
  const c = mkUser('+15550003', 'Carol Placeholder', 'carol', 'Loves placeholder data');
  const d = mkUser('+15550004', 'Dave Sample', 'dave', '');
  const e = mkUser('+15550005', 'Erin Example', 'erin', 'Out of office');
  for (const u of [a, b]) db.contacts[u.id] = [a, b, c, d, e].filter(x => x.id !== u.id).map(x => x.id);
  db.contacts[c.id] = [a.id, b.id];
  const t = Date.now();
  const botChat = ensurePrivate(a.id, c.id);
  addMsg(botChat, c.id, 'Hi Alice! This is placeholder data, not a real chat.', t - 7200e3);
  addMsg(botChat, a.id, 'Welcome to Telegram Web: REA 👋', t - 7100e3);
  const g = mkChat('group', 'Demo Group', a.id, [b.id, c.id, d.id]);
  addMsg(g, b.id, 'Group created. Say hi!', t - 3600e3);
  const ch = mkChat('channel', 'REA News', a.id, [b.id, c.id]);
  ch.description = 'Demo channel with placeholder posts.';
  addMsg(ch, a.id, 'Welcome to the REA News demo channel.', t - 1800e3);
}

// ---------- chats ----------
function mkChat(type, title, ownerId, memberIds = []) {
  const id = '-' + nid();
  const members = { [ownerId]: { role: 'owner', joined: Date.now() } };
  for (const m of memberIds) members[m] = { role: 'member', joined: Date.now() };
  db.chats[id] = { id, type, title, description: '', photo: '', members, invite: rnd(10), messages: [], seq: 0, pinned: [], createdAt: Date.now() };
  return db.chats[id];
}
function privKey(a, b) { return 'p:' + [a, b].sort().join(':'); }
function ensurePrivate(a, b) {
  const key = privKey(a, b);
  if (!db.chats[key]) db.chats[key] = { id: key, type: a === b ? 'saved' : 'private', members: { [a]: {}, [b]: {} }, messages: [], seq: 0, pinned: [], createdAt: Date.now() };
  return db.chats[key];
}
// The id a viewer uses for a chat: peer id for private, own id for saved, negative id for groups/channels.
function refFor(chat, uid) {
  if (chat.type === 'private' || chat.type === 'saved') return Object.keys(chat.members).find(k => k !== uid) || uid;
  return chat.id;
}
function resolve(ref, uid, create) {
  if (ref.startsWith('-')) return db.chats[ref];
  if (!db.users[ref]) return null;
  const key = privKey(uid, ref);
  if (db.chats[key]) return db.chats[key];
  return create ? ensurePrivate(uid, ref) : null;
}
function addMsg(chat, from, text, ts = Date.now(), extra = {}) {
  const m = { id: ++chat.seq, from, text, ts, ...extra };
  chat.messages.push(m);
  return m;
}
const isMember = (chat, uid) => !!chat.members[uid];
const canPost = (chat, uid) => isMember(chat, uid) && (chat.type !== 'channel' || ['owner', 'admin'].includes(chat.members[uid].role));
const isAdmin = (chat, uid) => ['owner', 'admin'].includes(chat.members[uid]?.role);
const pubUser = u => ({ id: u.id, name: u.name, username: u.username, bio: u.bio, color: u.color, avatar: u.avatar, lastSeen: u.lastSeen, online: online(u.id) });
const st = (uid, ref) => (db.state[uid][ref] ||= { archived: false, muted: false, pinned: false, readMax: 0, cleared: 0 });

function msgView(chat, m) {
  if (m.deleted) return null;
  return m;
}
function unreadCount(chat, uid) {
  const s = st(uid, refFor(chat, uid));
  return chat.messages.filter(m => !m.deleted && m.id > s.readMax && m.id > s.cleared && m.from !== uid && !m.service).length;
}
function chatSummary(chat, uid) {
  const ref = refFor(chat, uid), s = st(uid, ref);
  const visible = chat.messages.filter(m => !m.deleted && m.id > s.cleared);
  const last = visible[visible.length - 1] || null;
  const out = {
    id: ref, type: chat.type, last, unread: unreadCount(chat, uid), state: s, pinned: chat.pinned,
    reads: Object.fromEntries(Object.keys(chat.members).filter(k => k !== uid).map(k => [k, st(k, refFor(chat, k)).readMax])),
    members: Object.fromEntries(Object.entries(chat.members).map(([k, v]) => [k, { role: v.role || 'member' }])),
  };
  if (chat.type === 'group' || chat.type === 'channel') Object.assign(out, { title: chat.title, description: chat.description, photo: chat.photo, invite: isAdmin(chat, uid) ? chat.invite : undefined, color: Number(ref.slice(1)) % COLORS });
  return out;
}
function listFor(uid) {
  const chats = [];
  for (const c of Object.values(db.chats)) {
    if (!isMember(c, uid)) continue;
    const ref = refFor(c, uid);
    if (c.type !== 'saved' && c.type !== 'group' && c.type !== 'channel' && !c.messages.length) continue;
    chats.push(chatSummary(c, uid));
  }
  const users = {};
  for (const c of chats) {
    const ch = db.chats[c.type === 'group' || c.type === 'channel' ? c.id : privKey(uid, c.id)];
    for (const k of Object.keys(ch.members)) users[k] = pubUser(db.users[k]);
  }
  return { chats, users };
}

// ---------- SSE ----------
const streams = new Map(); // uid -> Set(res)
const online = uid => (streams.get(uid)?.size || 0) > 0;
function push(uid, type, data) {
  for (const res of streams.get(uid) || []) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
function pushChat(chat, type, build, except) {
  for (const uid of Object.keys(chat.members)) if (uid !== except || type === 'message') push(uid, type, build(uid));
}
function pushPresence(uid) {
  const u = pubUser(db.users[uid]);
  for (const other of Object.keys(streams)) void other;
  for (const [id] of streams) if (id !== uid) push(id, 'presence', u);
}
function pushChatSummary(chat) { pushChat(chat, 'chat', uid => ({ chat: chatSummary(chat, uid), users: Object.fromEntries(Object.keys(chat.members).map(k => [k, pubUser(db.users[k])])) })); }

// ---------- http helpers ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.json': 'application/json', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' };
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = (req, limit = 20e6) => new Promise((ok, no) => {
  const parts = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > limit) { no(new Error('too large')); req.destroy(); } else parts.push(c); });
  req.on('end', () => ok(Buffer.concat(parts)));
  req.on('error', no);
});
const readJson = async req => { const b = await readBody(req, 2e6); try { return b.length ? JSON.parse(b) : {}; } catch { return {}; } };
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (code, msg) => { throw new HttpError(code, msg); };

function authUser(req, url) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
  const uid = db.tokens[token];
  return uid ? db.users[uid] : null;
}

// ---------- API ----------
async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const seg = url.pathname.split('/').filter(Boolean).slice(1); // after 'api'
  // --- auth ---
  if (route === 'POST /api/auth/send-code') {
    const { phone } = await readJson(req);
    const p = String(phone || '').replace(/[^\d+]/g, '');
    if (p.length < 5) bad(400, 'Invalid phone number');
    return send(res, 200, { ok: true, demoCode: DEMO_CODE, exists: Object.values(db.users).some(u => u.phone === p) });
  }
  if (route === 'POST /api/auth/verify') {
    const { phone, code, name, username } = await readJson(req);
    const p = String(phone || '').replace(/[^\d+]/g, '');
    if (String(code) !== DEMO_CODE) bad(400, 'Invalid code');
    let u = Object.values(db.users).find(x => x.phone === p);
    if (!u) {
      if (!name || !String(name).trim()) return send(res, 200, { needsProfile: true });
      u = mkUser(p, String(name).trim().slice(0, 64), uniqueUsername(username || ''));
      const alice = Object.values(db.users).find(x => x.username === 'alice');
      if (alice) { db.contacts[u.id] = [alice.id]; db.contacts[alice.id].push(u.id); }
    }
    const token = rnd(32); db.tokens[token] = u.id; save();
    return send(res, 200, { token, user: pubUser(u) });
  }
  const me = authUser(req, url);
  if (!me) bad(401, 'Unauthorized');
  const uid = me.id;

  if (route === 'GET /api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(': ok\n\n');
    const wasOnline = online(uid);
    if (!streams.has(uid)) streams.set(uid, new Set());
    streams.get(uid).add(res);
    if (!wasOnline) pushPresence(uid);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      streams.get(uid)?.delete(res);
      if (!online(uid)) { streams.delete(uid); db.users[uid].lastSeen = Date.now(); save(); pushPresence(uid); }
    });
    return;
  }
  if (route === 'POST /api/auth/logout') { for (const [t, u] of Object.entries(db.tokens)) if (u === uid && req.headers.authorization?.endsWith(t)) delete db.tokens[t]; save(); return send(res, 200, { ok: true }); }

  if (route === 'GET /api/bootstrap') {
    ensurePrivate(uid, uid);
    const { chats, users } = listFor(uid);
    users[uid] = pubUser(me);
    const contacts = (db.contacts[uid] || []).map(id => db.users[id]).filter(Boolean).map(pubUser);
    for (const c of contacts) users[c.id] = c;
    return send(res, 200, { me: pubUser(me), chats, users, contacts: contacts.map(c => c.id) });
  }
  if (route === 'PATCH /api/me') {
    const b = await readJson(req);
    if (typeof b.name === 'string' && b.name.trim()) me.name = b.name.trim().slice(0, 64);
    if (typeof b.bio === 'string') me.bio = b.bio.slice(0, 200);
    if (typeof b.avatar === 'string') me.avatar = b.avatar;
    if (typeof b.username === 'string') {
      const un = b.username.replace(/^@/, '').toLowerCase();
      if (un && !/^[a-z][a-z0-9_]{3,31}$/.test(un)) bad(400, 'Username must be 4-32 chars: letters, digits, underscore');
      if (un && Object.values(db.users).some(u => u.username === un && u.id !== uid)) bad(400, 'Username is already taken');
      me.username = un;
    }
    save();
    const u = pubUser(me);
    for (const [id] of streams) push(id, 'presence', u);
    return send(res, 200, { user: u });
  }
  if (route === 'GET /api/users') {
    const q = (url.searchParams.get('q') || '').toLowerCase().replace(/^@/, '').trim();
    if (!q) return send(res, 200, { users: [] });
    const users = Object.values(db.users).filter(u => u.id !== uid && (u.username.includes(q) || u.name.toLowerCase().includes(q) || u.phone.includes(q))).slice(0, 20).map(pubUser);
    return send(res, 200, { users });
  }
  if (route === 'POST /api/contacts') {
    const { userId } = await readJson(req);
    if (!db.users[userId] || userId === uid) bad(400, 'No such user');
    const list = db.contacts[uid] ||= [];
    if (!list.includes(userId)) list.push(userId);
    save();
    return send(res, 200, { user: pubUser(db.users[userId]) });
  }
  if (route === 'GET /api/search') {
    const q = (url.searchParams.get('q') || '').toLowerCase().trim();
    if (!q) return send(res, 200, { chats: [], users: [], messages: [] });
    const { chats, users } = listFor(uid);
    const title = c => c.title || (c.type === 'saved' ? 'saved messages' : users[c.id]?.name || '');
    const mc = chats.filter(c => title(c).toLowerCase().includes(q)).map(c => c.id);
    const found = Object.values(db.users).filter(u => u.id !== uid && ((db.contacts[uid] || []).includes(u.id) || u.username === q.replace(/^@/, '')) && (u.name.toLowerCase().includes(q) || u.username.includes(q.replace(/^@/, '')))).map(pubUser);
    const messages = [];
    for (const c of Object.values(db.chats)) {
      if (!isMember(c, uid)) continue;
      const s = st(uid, refFor(c, uid));
      for (const m of c.messages) if (!m.deleted && m.id > s.cleared && m.text && m.text.toLowerCase().includes(q)) messages.push({ chatId: refFor(c, uid), message: m });
    }
    messages.sort((a, b) => b.message.ts - a.message.ts);
    for (const m of messages.slice(0, 30)) { const c = resolve(m.chatId, uid); for (const k of Object.keys(c.members)) users[k] ||= pubUser(db.users[k]); }
    return send(res, 200, { chats: mc, users: found, messages: messages.slice(0, 30), usersById: users });
  }

  // --- uploads ---
  if (route === 'POST /api/upload') {
    const name = decodeURIComponent(req.headers['x-filename'] || 'file').replace(/[^\w.\- ]/g, '_').slice(0, 100);
    const body = await readBody(req, 15e6);
    const file = rnd(12) + path.extname(name).slice(0, 10);
    fs.writeFileSync(path.join(UPLOADS, file), body);
    return send(res, 200, { url: '/uploads/' + file, name, size: body.length, type: req.headers['content-type'] || 'application/octet-stream' });
  }

  // --- conferences ---
  if (route === 'POST /api/conferences') {
    const { title } = await readJson(req);
    const code = rnd(10);
    db.conferences[code] = { code, title: String(title || 'New Conference').slice(0, 64), host: uid, participants: { [uid]: { muted: false, joined: Date.now() } }, createdAt: Date.now() };
    save();
    return send(res, 200, confView(db.conferences[code]));
  }
  if (seg[0] === 'conferences' && seg[1]) {
    const conf = db.conferences[seg[1]];
    if (!conf) bad(404, 'Conference not found');
    if (req.method === 'GET' && !seg[2]) return send(res, 200, confView(conf));
    if (req.method === 'POST' && seg[2] === 'join') { conf.participants[uid] ||= { muted: false, joined: Date.now() }; }
    else if (req.method === 'POST' && seg[2] === 'leave') { delete conf.participants[uid]; }
    else if (req.method === 'POST' && seg[2] === 'mute') { const b = await readJson(req); if (conf.participants[uid]) conf.participants[uid].muted = !!b.muted; }
    else bad(404, 'Not found');
    save();
    const v = confView(conf);
    for (const k of [...Object.keys(conf.participants), uid]) push(k, 'conference', v);
    return send(res, 200, v);
  }

  // --- invite links ---
  if (seg[0] === 'invite' && seg[1]) {
    const chat = Object.values(db.chats).find(c => c.invite === seg[1]);
    if (!chat) bad(404, 'Invite link is invalid or expired');
    if (req.method === 'GET') return send(res, 200, { id: chat.id, title: chat.title, type: chat.type, members: Object.keys(chat.members).length, joined: isMember(chat, uid) });
    if (req.method === 'POST') {
      if (!isMember(chat, uid)) { chat.members[uid] = { role: 'member', joined: Date.now() }; sysMsg(chat, `${me.name} joined via invite link`); save(); }
      pushChatSummary(chat);
      return send(res, 200, { id: chat.id });
    }
  }

  // --- chats ---
  if (route === 'POST /api/chats') {
    const b = await readJson(req);
    if (b.type === 'private') {
      if (!db.users[b.userId]) bad(404, 'No such user');
      resolve(b.userId, uid, true); save();
      return send(res, 200, { id: b.userId, ...bootstrapChat(resolve(b.userId, uid), uid) });
    }
    if (b.type === 'group' || b.type === 'channel') {
      const title = String(b.title || '').trim();
      if (!title) bad(400, 'Name is required');
      const members = (b.members || []).filter(m => db.users[m] && m !== uid);
      const chat = mkChat(b.type, title.slice(0, 64), uid, members);
      chat.description = String(b.description || '').slice(0, 255);
      chat.photo = b.photo || '';
      sysMsg(chat, b.type === 'group' ? `${me.name} created the group "${chat.title}"` : `Channel "${chat.title}" created`);
      save(); pushChatSummary(chat);
      return send(res, 200, { id: chat.id, ...bootstrapChat(chat, uid) });
    }
    bad(400, 'Unknown chat type');
  }
  if (seg[0] === 'chats' && seg[1]) {
    const chat = resolve(seg[1], uid, req.method !== 'DELETE');
    if (!chat || !isMember(chat, uid)) bad(404, 'Chat not found');
    const ref = refFor(chat, uid);
    const sub = seg[2];

    if (req.method === 'GET' && !sub) return send(res, 200, bootstrapChat(chat, uid));
    if (req.method === 'GET' && sub === 'messages' && !seg[3]) {
      const s = st(uid, ref);
      return send(res, 200, { messages: chat.messages.filter(m => !m.deleted && m.id > s.cleared) });
    }
    if (req.method === 'POST' && sub === 'messages' && !seg[3]) {
      const b = await readJson(req);
      if (!canPost(chat, uid)) bad(403, 'You cannot post in this chat');
      const text = String(b.text || '').slice(0, 4096);
      if (!text.trim() && !b.attachment) bad(400, 'Empty message');
      const extra = {};
      if (b.replyTo) { const r = chat.messages.find(m => m.id === b.replyTo && !m.deleted); if (r) extra.replyTo = r.id; }
      if (b.forward) extra.forward = { name: String(b.forward.name || '').slice(0, 64) };
      if (b.attachment) extra.attachment = { url: String(b.attachment.url), name: String(b.attachment.name), size: +b.attachment.size || 0, type: String(b.attachment.type) };
      const m = addMsg(chat, uid, text, Date.now(), extra);
      st(uid, ref).readMax = m.id;
      save();
      for (const k of Object.keys(chat.members)) push(k, 'message', { chatId: refFor(chat, k), message: m, users: { [uid]: pubUser(me) }, chat: chatSummary(chat, k) });
      return send(res, 200, { message: m });
    }
    if (sub === 'messages' && seg[3]) {
      const m = chat.messages.find(x => x.id === +seg[3] && !x.deleted);
      if (!m) bad(404, 'Message not found');
      const act = seg[4];
      if (req.method === 'PATCH' && !act) {
        if (m.from !== uid) bad(403, 'Not your message');
        const b = await readJson(req);
        if (!String(b.text || '').trim()) bad(400, 'Empty message');
        m.text = String(b.text).slice(0, 4096); m.edited = Date.now(); save();
        pushChat(chat, 'message_edit', k => ({ chatId: refFor(chat, k), message: m, chat: chatSummary(chat, k) }));
        return send(res, 200, { message: m });
      }
      if (req.method === 'DELETE' && !act) {
        const forAll = url.searchParams.get('all') === '1';
        if (forAll && m.from !== uid && !isAdmin(chat, uid)) bad(403, 'Cannot delete for everyone');
        if (forAll || chat.type === 'saved') {
          m.deleted = true; chat.pinned = chat.pinned.filter(x => x !== m.id); save();
          pushChat(chat, 'message_delete', k => ({ chatId: refFor(chat, k), ids: [m.id], chat: chatSummary(chat, k) }));
        } else {
          (m.hiddenFor ||= []).push(uid);
          // hide for me only
          m.deleted = Object.keys(chat.members).every(k => m.hiddenFor.includes(k));
          save(); push(uid, 'message_delete', { chatId: ref, ids: [m.id], chat: chatSummary(chat, uid) });
        }
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && act === 'react') {
        const { emoji } = await readJson(req);
        const r = m.reactions ||= {};
        for (const e of Object.keys(r)) if (e !== emoji) { r[e] = r[e].filter(x => x !== uid); if (!r[e].length) delete r[e]; }
        r[emoji] = r[emoji] || [];
        if (r[emoji].includes(uid)) { r[emoji] = r[emoji].filter(x => x !== uid); if (!r[emoji].length) delete r[emoji]; } else r[emoji].push(uid);
        if (!Object.keys(r).length) delete m.reactions;
        save();
        pushChat(chat, 'message_edit', k => ({ chatId: refFor(chat, k), message: m, silent: true }));
        return send(res, 200, { message: m });
      }
      if (req.method === 'POST' && (act === 'pin' || act === 'unpin')) {
        if (chat.type !== 'private' && chat.type !== 'saved' && !isAdmin(chat, uid)) bad(403, 'Admins only');
        chat.pinned = chat.pinned.filter(x => x !== m.id);
        if (act === 'pin') chat.pinned.push(m.id);
        save(); pushChatSummary(chat);
        return send(res, 200, { ok: true });
      }
    }
    if (req.method === 'POST' && sub === 'read') {
      const { upTo } = await readJson(req);
      const s = st(uid, ref);
      if (upTo > s.readMax) { s.readMax = upTo; save(); pushChat(chat, 'read', k => ({ chatId: refFor(chat, k), by: uid, upTo: s.readMax, chat: chatSummary(chat, k) })); }
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && sub === 'typing') {
      pushChat(chat, 'typing', k => ({ chatId: refFor(chat, k), user: uid, name: me.name }), uid);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && sub === 'state') {
      const b = await readJson(req); const s = st(uid, ref);
      for (const k of ['archived', 'muted', 'pinned']) if (typeof b[k] === 'boolean') s[k] = b[k];
      save(); push(uid, 'chat', { chat: chatSummary(chat, uid), users: {} });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE' && !sub) {
      // delete / clear chat for me; owner deleting a group removes it for everyone
      const s = st(uid, ref);
      if ((chat.type === 'group' || chat.type === 'channel') && chat.members[uid].role === 'owner' && url.searchParams.get('all') === '1') {
        const members = Object.keys(chat.members); delete db.chats[chat.id]; save();
        for (const k of members) push(k, 'chat_removed', { chatId: chat.id });
      } else if (chat.type === 'group' || chat.type === 'channel') {
        leave(chat, uid, me);
      } else {
        s.cleared = chat.seq; s.pinned = false; save();
        push(uid, 'chat_removed', { chatId: ref });
      }
      return send(res, 200, { ok: true });
    }
    // group management
    if (chat.type === 'group' || chat.type === 'channel') {
      if (req.method === 'PATCH' && !sub) {
        if (!isAdmin(chat, uid)) bad(403, 'Admins only');
        const b = await readJson(req);
        if (typeof b.title === 'string' && b.title.trim()) chat.title = b.title.trim().slice(0, 64);
        if (typeof b.description === 'string') chat.description = b.description.slice(0, 255);
        if (typeof b.photo === 'string') chat.photo = b.photo;
        save(); pushChatSummary(chat);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && sub === 'members') {
        if (!isAdmin(chat, uid)) bad(403, 'Admins only');
        const { userIds } = await readJson(req);
        const added = [];
        for (const k of userIds || []) if (db.users[k] && !chat.members[k]) { chat.members[k] = { role: 'member', joined: Date.now() }; added.push(db.users[k].name); }
        if (added.length) sysMsg(chat, `${me.name} added ${added.join(', ')}`);
        save(); pushChatSummary(chat);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'DELETE' && sub === 'members' && seg[3]) {
        const target = seg[3];
        if (!isAdmin(chat, uid) || !chat.members[target] || chat.members[target].role === 'owner') bad(403, 'Not allowed');
        if (chat.members[target].role === 'admin' && chat.members[uid].role !== 'owner') bad(403, 'Only the owner can remove admins');
        const tuser = db.users[target];
        delete chat.members[target];
        sysMsg(chat, `${me.name} removed ${tuser.name}`);
        save();
        push(target, 'chat_removed', { chatId: chat.id });
        pushChatSummary(chat);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && sub === 'admins' && seg[3]) {
        if (chat.members[uid].role !== 'owner') bad(403, 'Only the owner can change admins');
        const { admin } = await readJson(req);
        const t = chat.members[seg[3]];
        if (!t || t.role === 'owner') bad(400, 'Invalid member');
        t.role = admin ? 'admin' : 'member';
        sysMsg(chat, `${db.users[seg[3]].name} ${admin ? 'is now an admin' : 'is no longer an admin'}`);
        save(); pushChatSummary(chat);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && sub === 'leave') { leave(chat, uid, me); return send(res, 200, { ok: true }); }
      if (req.method === 'POST' && sub === 'invite-reset') {
        if (!isAdmin(chat, uid)) bad(403, 'Admins only');
        chat.invite = rnd(10); save(); pushChatSummary(chat);
        return send(res, 200, { invite: chat.invite });
      }
    }
  }
  bad(404, 'Not found');
}

function leave(chat, uid, me) {
  const wasOwner = chat.members[uid].role === 'owner';
  delete chat.members[uid];
  const rest = Object.keys(chat.members);
  if (!rest.length) delete db.chats[chat.id];
  else {
    if (wasOwner) { const next = rest.find(k => chat.members[k].role === 'admin') || rest[0]; chat.members[next].role = 'owner'; }
    sysMsg(chat, `${me.name} left the ${chat.type}`);
    pushChatSummary(chat);
  }
  save();
  push(uid, 'chat_removed', { chatId: chat.id });
}
function sysMsg(chat, text) {
  const m = addMsg(chat, null, text, Date.now(), { service: true });
  for (const k of Object.keys(chat.members)) push(k, 'message', { chatId: refFor(chat, k), message: m, users: {}, chat: chatSummary(chat, k) });
}
function bootstrapChat(chat, uid) {
  const users = {};
  for (const k of Object.keys(chat.members)) users[k] = pubUser(db.users[k]);
  return { chat: chatSummary(chat, uid), users };
}
function confView(conf) {
  return { code: conf.code, title: conf.title, host: conf.host, participants: Object.entries(conf.participants).map(([id, p]) => ({ ...pubUser(db.users[id]), muted: p.muted })) };
}
function uniqueUsername(want) {
  let base = want.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!/^[a-z]/.test(base) || base.length < 4) base = 'user' + rnd(5).toLowerCase().replace(/[^a-z0-9]/g, 'x');
  let un = base;
  while (Object.values(db.users).some(u => u.username === un)) un = base + Math.floor(Math.random() * 1000);
  return un;
}

// ---------- server ----------
load();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let p = decodeURIComponent(url.pathname);
    let file;
    if (p.startsWith('/uploads/')) file = path.join(UPLOADS, path.basename(p));
    else file = path.join(PUB, p);
    if (!file.startsWith(PUB) && !file.startsWith(UPLOADS)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(p)) { res.writeHead(404); return res.end('Not found'); }
      file = path.join(PUB, 'index.html'); // SPA fallback (also serves /a/ and /k/)
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'Server error' });
  }
});
server.listen(PORT, () => console.log(`Telegram Web: REA on http://localhost:${PORT}  (demo code ${DEMO_CODE})`));
