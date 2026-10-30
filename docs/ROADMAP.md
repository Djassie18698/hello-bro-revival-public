# Hello Bro revival: master plan ("glory days")

Goal: the game feels like 2015 again. Many players on one always-on server, live leaderboards, rotating events,
world boss, country war, guilds. Anyone can download it from a public GitHub page and join without Tailscale.

Status on 2026-10-30: 47 of 73 client endpoints handled (65 handlers in total). The core loop works:
login, team, gacha, shop, training, spar, arena, tower, guild, mora, money tree, evolve, reincarnate.

---------------------------------------------------------------------------------------------------
## Part A. Every endpoint (what is left)

Legend: [ ] not built, [~] stub or partial, [x] done. The letter in brackets is the milestone that builds it.

### A1. Not built at all (26)
| Endpoint | What it is in the game | Milestone |
|---|---|---|
| rl_r_countryranknew | Country ranking (Konoha / Suna / Kiri ...) | M3 leaderboards |
| rl_r_fwheel_rank, rl_w_wheel_gift | Wheel of Fortune ranking + ranking reward | M3 |
| rl_x_sport_ext, rl_w_sportpack | Arena exchange shop, daily arena rank rewards | M3 |
| rl_r_warmsgnew, rl_r_warresultnew, rl_w_warresultnew, rl_w_warnew, rl_w_countrynew | Country war (War building): sign-up, battles, results, rewards | M5 war |
| rl_r_tear, rl_w_tear, rl_r_tearcountry, rl_w_tearcountry, rl_w_tearguard | Plunder seals / "tear" country raids and guards | M5 |
| rl_w_markchip | Seal fragments merge (Plunder) | M4 |
| rl_r_adventure, rl_w_adventure | Awakening / adventure chapters (CRunLevelView) | M4 |
| rl_r_bagage, rl_r_ninjalist | Old-style full backpack / team reload | M4 |
| rl_r_readconf | Server config read on Top-up screen | M2 |
| rl_got | Generic "got item" ack | M2 |
| rl_r_newbie_pay, rl_r_ky_checkorder, rl_w_ky_payorder, rl_w_notify_gp | Real-money payment. Replace with FREE grants (no payments ever) | M2 |

### A2. Stubs or shallow (have a handler but are not the real thing)
- [~] rl_w_friend (add / delete / chat), rl_w_msg (mail actions): persist real friends + mail between players. M3
- [~] rl_r_frontiers_war_* (Boundary Monument / border war): timed event. M5
- [~] Slot machine (rl_r_comm 15/18, rl_w_comm 23-25): logic done, entry point not found in the client. M4
- [~] rl_r_comm 9 (inherit), 13 (consumption reward): stubs. M4
- [~] Tower sweep (rl_w_dup 3102) and reset; training boss stages. M4
- [~] Top-up package grid empty (rl_r_paypack Cmd 1 fields). M2
- [~] Guild shop items, guild admin actions (kick, promote, upgrade, settings), ninja/equip/ninjutsu donation. M3
- [~] World boss (fightBossView.lua, activity 12). M5
- [~] Event list: only login / level / month-sign / mora shown. Add the rest (activity_config.lua ids 1-46). M5

### A3. "Back in the day" systems that span many endpoints
1. **Leaderboards (M3)**: one ranking service in the server: level, power (team attack), arena rank, wheel score,
   mora luck, guild score, country score. Feeds rl_r_ninja_rank, rl_r_sportrank, rl_r_countryranknew,
   rl_r_fwheel_rank, guild ranking, mora ranking. Daily reset job pays rank rewards into the mailbox.
2. **Event calendar (M5)**: `events.json` with start/end times, so events rotate like the old server
   (double exp weekend, wheel week, mora week, god-card festival...). Admin page shows and edits it.
3. **World boss (M5)**: one shared boss HP for the whole server at fixed hours, damage ranking, rewards by rank.
4. **Country war (M5)**: three countries, sign-up, scheduled battle, results, rewards.
5. **Mail + horn chat (M3)**: system mails (rewards, notices), player-to-player mail, world "horn" message bar
   on the home screen.
