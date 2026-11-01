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
  { id: 31, pos: 10, type: 1, icon: '🏁', name: 'Stage gift', desc: 'One-time gift for new players (home screen button).' },
];
const DEFAULT_NEWS = 'Welcome back to Hello Bro! Revival server.';

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
const eventsOff = (db) => new Set(get(db, 'events_off', []));
const eventOn = (db, id) => !eventsOff(db).has(id);
function setEvent(db, id, on) {
  const off = eventsOff(db);
  if (on) off.delete(id); else off.add(id);
  set(db, 'events_off', [...off]);
}
const news = (db) => get(db, 'news', DEFAULT_NEWS);
// Shown as the System note in the game's News screen (rl_r_msg Cmd 1802), dated when it was last changed. NOT the rl_r_bulletin popup:
// the client stores shown bulletin ids in ADMsg.xml and crashes (SaveLocalNotice, 'no node:bulletin') when a new id arrives.
const newsAt = (db) => get(db, 'news_at', Math.floor(started / 1000));
function setNews(db, text) { set(db, 'news', text); set(db, 'news_at', Math.floor(Date.now() / 1000)); }

// ---- live stats -------------------------------------------------------------------------------------------------------
const started = Date.now();
const seen = new Map(); // uid -> { at, cgi }
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

module.exports = { EVENTS, DEFAULT_NEWS, get, set, eventOn, eventsOff, setEvent, news, newsAt, setNews, started, hit, addLog, log, online, stats: () => ({ requests }) };
