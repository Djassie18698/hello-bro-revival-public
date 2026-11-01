// Server-wide settings the owner changes in the Server Manager (/manager): which events run, the in-game announcement.
// Stored in the save (table server_settings) so they survive restarts. Live stats (who is online, recent log) are kept in memory.

// The events our server really runs, as the home screen / Event menu knows them (activity_config.lua ids).
// pos/type are what actXml sends: type 1 = button on the home screen, 2 = line in the Event menu.
const EVENTS = [
  { id: 1, pos: 1, type: 2, icon: '🎁', name: 'Login rewards', desc: 'A gift for every day a player logs in.' },
  { id: 2, pos: 2, type: 2, icon: '⬆️', name: 'Level-up rewards', desc: 'Gifts at levels 10, 20, 30 and up.' },
  { id: 41, pos: 3, type: 2, icon: '📅', name: 'Monthly sign-in', desc: 'Sign in every day of the month for rewards.' },
  { id: 47, pos: 8, type: 2, icon: '🗓️', name: '7-day goals', desc: 'Goals for the first 7 days of a new character.' },
  { id: 12, pos: 6, type: 2, icon: '👹', name: 'World boss', desc: 'Everyone fights one big boss together.' },
  { id: 20, pos: 4, type: 1, icon: '🎡', name: 'Lucky wheel', desc: 'Spin the wheel for prizes (home screen button).' },
  { id: 21, pos: 5, type: 1, icon: '✊', name: 'Rock paper scissors', desc: 'Play mora against the house (home screen button).' },
  { id: 24, pos: 7, type: 1, icon: '💎', name: 'Ninja treasure', desc: 'Number puzzle treasure hunt (home screen button).' },
  { id: 17, pos: 9, type: 1, icon: '🎲', name: 'Millionaire', desc: 'Board game with dice (home screen button).' },
  { id: 16, pos: 20, type: 2, icon: '🗝️', name: 'Treasure chests', desc: 'Open gold / silver / bronze chests with keys (keys drop in story fights) or gold; the original prize lists.' },
  { id: 7, pos: 19, type: 2, icon: '🎫', name: 'Scratch card', desc: '20 gold a card (1 free a day): scratch 3 matching faces to win 5 to 800 gold (original prizes).' },
  { id: 19, pos: 18, type: 2, icon: '📈', name: 'Growth Fund', desc: 'VIP3+: pay 500 gold once, get 2500 gold back in steps at levels 50, 70, 90 ... (original).' },
  { id: 31, pos: 10, type: 1, icon: '🏁', name: 'Stage gift', desc: 'One-time gift for new players (home screen button).' },
  // Limited-time events: off until the owner switches them on. `screen` = the game's event id they show under (several may share one).
  { id: 'xmas', screen: 44, pos: 11, type: 2, limited: true, icon: '🎄', name: 'Christmas festival', desc: 'Win fights for Christmas Caps and Trees, trade them for Santa of the Six Paths. Only one festival at a time.' },
  { id: 'newyear', screen: 44, pos: 11, type: 2, limited: true, icon: '🎆', name: 'New Year festival', desc: 'Same trade event with Kaguya for New Year rewards. Only one festival at a time.' },
  { id: 'godrecruit', screen: 46, pos: 12, type: 2, limited: true, icon: '🎰', name: 'God Recruit', desc: 'Slot machine of holiday god cards (300 gold a spin). Keep the card or return it for gold and energy, trade energy for cards.' },
  { id: 'hottreasure', screen: 43, pos: 13, type: 2, limited: true, icon: '💰', name: 'Hot Treasure', desc: 'Treasure hunt: 1 free hunt a day, then 100 gold (10 hunts 900). Ten hunts always give the top prize.' },
  { id: 'consumption', screen: 37, pos: 14, type: 2, limited: true, icon: '🪙', name: 'Gold spending rewards', desc: 'Spend gold while it runs: 3000 / 8000 / 13000 / 30000 gold unlock god cards, ninjutsu and dans (original rewards).' },
  { id: 'diligence', screen: 33, pos: 15, type: 2, limited: true, icon: '💪', name: 'Diligence gift', desc: 'Every 20 training fights, 5 spar wins, 5 growths... today gives a reward, a few times a day.' },
  { id: 'discount', screen: 27, pos: 16, type: 2, limited: true, icon: '🏷️', name: 'Limited discount', desc: 'Top up 980 gold (free here) while it runs and claim a gift worth 3000 gold, once.' },
  { id: 'lottery', screen: 22, pos: 17, type: 2, limited: true, icon: '🎟️', name: 'Lottery', desc: 'Pick 4-digit numbers for 50 gold (3 a day). Drawn daily at 20:30; matching digits win prizes.' },
  { id: 'groupbuy', screen: 13, pos: 21, type: 2, limited: true, icon: '🛒', name: 'Limited group purchase', desc: 'Discount packs with stock shared by the whole server (original prices: 100 Super Ninja Pills 1500 gold, 80 Reincarnation Pills 2000...). Runs 72 h.' },
  { id: 'bench', noconf: true, limited: true, icon: '📏', name: 'Benchmark rivals in Spar', desc: 'Six computer rivals at the top of Spar with 100K, 500K, 1M, 2M, 4M and 8M defence. Free, no rewards: to test a team.' },
];
const DISCORD = 'https://discord.gg/2Cbp4UDHrU';
const DEFAULT_BANNER = 'Join our Discord for help, bugs and friends: discord.gg/2Cbp4UDHrU  (Settings > Join Discord)';
const DEFAULT_NEWS = 'Welcome back to Hello Bro! Revival server. Join our Discord: discord.gg/2Cbp4UDHrU';

