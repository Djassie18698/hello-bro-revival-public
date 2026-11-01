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
28.0.8 = adds home/userguideConfig.xml with every tutorial level moved to 900+ (tutorial off; levels were 1,5,10,20,25,30,35,40).
28.0.9 = ui_purchaseLayer.lua also sets the VIP level from <viplevel> in the rl_x_free_topup reply.
Note: mainActivity.lua is run by C++ straight from the OBB, so patching it does nothing; files loaded with `require` do pick up patches.
28.0.10 = adds ui_layer/ui_sevenDayCell.lua with English texts for the 7-day goals (the game's own table is Thai).
28.0.11-13 = ui_layer/ui_gameSettingLayer.lua: the hidden "switch account" row in Settings is now a "Join Discord" button (openHyperlink to https://discord.gg/2Cbp4UDHrU). Lua button titles: setTitleForState with a Lua string does nothing and with CCString errors here; set getTitleLabel() (CCLabelTTF) instead.
28.0.14-15 = ui_layer/ui_festivalLayer.lua: the festival item icons load their own sprite sheet (props/<icon>.plist) inside pcall (spriteFrameByName on an unloaded frame and GetConsumeIcon both failed and stopped the trade list).
28.0.16 = config/activity_config.lua: event 27 (limited discount) opens business_proxy/limitDiscount_business in the Event menu (its name was a home-button script call -> empty page).
28.0.17 = sub_ui/TeamNinjaView.ccbi (team screen card): label_ninjaname font 24 -> 18, width 28% (= the orange name bar) so long names wrap to 2 lines, centred. Made with `tools/ccbi.py` (reads/patches .ccbi files; `python -I tools/ccbi.py dump <file> [name]`).
28.0.18 = story-stage "So lucky !" pop-up: the button picture (dropbox_04 in ccbResources/runlevel_drop.pvr.ccz) says "Proceed" instead of "Fold", and dlg_ui/RunLevelDrop.ccbi shrinks the game's own tiny title (size 12 -> 1) that was drawn over it. Made by `python tools/patch_runlevel_drop.py`. Sprite sheets are encrypted ('CCZp'): `tools/pvrccz.py` decodes/encodes them with the key from libgame.so.
28.0.19 = reverts 28.0.18: ships the ORIGINAL runlevel_drop.pvr.ccz and RunLevelDrop.ccbi (the re-encoded sprite sheet drew a dark purple box instead of "So lucky"). Owner: keep the Fold button.
