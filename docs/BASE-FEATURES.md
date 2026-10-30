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
