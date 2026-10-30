# Pushing client fixes without a new APK (hot update)

The game has its own resource updater. It is driven by `rl_r_version`:
`<updatechip><version val="X"/><cdn>http://host/cdn/</cdn><filelist><file name="X_update.zip" val="X" md5 size/></filelist></updatechip>`.

1. Put changed files in `cdn/src/` with the same paths as inside the OBB, e.g. `cdn/src/script/ui_layer/ui_purchaseLayer.lua`.
2. Run `python -I tools/build_cdn.py 28.0.4` (always a HIGHER version than the last one).
3. Restart not needed: the next game start shows "confirm update?", downloads, unzips to `files/renlong28/`, and the game loads those files first.

Rules learned the hard way: the zip name must start with the version followed by `_`; the zip needs explicit folder entries
and everything under `renlong28/` (build_cdn.py does both). `<updateversion>` is the separate APK updater and must stay at 0.0.1.

Shipped so far: 28.0.3 = ui_purchaseLayer.lua (top-up buttons call rl_x_free_topup instead of Google Play).
28.0.5 = adds config/activity_config.lua (activity id 47 = seven-day goals in the Event menu) and ui_sevenDayView.lua (day counter).
28.0.6 = changed pet unlock levels (withdrawn). 28.0.7 = ships the ORIGINAL ui_myBaseLayer.lua / ui_petPsychicLayer.lua so phones that got 28.0.6 are back to level 150 / original slots.
Note: mainActivity.lua is run by C++ straight from the OBB, so patching it does nothing; files loaded with `require` do pick up patches.