const ensure = (db) => db.exec('CREATE TABLE IF NOT EXISTS server_settings (key TEXT PRIMARY KEY, value TEXT)');
function get(db, key, dflt) {
  ensure(db);
  const r = db.prepare('SELECT value FROM server_settings WHERE key=?').get(key);
  if (!r) return dflt;
  try { return JSON.parse(r.value); } catch { return dflt; }
}
function set(db, key, value) {
  ensure(db);
  db.prepare('INSERT INTO server_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
}
// events_off: the always-on events switched off (old setting); events: explicit on/off per id; events_on_at: when each was switched on.
const eventsOff = (db) => new Set(get(db, 'events_off', []));
function eventOn(db, id) {
  const m = get(db, 'events', {});
  if (id in m) return !!m[id];
  if (eventsOff(db).has(id)) return false;
  const e = EVENTS.find((x) => x.id === id);
  return !(e && e.limited);
}
const switchedOnAt = (db, id) => get(db, 'events_on_at', {})[id] || 0;
function setEvent(db, id, on) {
  const m = get(db, 'events', {});
  m[id] = !!on;
  const e = EVENTS.find((x) => x.id === id);
  // events that share one game screen (the festivals) are one at a time: switching one on switches the others off
  if (on && e && e.screen) for (const o of EVENTS) if (o !== e && o.screen === e.screen) m[o.id] = false;
  set(db, 'events', m);
  if (on) { const at = get(db, 'events_on_at', {}); at[id] = Math.floor(Date.now() / 1000); set(db, 'events_on_at', at); }
}
const news = (db) => get(db, 'news', DEFAULT_NEWS);
// Shown as the System note in the game's News screen (rl_r_msg Cmd 1802), dated when it was last changed. NOT the rl_r_bulletin popup:
// the client stores shown bulletin ids in ADMsg.xml and crashes (SaveLocalNotice, 'no node:bulletin') when a new id arrives.
const banner = (db) => get(db, 'banner', DEFAULT_BANNER);
const newsAt = (db) => get(db, 'news_at', Math.floor(started / 1000));
function setNews(db, text) { set(db, 'news', text); set(db, 'news_at', Math.floor(Date.now() / 1000)); }

// ---- live stats -------------------------------------------------------------------------------------------------------
const started = Date.now();
const seen = new Map(); // uid -> { at, cgi }
const hornPending = new Set(); // uids that logged in and still need the top banner once
const log = [];         // last 300 lines for the manager page
let requests = 0;
function hit(uid, cgi) {
  requests++;
  if (uid) seen.set(Number(uid), { at: Date.now(), cgi });
}
function addLog(kind, text) {
  log.push({ t: Date.now(), kind, text: String(text).replace(/\x1b\[[0-9;]*m/g, '').slice(0, 400) });
  if (log.length > 300) log.splice(0, log.length - 300);
}
const online = (ms = 5 * 60000) => [...seen.entries()].filter(([, v]) => Date.now() - v.at < ms).map(([uid, v]) => ({ uid, ...v }));

module.exports = { hornPending, EVENTS, DISCORD, DEFAULT_BANNER, banner, DEFAULT_NEWS, get, set, eventOn, eventsOff, setEvent, switchedOnAt, news, newsAt, setNews, started, hit, addLog, log, online, stats: () => ({ requests }) };
