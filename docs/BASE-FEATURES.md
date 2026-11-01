# Base buildings: what each one needs (original rules)

Everything here follows the original game: unlock levels, help texts and numbers come from the game's own
files (Lua screens, `localizable.lua`, and the data tables). Where the original server's numbers are lost, the
row says **(ours)**: that value is our best guess and can be changed.

## Unlock levels (unchanged from the original, `ui_myBaseLayer.lua`)

| Building | Opens at player level |
|---|---|
| Advance (gear) | 0 (always) |
| Breakthrough | 0 (always, but needs a god card) |
| Ninja Test | 45 |
| Pets ("telepathize beasts") | 150 |

## Ninja Test (`exam.js`, endpoint `rl_x_exam`)

Original help text: 15 rounds, cleared one by one; only 4 or 5-star ninjas; ninjas who fall can't come back.

| Needs | Where it comes from |
|---|---|
| 1 to 5 ninjas with 4 or 5 stars | your own cards |
| Tries | 3 a day **(ours)**; more cost 20 gold each **(ours)** |
| Chest on a cleared stage | free; every 5th stage has 3 chests, 2nd and 3rd cost 30 / 80 gold **(ours)** |
| Score (exchange points) | 10 x stage, +30 on stages 5/10/15 **(ours)** |
| Exchange shop prices | **(ours)**: silver, sage stones, pills, recruitment orders, grain, nostrum, 5-star gear, fragments of your own god card |

Resets every day: stage back to 1, tries back to 3, fallen ninjas back. Score is kept.

## Breakthrough (`tupo.js`, endpoint `rl_x_breakthrough`)

Original help text: only god cards; each level raises element restrain and ninjutsu trigger chance; the stats it
raises depend on the card's element (fire ATK + chakra, water chakra, wind DEF + chakra, earth DEF, thunder ATK).

| Needs | Where it comes from |
|---|---|
| A god card (6-star) | recruiting, events, or merging 50 of its fragments in the Backpack |
| That card's own fragments | mystery shop, Ninja Test exchange shop, event drops |
| Fragments per level | 5, 10, 15 ... (5 + 5 x level) **(ours)** |
| Silver per level | 50 000 x (level + 1) **(ours)** |
| Max level | 10 **(ours)** |
| Gain per level | +4% on the element's stats, +2% ninjutsu trigger, +1% restrain **(ours)** |

## Pets (`pet.js`, endpoint `rl_x_pet`)

Original help text: pets come from the mystery shop; the master pet (centre) casts its skill in battle and adds
stats, helpers only add stats; all pet stats are spread evenly over your ninjas; normal training gets more
expensive with each use and resets at midnight.

| Needs | Where it comes from |
|---|---|
| Player level 150 | to open the building |
| A pet | collect 30 of its fragments (mystery shop) and press Synthesis in Backpack > Fragments |
| Helper slots | open at player level 1 / 80 / 100 / 120 / 140 / 160 / 180 / 200 |
| Level up | grain (item 36): 20 to 70 per level (`petupgrade` table), max level 50 |
| Rank up | nostrum (item 37): 50 to 240 per rank, success 100% down to 10% (`petupgradeequ`), max rank 10 |
| Stars (training) | normal: 30 gold, +30 per use up to 150, 100 points; special: 100 gold, 150 points (`petinfo`); points per star from `petupgradestar`, max 10 stars |
| Stats | base + per-level growth from `petinfo`, rank bonus from `petupgradeequ`, star % from `petupgradestar` |

Grain and nostrum are sold in the mystery shop (5 or 10 at a time).

## Shared pieces these need

| Piece | Status |
|---|---|
| Mystery shop | sells the original mix again: ninjas, ninja fragments, pet fragments, grain, nostrum, sage stones, reincarnation pills (6 a day, weighted like the original table, each once a day) |
| Fragment merge (Backpack > Fragments > Synthesis, `rl_w_comm` Cmd 10) | works: 30 fragments make a ninja or pet, 50 make a god card |
| Fragments saved on the server | yes, shown in the Backpack after login |
| Item counts (grain/nostrum) in pet screens | refresh after opening the Shop once |

## Not original / still to check

- Every **(ours)** value above.
- Pet master skill in fights: the master pet is sent with each fight, but the skill's damage is only shown by the client.
- The 3-chest boss stages of the Ninja Test (5, 10, 15) have not been played in game yet.

