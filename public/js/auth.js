// Sign-up / login: phone -> fake code -> profile name (new accounts only).
import { h, $, toast, readImage, avatar } from './util.js';
import { api, setToken } from './state.js';
import { COUNTRIES, flag, findByPhone } from './countries.js';

const LOGO = `<svg viewBox="0 0 240 240" width="160" height="160"><defs><linearGradient id="tgl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5eade6"/><stop offset="1" stop-color="#4e97cc"/></linearGradient></defs><circle cx="120" cy="120" r="120" fill="url(#tgl)"/><path fill="#fff" d="M54 118.5c35-15.2 58.3-25.3 70-30.2 33.3-13.9 40.3-16.3 44.8-16.4 1 0 3.2.2 4.7 1.4 1.2 1 1.5 2.300 1.700 3.300s.4 3.100.2 4.800c-1.800 19-9.600 65-13.600 86.300-1.700 9-5 12-8.200 12.300-7 .6-12.300-4.600-19-9-10.600-6.900-16.500-11.200-26.800-18-11.900-7.800-4.200-12.100 2.600-19.100 1.800-1.800 32.500-29.800 33.100-32.300.100-.3.100-1.500-.6-2.100s-1.700-.4-2.500-.2c-1.100.2-17.900 11.400-50.600 33.500-4.800 3.300-9.100 4.900-13 4.800-4.300-.1-12.500-2.400-18.700-4.400-7.500-2.400-13.500-3.700-13-7.900.3-2.200 3.300-4.400 8.900-6.700z"/></svg>`;

