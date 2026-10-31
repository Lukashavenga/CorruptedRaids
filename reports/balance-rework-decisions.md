# Balance rework: decisions

Decided 2026-10-31 by the streamer, working through the live balance log (280 fights, Oct 28-30), `Game balance and progression research.md` and the open tickets. Nothing here is built yet. Numbers marked *to measure* are starting values, and the studies decide the final ones.

## Difficulty

- Each dungeon has one grade, which sets its win chance *(to measure against real parties)*: easy 85%, medium 75%, hard 65%, extra hard 55%.
- Poors and Barbie are easy, Cops medium, Monks hard, Knights extra hard.
- Pay rises with grade: about x1, x1.25, x1.6, x2 *(to measure)*.
- The party's power still picks the level. Each level is tuned automatically to the dungeon's grade by the existing solver, run in the background on save, so difficulty stays measured (AGENTS.md section 6). The panel still flags a layout that cannot reach its target.
- The admin draws the layout and picks the grade. Per-level strength and tempo settings go away.
- One fixed headcount curve serves every dungeon, aiming for about the same win chance at any turnout. Today's curve fails this: Monks goes from 13% at 5 players to 100% at 16 or more.
- Fewer than 3 players get Level 1. There is no separate rule against solo farming, because Level 1 pays little. Check the log for it.

## Joining

- While people join, all of them stand full screen. The banner shows only the dungeon, its grade and a rising reward meter.
- No level or enemy squad appears until the party "goes into the dungeon", when both are revealed. A late joiner can never be seen making the fight harder.
- Turnout raises XP, gold and loot chance for each viewer: +10% at 5, +25% at 10, +50% at 20 *(to measure)*.
- The loot base is lowered so a party of 7 gets today's drop rate. The two loot settings fold into one.

## The first night

- New viewers stay naked and the starter kit stays in the bag, on purpose. Wanting to get dressed is the reason to visit the loadout. There is no automatic equipping or spending.
- Anyone under 50% of the party's power *(to measure)* fights at 50% for that fight only, shown as Rallied. Real stats and Corruption do not change.
- Players who die in a winning fight get 40% of survivor gold. A lost fight still pays no gold.
- The bot sends each viewer at most one prompt a night about what is waiting for them, with the link. Chests stay sealed until the viewer opens them.

## Levels and seasons

- A level starts at 3 runs and each costs 0.5 more, with no cap: level 50 at about 735 runs, 100 at about 2,720, 200 at about 10,450.
- 5 points a level, plus 5 at the start.
- Existing characters keep every point, and their level is set from their total points. A level 102 becomes about level 40, with identical power.
- Seasons run about 3 months and reset gear and gold. Levels, points and skills stay. The drop guarantees reset too.
- Skills are planned at levels 50, 75, 100, 145 and 200, with their design deferred. Titles come later.

## Loot

- One engine-rolled rarity table: 60/25/10/4/1 from common to legendary, shifting up with grade *(shift to measure)*. Admins list which items a place can drop, without weights.
- Item choice favours slots the viewer could improve, judged across all their saved builds and not by role, because viewers will hot-swap specs (#47). Lower-tier drops keep coming as material for scrap, transmog, merge and auction.
- Guarantees, counting every fight joined: a rare or better within 35 fights, a legendary within 400.
- The overlay announces the tier at once, and the item opens on the phone. A chest never holds less than its announced tier. Odds are published in How to Play.

## Economy

- Gear stat requirements are removed (#22). If you own it, you can wear it.
- Merge (#15) lands as already decided: 3 of one slot and rarity become 1 random item of the next rarity, stopping at epic.
- The auction house (#16) keeps its approved design and opens only after merge and the new loot have been measured.
- Everything sells for one rate: 20% of its rarity value, found or bought.
- The shop keeps 1-3 legendaries as season goals, at about 150-200 runs of pay.

## Stats and builds

- Four stats stay.
- Corruption values a role's two stats about equally, per spec. First measure that on-role builds really do win more.
- Skill caps are stretched so spending stays worthwhile well past level 50. Gear is not edited.
- The loadout marks each role's two stats with one line on why. There is no spend button.
- Per-role saved specs (#47) land.

## Audience

- The quiet combat log (#48) lands, with no added callouts.
- Dungeoneer of the day stays as most runs survived. Read the log to see whether one person always holds it.
- Raids switch on after the re-tune, with one grade per raid and tuning across the whole run.

## Build order

1. **Foundations:** the studies read live, `pull:content` brings the repo up to date, then #22, #47 and #48 land.
2. **First night:** Rally, fallen gold and the bot prompt.
3. **Power and difficulty:** role-valued Corruption and Skill caps, new level thresholds, grades with auto-tuning, the headcount curve, then the hidden level, full-screen muster and turnout pay.
4. **Loot and economy:** rarity table, slot favouring, guarantees and tier announcement, one sell rate, merge, shop prices.
5. **Levels and seasons:** new curve and points, character conversion, the season reset.
6. **Later:** raids, then the auction, skills and titles. Gloves (#20) wait for art.

## Rules this changes in AGENTS.md

- **Settled question 2:** dungeons gain a grade. It names how hard a place is and nobody selects it, so level stays the only axis picked by who turned up.
- **Settled question 3:** gear no longer gates on attributes, and levels will eventually grant skills as well as points.
- **The progression budget:** a linear curve to level 300 in a year gives way to a rising curve with seasons. The file calls a steep curve "poisonous" when a whole chat watches one bar. The early levels and the season reset are what answer that, and it needs watching.

## Things to watch

- Pay multipliers and turnout pay change XP per run, so the runs-per-level figures are for a typical fight, and real pace can be faster.
- Rally makes being naked less dangerous, so looks, gold and rank have to carry the reason to get dressed.
- Rally also makes parties a little stronger, so it has to be in place before auto-tuning is measured.
- The log is three days of alpha, and one character is in 235 of 280 fights. Read per-dungeon win rates as direction until each has about 30 fights per level.
