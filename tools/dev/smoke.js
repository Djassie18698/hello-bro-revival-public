// Calls every handler with a fake player on a throwaway DB and reports crashes / non-XML replies.
// Usage: node tools/dev/smoke.js     (does not touch hellobro.db)
const os = require('os'), path = require('path'), fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const tmp = path.join(os.tmpdir(), 'hb-smoke-' + process.pid + '.db');
const db = new DatabaseSync(tmp);
require('../../schema')(db);
const handlers = require('../../handlers');
const base = { Uid: '77', Session: 'smoke', ServerID: '1', GroupID: '2' };
const cmds = { rl_r_mainpage: [1301], rl_r_shoplist: [1600, 1601], rl_w_recruit: [1900, 1901], rl_r_wheel: [1400, 1401], rl_w_wheel: [1400, 1401],
  rl_x_small_activity: [7, 8], rl_r_vipshop: [4000], rl_w_vipshopbuy: [4000], rl_r_activity: [9000], rl_x_mystery_shop: [1], rl_r_dailytask: [1] };
let bad = 0;
const run = (name, cmd, extra = {}) => {
  try {
    const out = handlers[name]({ db, params: { ...base, Cmd: cmd, SignId: 1, GiftId: 1, Goodsid: 1, Count: 1, Type: 2, ...extra }, host: 'localhost:18080', method: 'POST', body: '' });
    const s = typeof out === 'string' ? out : JSON.stringify(out);
    if (!/^<root|^<\?xml/.test(String(s).trim())) { bad++; console.log('NON-XML', name, cmd, String(s).slice(0, 80)); }
  } catch (e) { bad++; console.log('CRASH  ', name, cmd, e.message); }
};
run('rl_w_login2', 0); run('rl_w_reg2', 0, { Nick: 'Smoke', Card: 1 });
for (const name of Object.keys(handlers)) for (const c of (cmds[name] || [0])) run(name, c);
try { fs.rmSync(tmp, { force: true }); } catch {}
console.log(bad ? bad + ' problem(s)' : 'all ' + Object.keys(handlers).length + ' handlers OK');
process.exit(bad ? 1 : 0);