export function showAuth(root) {
  return new Promise(resolve => {
    let phone = '', code = '';
    const screen = h('div.auth');
    root.replaceChildren(screen);

    const err = h('div.auth-error');
    const setErr = m => { err.textContent = m || ''; };

    // Decorative placeholder: a real QR login does not exist in this demo, so the pattern is seeded noise with real-looking finder squares.
    function qrSvg() {
      const N = 33, cell = 7, size = N * cell; let seed = 1807;
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const inFinder = (x, y) => (x < 8 && y < 8) || (x >= N - 8 && y < 8) || (x < 8 && y >= N - 8);
      let d = '';
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (inFinder(x, y) || (Math.abs(x - 16) < 6 && Math.abs(y - 16) < 6)) continue;
        if (rnd() < .5) d += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" rx="2"/>`;
      }
      const finder = (x, y) => `<rect x="${x * cell + 3}" y="${y * cell + 3}" width="${cell * 7 - 6}" height="${cell * 7 - 6}" rx="12" fill="none" stroke="#000" stroke-width="7"/><rect x="${(x + 2) * cell}" y="${(y + 2) * cell}" width="${cell * 3}" height="${cell * 3}" rx="5"/>`;
      return `<svg viewBox="0 0 ${size} ${size}" width="100%" height="100%" fill="#000">${d}${finder(0, 0)}${finder(N - 7, 0)}${finder(0, N - 7)}<circle cx="${size / 2}" cy="${size / 2}" r="${cell * 6.4}" fill="#3390ec"/><path fill="#fff" transform="translate(${size / 2 - 19} ${size / 2 - 19}) scale(.16)" d="M54 118.5c35-15.2 58.3-25.3 70-30.2 33.3-13.9 40.3-16.3 44.8-16.4 1 0 3.2.2 4.7 1.4 1.2 1 1.5 2.3 1.7 3.3s.4 3.1.2 4.8c-1.8 19-9.6 65-13.6 86.3-1.7 9-5 12-8.2 12.3-7 .6-12.3-4.6-19-9-10.6-6.9-16.5-11.2-26.8-18-11.9-7.8-4.2-12.1 2.6-19.1 1.8-1.8 32.5-29.8 33.1-32.3.1-.3.1-1.5-.6-2.1s-1.7-.4-2.5-.2c-1.1.2-17.9 11.4-50.6 33.5-4.8 3.3-9.1 4.9-13 4.8-4.3-.1-12.5-2.4-18.7-4.4-7.5-2.4-13.5-3.7-13-7.9.3-2.2 3.3-4.4 8.9-6.7z"/></svg>`;
    }
    const passkey = () => toast('Passkeys are not available in this demo');

    function stepQr() {
      const step = (n, ...c) => h('li', h('span.qr-n', String(n)), h('span', ...c));
      screen.replaceChildren(h('div.auth-box.qr',
        h('div.qr-code', { html: qrSvg() }),
        h('h1.qr-title', 'Log in to Telegram by QR Code'),
        h('ol.qr-steps',
          step(1, 'Open Telegram on your phone'),
          step(2, 'Go to ', h('b', 'Settings'), ' > ', h('b', 'Devices'), ' > ', h('b', 'Add Device')),
          step(3, 'Point your phone at this screen to confirm login')),
        h('button.auth-link', { id: 'auth-to-phone', onclick: stepPhone }, 'Log in by phone number'),
        h('button.auth-link', { onclick: passkey }, 'Log in with passkey')));
    }

    function stepPhone() {
      let country = COUNTRIES.find(c => c.iso === 'NG');
      const prefix = () => '+' + country.dial;
      const input = h('input', { type: 'tel', value: phone || prefix() + ' ', autocomplete: 'tel', id: 'auth-phone', 'aria-label': 'Your phone number' });
      const cInput = h('input', { type: 'text', id: 'auth-country', autocomplete: 'off', 'aria-label': 'Country', value: country.name });
      const arrow = h('span.of-arrow', { html: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>' });
      const list = h('div.country-list'); list.hidden = true;
      const field = h('div.outlined.has-value', h('label', 'Country'), cInput, arrow, list);
      const pfield = h('div.outlined', h('label', 'Your phone number'), input);
      const keep = h('input', { type: 'checkbox', checked: true, id: 'auth-keep' });
      const nextWrap = h('div.auth-next-wrap');

      const digits = () => input.value.replace(/\D/g, '').length;
      const syncNext = () => {
        const ok = digits() > country.dial.length + 3 || input.value.replace(/[^\d+]/g, '').length >= 7;
        nextWrap.replaceChildren(ok ? h('button.primary-btn', { id: 'auth-next', onclick: next }, 'Next') : '');
      };
      const setCountry = c => {
        country = c; cInput.value = c.name; closeList();
        input.value = prefix() + ' '; input.focus(); syncNext();
      };
      const renderList = q => {
        const items = COUNTRIES.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.dial.startsWith(q.replace(/\D/g, '') || '~'));
        list.replaceChildren(...items.map(c => h('div.country-item' + (c === country ? '.sel' : ''), { onmousedown: e => { e.preventDefault(); setCountry(c); } },
          h('span.cf', flag(c.iso)), h('span.cn', c.name), h('span.cd', '+' + c.dial))));
        if (!items.length) list.replaceChildren(h('div.country-empty', 'Country not found'));
      };
      const openList = () => { renderList(''); list.hidden = false; field.classList.add('open', 'focus'); cInput.select(); const s = list.querySelector('.sel'); if (s) list.scrollTop = Math.max(0, s.offsetTop - 120); };
      function closeList() { list.hidden = true; field.classList.remove('open', 'focus'); cInput.value = country.name; }
      cInput.addEventListener('focus', openList);
      cInput.addEventListener('click', () => { if (list.hidden) openList(); });
      cInput.addEventListener('input', () => renderList(cInput.value));
      cInput.addEventListener('blur', closeList);
      cInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { const f = list.querySelector('.country-item'); if (f) { e.preventDefault(); const q = cInput.value.toLowerCase(); setCountry(COUNTRIES.find(c => c.name.toLowerCase().includes(q)) || country); } }
        if (e.key === 'Escape') cInput.blur();
      });
      arrow.addEventListener('mousedown', e => { e.preventDefault(); list.hidden ? (cInput.focus(), openList()) : cInput.blur(); });
      input.addEventListener('focus', () => pfield.classList.add('focus'));
      input.addEventListener('blur', () => pfield.classList.remove('focus'));
      input.addEventListener('input', () => {
        const c = findByPhone(input.value);
        if (c && c !== country) { country = c; cInput.value = c.name; }
        syncNext();
      });
      const next = async () => {
        setErr('');
        try {
          const r = await api('POST', '/auth/send-code', { phone: input.value });
          phone = input.value.replace(/[^\d+]/g, ''); stepCode(r);
        } catch (e) { setErr(e.message); }
      };
      input.addEventListener('keydown', e => e.key === 'Enter' && next());
      const demo = n => { const c = COUNTRIES.find(x => x.iso === 'US'); country = c; cInput.value = c.name; input.value = n.replace('+1', '+1 '); syncNext(); input.focus(); };
      screen.replaceChildren(h('div.auth-box.phone',
        h('div.auth-logo', { html: LOGO }), h('h1', 'Telegram'),
        h('p.auth-sub', 'Please confirm your country code and enter your phone number.'),
        field, pfield,
        h('label.auth-check', keep, h('span.box', { html: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.500 4.500L19 7.500"/></svg>' }), h('span', 'Keep me signed in')),
        err, nextWrap,
        h('button.auth-link', { id: 'auth-to-qr', onclick: stepQr }, 'Log in by QR code'),
        h('button.auth-link', { onclick: passkey }, 'Log in with passkey'),
        h('div.auth-demo', h('span', 'Demo accounts:'),
          h('button.link-btn', { onclick: () => demo('+15550001') }, 'Alice'),
          h('button.link-btn', { onclick: () => demo('+15550002') }, 'Bob'))));
      syncNext();
      setTimeout(() => input.focus(), 0);
    }

    function stepCode(info) {
      const input = h('input.auth-input.code', { type: 'text', inputMode: 'numeric', maxLength: 5, placeholder: 'Code', autocomplete: 'one-time-code', id: 'auth-code', 'aria-label': 'Verification code' });
      const verify = async (extra = {}) => {
        setErr('');
        try {
          const r = await api('POST', '/auth/verify', { phone, code, ...extra });
          if (r.needsProfile) return stepProfile();
          setToken(r.token); resolve(r.user);
        } catch (e) { setErr(e.message); }
      };
      input.addEventListener('input', () => { code = input.value.replace(/\D/g, ''); input.value = code; if (code.length === 5) verify(); });
      screen.replaceChildren(h('div.auth-box',
        h('div.auth-logo', { html: LOGO }), h('h1', phone, h('button.icon-btn.inline', { title: 'Edit', onclick: stepPhone, html: '✎' })),
        h('p.auth-sub', 'We have sent you a code (simulated). Demo code: ', h('b', info.demoCode), info.exists ? '' : ' · new account'),
        input, err));
      input.focus();
    }

    function stepProfile() {
      let photo = '';
      const first = h('input.auth-input', { placeholder: 'Name (required)', id: 'auth-name', maxLength: 64 });
      const last = h('input.auth-input', { placeholder: 'Last Name (optional)', id: 'auth-last', maxLength: 64 });
      const un = h('input.auth-input', { placeholder: 'Username (optional)', id: 'auth-username', maxLength: 32 });
      const av = h('div.auth-photo', { html: '📷', onclick: () => file.click() });
      const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => { if (file.files[0]) { photo = await readImage(file.files[0]); av.style.background = `center/cover url(${photo})`; av.textContent = ''; } } });
      const go = async () => {
        if (!first.value.trim()) return setErr('Please enter your name');
        setErr('');
        try {
          const r = await api('POST', '/auth/verify', { phone, code, name: (first.value + ' ' + last.value).trim(), username: un.value });
          setToken(r.token);
          if (photo) await api('PATCH', '/me', { avatar: photo });
          resolve(r.user);
        } catch (e) { setErr(e.message); }
      };
      screen.replaceChildren(h('div.auth-box', av, file, h('h1', 'Your Name'),
        h('p.auth-sub', 'Enter your name and add a profile picture.'), first, last, un, err,
        h('button.primary-btn', { id: 'auth-start', onclick: go }, 'START MESSAGING')));
      first.focus();
    }
    stepQr();
  });
}
