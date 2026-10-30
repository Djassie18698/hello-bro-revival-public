// Calls every handler with a fake player on a throwaway DB and reports crashes / non-XML replies.
// It also tries every Cmd number the game's Lua scripts use for that endpoint (when reference/lua-scripts exists).
// Usage: node tools/dev/smoke.js     (does not touch hellobro.db)
const os = require('os'), path = require('path'), fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const tmp = path.join(os.tmpdir(), 'hb-smoke-' + process.pid + '.db');
const db = new DatabaseSync(tmp);
require('../../schema')(db);
const handlers = require('../../handlers');
const base = { Uid: '77', Session: 'smoke', ServerID: '1', GroupID: '2' };

// endpoint -> Set of Cmd numbers, scraped from GetUrlNormalHeader(uid, CMD, "endpoint") calls (CMD may be a protocol.lua constant).
const cmds = {};
const lua = path.join(__dirname, '..', '..', 'reference', 'lua-scripts');
if (fs.existsSync(lua)) {
  const consts = {};
  const proto = path.join(lua, 'util', 'protocol.lua');
  if (fs.existsSync(proto)) for (const m of fs.readFileSync(proto, 'utf8').matchAll(/^\s*([A-Za-z_0-9]+)\s*=\s*(\d+)/gm)) consts[m[1]] = Number(m[2]);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.lua') ? [path.join(d, e.name)] : []);
  const urlConst = {};
  for (const m of fs.readFileSync(proto, 'utf8').matchAll(/^\s*(URL_[A-Z_0-9]+)\s*=\s*"([a-z_0-9]+)"/gm)) urlConst[m[1]] = m[2];
  for (const f of walk(lua)) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/GetUrlNormalHeader\([^,]*,\s*([A-Za-z_.0-9]+)\s*,\s*("?)([A-Za-z_.0-9]+)\2\s*\)/g)) {
      const cmd = /^\d+$/.test(m[1]) ? Number(m[1]) : consts[m[1].replace(/^protocol\./, '')];
      const ep = m[2] ? m[3] : urlConst[m[3].replace(/^protocol\./, '')];
      if (ep && cmd !== undefined) (cmds[ep] = cmds[ep] || new Set()).add(cmd);
    }
  }
}
let bad = 0, calls = 0;
const run = (name, cmd, extra = {}) => {
  calls++;
  try {
    const out = handlers[name]({ db, params: { ...base, Cmd: cmd, SignId: 1, GiftId: 1, Goodsid: 1, Count: 1, Type: 2, ...extra }, host: 'localhost:18080', method: 'POST', body: '' });
    const s = typeof out === 'string' ? out : JSON.stringify(out);
    if (!/^<root|^<\?xml/.test(String(s).trim())) { bad++; console.log('NON-XML', name, cmd, String(s).slice(0, 80)); }
  } catch (e) { bad++; console.log('CRASH  ', name, cmd, e.message); }
};
run('rl_w_login2', 0); run('rl_w_reg2', 0, { Nick: 'Smoke', Card: 1 });
for (const name of Object.keys(handlers)) for (const c of new Set([0, ...(cmds[name] || [])])) run(name, c);
try { db.close(); fs.rmSync(tmp, { force: true }); } catch {}
console.log(bad ? bad + ' problem(s)' : `all ${Object.keys(handlers).length} handlers OK (${calls} calls)`);
process.exit(bad ? 1 : 0);
