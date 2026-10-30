# Letting other people join your server

The game app has the server address built in. You choose the address once in SETUP.bat,
then give players the APK it makes. Pick ONE of these options.

## Option 1: playit.gg (free, easiest)
Your PC must be on while people play.
1. Make a free account at https://playit.gg and install the playit program on the PC that runs the server.
2. In the playit dashboard: Add tunnel > type **TCP**, local port **18080**.
3. playit shows an address like `something.joinmc.link:12345`. That is your public address.
4. Run SETUP.bat and enter exactly that address (with the port).
Use TCP, not an "HTTP" tunnel: the game sends slightly unusual web requests that HTTP proxies reject.

## Option 2: a small cloud server (always online)
Best for a real community. Oracle Cloud "Always Free" or any Linux VPS (about 5 EUR a month).
1. Install Node.js 22+ and git on the server, then `git clone` this repository.
2. Copy the `data/` folder made by SETUP.bat on your PC to the server (the game data stays private to you).
3. Open port 18080 in the cloud firewall.
4. Start it: `STRICT_SESSIONS=1 ADMIN_PASSWORD=choose-one node server.js` (use a service like pm2 or systemd to keep it running).
5. On your PC run SETUP.bat with the server's public IP, e.g. `203.0.113.10:18080`.

## Option 3: port forwarding at home
1. In your router, forward TCP port 18080 to your PC's local IP.
2. Get a free name at https://www.duckdns.org so the address survives IP changes.
3. Run SETUP.bat with `yourname.duckdns.org:18080`.
This shows your home IP to players. Only do it for people you trust.

## Settings for a public server
| Setting | What it does |
|---|---|
| `ADMIN_PASSWORD=...` | Admin page asks for this password. Without it, anyone can open the admin page. |
| `STRICT_SESSIONS=1` | Refuses requests that do not carry the player's latest login session. |
| `RATE_LIMIT=300` | Max requests per IP per 10 seconds. |
| `PORT=18080` | Port to listen on. |

Set them in START-SERVER.bat (lines starting with `set`).
