# Hello Bro / Ninja Online revival server

A fan-made private server for the mobile game **Hello Bro** (Ninja Online, v28.0, 2015).
The original servers shut down years ago. This project lets you play the game again,
with friends, on a server you run yourself. Free, no payments, everyone can be admin.

**This repository contains no game files.** You need your own copy of the original
`Hello Bro v28.0` XAPK (package `com.hello.bro.yo`). The setup script reads the game data
from it and builds a copy of the app that connects to your server.

## What works
Login, team, backpack, gacha (single and 10x with card reveal), shop, VIP, training (all chapters),
spar, arena ladder, tower, Akatsuki guilds (create, join, hall, donate, rankings), Eight Gates,
sage growth, potential training, reincarnation, evolve (god cards), mora, money tree,
wheel of fortune (with ranking), month sign-in, daily tasks, events, friends, player-to-player mail,
world boss (shared daily boss with damage ranking), country war (officials/Hokage seats, live war between the
three countries, kill ticker, war exploit shop, individual and nation rankings), tower ranking, arena exchange shop, free top-up, admin page.
Game-side fixes are pushed to players automatically through the game's own updater (see docs/HOT-UPDATE.md).

plunder (steal tailed-beast seal fragments, combine and equip seals).

Not yet: border war, adventure. See the roadmap in `docs/ROADMAP.md`.

## Run your own server (Windows)
1. Install **Node.js 22 or newer** (https://nodejs.org) and **Python 3**, plus a **JDK** (for signing the app).
2. Download this repository (green "Code" button > Download ZIP) and unzip it.
3. Put your `HelloBro.xapk` in the folder and double-click **SETUP.bat**.
   Type the address players will use to reach your server (see "Letting others join").
4. Double-click **START-SERVER.bat** and leave the window open.
5. Admin page: http://localhost:18080/admin

## Letting others join (no Tailscale needed)
See `docs/HOSTING.md`. Short version:
- **playit.gg** (free, easiest, your PC must be on): gives a fixed public address. Use it in SETUP.bat.
- **A small cloud server** (Oracle Cloud free tier or a ~5 EUR/month VPS): online 24/7.
- **Port forwarding** on your router (port 18080) + a free DuckDNS name.

## Players: how to install
Install the `HelloBro-<address>.apk` the server owner gives you, and copy the OBB file
(`Android/obb/com.hello.bro.yo/main.28.com.hello.bro.yo.obb` from the same XAPK) to the same folder on your phone.
In BlueStacks, install the original XAPK once, then install the server's APK over it.

## Updating
- Server owners: double-click **UPDATE-SERVER.bat** (backs up the save, downloads the newest version, restarts).
- Players: nothing to do. Game fixes happen on the server.

## Legal
Fan project, not affiliated with the original developers. No game assets are distributed here.
Do not sell access. If the rights holder asks, this repository will be taken down.
