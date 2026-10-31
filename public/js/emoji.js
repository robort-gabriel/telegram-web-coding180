// Emoji picker (static emoji set, grouped by category).
import { h } from './util.js';
import { icon } from './icons.js';

const sp = s => [...s.replace(/\s+/g, '')].filter(c => c.trim());
export const CATS = [
  ['😀', 'Smileys', sp('😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😝😜🤪🤨🧐🤓😎🥳😏😒😞😔😟😕🙁☹️😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🤔🤭🤫🤥😶😐😑😬🙄😯😦😧😮😲🥱😴🤤😪😵🤐🥴🤢🤮🤧😷🤒🤕')],
  ['👋', 'People', sp('👋🤚🖐✋🖖👌🤌🤏✌️🤞🤟🤘🤙👈👉👆👇☝️👍👎✊👊🤛🤜👏🙌👐🤲🤝🙏✍️💅🤳💪🦾🧠👀👁👅👄💋👶🧒👦👧🧑👨👩🧓👴👵')],
  ['🐶', 'Nature', sp('🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🐤🦆🦅🦉🦇🐺🐗🐴🦄🐝🐛🦋🐌🐞🐜🐢🐍🦎🐙🦑🦀🐠🐟🐬🐳🐋🦈🌵🎄🌲🌳🌴🌱🌿☘️🍀🍁🍂🍃🌺🌸🌼🌻🌞🌝⭐🌟✨⚡🔥🌈☀️⛅☁️❄️💧🌊')],
  ['🍔', 'Food', sp('🍏🍎🍐🍊🍋🍌🍉🍇🍓🍈🍒🍑🥭🍍🥥🥝🍅🥑🥦🥕🌽🌶🥔🍠🥐🍞🥖🧀🥚🍳🥞🥓🥩🍗🍖🌭🍔🍟🍕🥪🌮🌯🍝🍜🍲🍛🍣🍱🍤🍙🍚🍥🍦🍧🍨🍩🍪🎂🍰🧁🍫🍬🍭🍮🍯☕🍵🥤🍺🍻🥂🍷🍸🍹')],
  ['⚽', 'Activity', sp('⚽🏀🏈⚾🥎🎾🏐🏉🎱🏓🏸🥅🏒🏏⛳🏹🎣🥊🥋🎽🛹⛸🎿⛷🏂🏋️🤸🤺🏇🏊🚴🏆🥇🥈🥉🏅🎖🎫🎭🎨🎬🎤🎧🎼🎹🥁🎷🎺🎸🎻🎲🎯🎳🎮🎰🧩')],
  ['🚗', 'Travel', sp('🚗🚕🚙🚌🚎🏎🚓🚑🚒🚐🚚🚛🚜🛵🏍🚲✈️🛫🛬🚀🛸🚁⛵🚤🚢⚓🏠🏡🏢🏬🏰🗼🗽⛪🕌🏖🏝🏔🌋🗻🏕⛺🌃🌄🌅🌆🌇🌉🎡🎢')],
  ['💡', 'Objects', sp('⌚📱💻⌨️🖥🖨🖱💽💾📷📹🎥📞☎️📺📻⏰⌛💡🔦🕯💰💳💎🔧🔨🛠⚙️🔒🔑🗝📦✉️📧📝📁📅📌📎✂️🗑🎁🎈🎉🎊')],
  ['❤️', 'Symbols', sp('❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💯💢💥💫💦💨🕳💬🗯💭💤✅❌❓❗‼️⭕🔴🟠🟡🟢🔵🟣⚫⚪▶️⏸⏯⏹🔔🔕🎵🎶➕➖✔️☑️🔝🆗🆕🆒🆓')],
];
export const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👎'];

export function emojiPicker(onPick) {
  let cat = 0;
  const grid = h('div.emoji-grid');
  const tabs = h('div.emoji-tabs');
  const render = () => {
    grid.replaceChildren(...CATS[cat][2].map(e => h('button.emoji', { onclick: ev => { ev.stopPropagation(); onPick(e); } }, e)));
    [...tabs.children].forEach((t, i) => t.classList.toggle('active', i === cat));
    grid.scrollTop = 0;
  };
  CATS.forEach((c, i) => tabs.append(h('button.emoji-tab', { title: c[1], onclick: e => { e.stopPropagation(); cat = i; render(); } }, c[0])));
  const el = h('div.emoji-picker', { onmousedown: e => e.preventDefault() }, grid, tabs);
  render();
  return el;
}
export { icon };