6. **Daily reset (M2)**: one scheduler at 00:00 server time: daily tasks, free shakes, wheel, arena rewards, mora.

---------------------------------------------------------------------------------------------------
## Part B. Public release (download + updater + join without Tailscale)

### B1. What may and may not be public
- The game itself (APK, OBB, Lua scripts, art) belongs to the original publisher. A PUBLIC repo must NOT contain
  release/*.apk, the OBB, reference/lua-scripts or data/*.json exports. Instead the public package ships a
  **patcher**: the player supplies the original XAPK (still downloadable from APK mirror sites) and the patcher
  points it at our server. This is how most private-server revivals stay up.
- Never public: release/revival.keystore (our signing key), hellobro.db (player saves), backups/.
- Plan: keep this private repo as the workshop. Create a NEW public repo `hello-bro-revival-public` from a clean
  export (server code + patcher + docs), so no secret ever sits in its git history.

### B2. Joining without Tailscale (pick one, ranked)
1. **Small cloud server (recommended for "glory days")**: Oracle Cloud Always-Free or a ~5 EUR/month VPS.
   Runs 24/7 even when your PC is off, has a fixed public address, nobody sees your home IP.
2. **playit.gg TCP tunnel**: free, no router changes, gives a fixed address like `xxx.joinmc.link:12345`.
   Your PC must be on. Raw TCP, so the game's odd HTTP requests pass untouched.
3. **Router port-forward 18080 + DuckDNS**: free, but exposes your home IP and needs router access.
   (Cloudflare Tunnel is NOT suitable: its edge rejects the game's request lines with raw spaces.)

### B3. Before the server is public (security, M1)
- Login trusts any Uid + Session today: anyone could play as anyone. Bind each account to a device token on
  first login and reject mismatches.
- Admin page is open to everyone. Add a password (env ADMIN_PASSWORD) and an "everyone is admin" switch that is
  OFF on the public server (on for private play).
- Rate-limit requests per IP, cap body sizes, log errors to a file.

### B4. Updater
- **Server updates**: everyone plays on one server, so server fixes reach all players instantly.
- **Client (Lua/art) updates**: the game has its own hot-update. `rl_r_version` returns a CDN URL + file list;
  the client downloads changed files on start. We serve `/cdn/` from the server, so we can push Lua fixes and
  new translations to every player WITHOUT a new APK. (To investigate in M6: filelist format and checksum.)
- **APK updates** (rare): the launcher/patcher checks GitHub Releases for a newer patcher version.
- **Server operator updater**: `UPDATE-SERVER.bat` = git pull + restart, with a DB backup first.

---------------------------------------------------------------------------------------------------
## Part C. Milestones (in order)

| # | Milestone | Done when |
|---|---|---|
| M1 | Security for public play | DONE 2026-10-30: STRICT_SESSIONS=1 (only login may change a session; verified with the real client), ADMIN_PASSWORD (browser login), 300 req/10 s per IP, 64 KB body cap, logs/error.log. STILL OPEN: the Uin comes from the Gumptech SDK inside the APK and anyone who knows a uid can log in as it; real fix = patch the SDK login to use our own xk_w_login account + password (M1b, needed before a truly public server) |
| M2 | Economy and daily reset | free "top-up" grants replace payments; top-up grid; daily reset job; rl_got, rl_r_readconf |
| M3 | Social + leaderboards | ranking service + all rank endpoints; real friends, mail, horn chat; arena shop + rewards; guild shop/admin |
| M4 | Missing PvE | adventure/awakening, tower sweep/reset, training boss, plunder seals + markchip, slot entry, inherit |
| M5 | Live events | event calendar, world boss, country war, border war, tear raids |
| M6 | Hot-update CDN | push Lua/translation fixes through rl_r_version |
| M7 | Public release | clean public repo, patcher + one-click server setup, docs, hosting guide (VPS / playit.gg) |
| M8 | Polish | full regression sweep on a fresh account, balance pass, English text fixes |

Each milestone: build, test in the emulator (Claude Root), update docs/NEXT-STEPS.md, push to the private repo.