- **Ninja Treasure (2 Nov 2026):** refresh 100 gold, board every 2 h, explore 35 / 70 / 300 / 320 / 1000 (original), 1000 after the 5th **(ours)**.
- **Arena daily reward (2 Nov 2026):** 26 000 - 1000 x rank silver for ranks 1-10 (original), then -60 a rank **(ours)**, at least 2000 (original); reputation = silver / 5 (original).
- **Treasure chests (2 Nov 2026):** prize lists original; weights, gold price without a key (50 / 20 / 5), 25 + 5 x VIP gold-chest opens a day and 8% key drops in story fights **(ours)**.
- **Eight Gates (2 Nov 2026):** 8 points a level, cost 80 x level souls + 15 x souls silver (original); bonus curve fitted to the photo totals **(ours)**, max level 150.
- **Daily task chests (2 Nov 2026):** 250 points, chests 30 / 60 / 90 **(ours)**, 120 / 160 / 210 / 250 (original); 250 chest original; other contents **(ours)**.
- **Shinobi training (2 Nov 2026):** 2 Super Ninja Pills or 1 pill + 10 gold (original); 10 times 20 pills or 10 + 80 gold **(ours)**.
- **Growth Fund (2 Nov 2026):** 500 gold, VIP3, 2500 back at Lv50 150 / 70 150 / 90 200 (original); Lv110 200, 130 250, 150 250, 170 300, 190 300, 210 350, 230 350 **(ours)**.
- **Save time (2 Nov 2026):** one Big Ramen = ceil(200 / stage energy) fights of the furthest story stage, rounded down to hundreds (fits the original photo exactly); VIP1 and level 80 (original); 2 chances a day per VIP level **(ours)**, then 10 gold (original).
- **Enemy strength (ours, 1 Nov 2026):** enemy team defence 285 at stage 1-2 (from the owner's video of the original) growing evenly to 2 500 000 at the last story stage; Battles use the same range over their 175 rounds; Ninja Test guards = stage value (1160 / 1950 / 2980 / 10 065 at stages 1 / 2 / 4 / 14, from photos) x min(1, (level/280)^2) (fits 5 photos; 2 Nov 2026), bosses +30% (ours).

## Recharge events (added 2 Nov 2026)
- Great gift for total recharge (`totalgift.js`): tiers, rewards and 48 h are ORIGINAL (photo 1238). (ours): which cards match the photo's faces (The Fourth Sage ATK, Hokage Kakashi (God), Kaguya (God)); the amount counted is the dollars of the top-up packages bought while it runs.
- Time limited GiftPack (`limited.js` DISCOUNT): $19 / $60 / 70 h and the four rewards are ORIGINAL (photo 2755). (ours): Gold Key as "the key", the golden Choji EXP card, the pack icons.
- Daily spending gift (`dailyevents.js`): all tiers and rewards (ours): 100 / 500 / 1000 / 2000 gold a day.
- Recharge streak (`dailyevents.js`): "$3 a day" is the screen's own text; the 7 daily gifts and the bonus (300 Reincarnation Pills + 200 Souls Dan) are (ours).

## Balancing from the photos (2 Nov 2026, later)
- Monthly sign-in (`signin.js`): days 1-16 and their VIP x2 marks are ORIGINAL (photos 0516, 1871). (ours): which cards (4-star pack days 4 / 9, 5-star pack day 12), days 17-28 = days 5-16 again with VIP marks +4 (at most v15).
- Top-up (`handlers.js` TOPUPS): ORIGINAL packages and the first-top-up x3. (ours): $49.99 = 2400 + 300.
- Akatsuki (`guild.js`): ORIGINAL max levels, the level-5 / level-9 costs and requirements, members 6 + level, donation amounts, mall prices and 30 min refresh. (ours): lower-level costs, +5% donation / +10% mission profit per building level, which item the 2100 + 900 / 3000 + 1800 / scroll goods are, 9 mall spots (last 3 at Mall Lv5), one buy per spot per refresh.
- Country war (`war.js`): ORIGINAL 10 points + 10 exploit + 36 EXP + 36 silver a win, 2 + 2 to the defender. (ours): nothing for a failed attacker.
- Spar (`game.sparFight`): ORIGINAL 15 / 5 W.A.; EXP = level + 4 / a third (ours, fitted to one photo); silver ours.
- Element Change (`game.elementChange`): ORIGINAL 12 pills + 2000 silver for a God card. (ours): 10 / 9 / 6 pills for 5 / 4 / 3-star cards.
- God evolve: ORIGINAL 100 Development Dan. Equipment advance: ORIGINAL 50 000 silver. Small EXP-card bags: ORIGINAL 2000 silver (armor / trinket / skill bags ours).

