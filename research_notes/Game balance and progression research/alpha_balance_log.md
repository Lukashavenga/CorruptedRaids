# What the Corrupted Raids alpha balance log actually shows (Supabase, read-only, pulled 2026-10-29)

Method: read-only SELECT aggregates against Supabase project `beuxmpnsuhxhwhfckuax`, tables `public.fights`, `public.fight_members`, `public.economy_events`, plus `public.characters` (roster) and `public.content_files` (the live content store the game plays). No rows were dumped; viewers are anonymised. Source links below use `supabase://<table>` to mean "aggregate query on that table". The data is still being written (two consumable purchases arrived between two queries), so counts are a snapshot as of ~10:50 UTC 2026-10-29.

`npm run report:balance` was run: with no `.env` it falls back to the local file log (`data/logs`) and reports "0 fights, 0 member rows, 0 economy events. Nothing to report." So everything here comes from SQL — [scripts/report-balance.ts run](file:///home/user/CorruptedRaids/scripts/report-balance.ts).

**Headline sample-size warning:** 45 fights, 29 distinct viewers, 2 sessions. 7-11 fights per dungeon, 1-8 per dungeon×level cell. No cell is big enough to call a win rate against its target with confidence; the aggregate patterns (which levels are fielded, role shares, loot rate vs knobs, economy flows) are more trustworthy than per-dungeon win rates.

## 1. Volume: fights, runs, nights, sources, places, party sizes

### Takeaway
Everything in the log is `live`: 45 dungeon fights (45 runs, one fight each), 317 member rows, 29 viewers, over two sessions on 2026-10-28 and 2026-10-29. No `sim` or `sandbox` rows exist, and no raid fights (both raids are `enabled: false`). Median party is 7.

### Cited Findings
- Sources: `fights` has only `source='live'`: 45 fights, 45 distinct `run_id`s, first 2026-10-28 12:28 UTC, last 2026-10-29 10:46 UTC, 2 calendar days. `fight_members`: 317 rows, 29 distinct characters. `economy_events`: 288 rows (live), 29 characters. Zero `sim` / `sandbox` rows in any table — [supabase://fights, fight_members, economy_events](supabase://beuxmpnsuhxhwhfckuax/public.fights)
- Sessions (UTC): 2026-10-28 ~12:28-15:10 = 27 fights; 2026-10-29 ~09:00-10:46 = 18 fights. Busiest hour: 20 fights in one hour on 10-28 (avg party 9.1) — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights)
- No raid fights: `kind` is `dungeon` for all 45; both raids in the store are `enabled: false` (alpha-raid, the-long-road, last edited 2026-10-07) — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights); [supabase://content_files raids/*](supabase://beuxmpnsuhxhwhfckuax/public.content_files)
- Fights per dungeon: barbie 9, cops 7, lady-of-knight 11, monks 11, poors 7 — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights)
- Party-size distribution (headcount: fights): 1:3, 2:3, 3:1, 4:1, 5:6, 6:4, 7:7, 8:5, 9:5, 10:2, 11:6, 13:1, 14:1. Mean 7.0, max 14. 8 of 45 fights (18%) had 4 or fewer — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights)
- Participation is spread but skewed: 9 viewers played 1-5 fights (avg 2.3), 7 played 6-10, 4 played 11-15, 2 played 16-20, 6 played 21-30, 1 played 38 of 45. Top 3 viewers = 28% of all member rows — [supabase://fight_members](supabase://beuxmpnsuhxhwhfckuax/public.fight_members)
- Per viewer per day: 10-28: 23 viewers, 9.8 runs each on average; 10-29: 16 viewers, 5.7 runs each — [supabase://fight_members](supabase://beuxmpnsuhxhwhfckuax/public.fight_members)
- Content fingerprint: one balance hash (`…0250ea804680cc`) across all 45 fights, i.e. no balance.json change during the logged window; one fight hash per dungeon except barbie, which has two (7 fights under the first, 2 under a second first seen on 10-29), consistent with the store's barbie edit at 2026-10-28 12:36 being picked up at a restart — [supabase://fights.fingerprint](supabase://beuxmpnsuhxhwhfckuax/public.fights); [supabase://content_files](supabase://beuxmpnsuhxhwhfckuax/public.content_files)

### Inferences
- "Live" here means the alpha tester group, not a public audience: 29 viewers, many with levels 30-74 that predate the log (see §5). Treat this as a playtest, not as representative stream behaviour.
- The live store's balance was last edited 2026-10-28 10:06 UTC, two hours before the first logged fight, so the whole log was played under one balance.

### Gaps
- No sim/sandbox data exists to compare with live; the simulator's predictions would have to be run fresh against the same fingerprints.
- No raid data at all; nothing can be said about raid rooms, boons or the boss.
- No `events` jsonb was kept (`rawEventsOneIn` default 0; 0 of 45 fights have events), so per-tick behaviour can't be examined.

## 2. Win / wipe / timer rates by dungeon and level vs target

### Takeaway
Overall 32/45 wins (71%); 42 non-solo fights: 32/42 (76%). Defeats are mostly wipes (10) not timers (3). Poors (100%, target 80%) and cops (86%, target 62%) ran easier than target; monks (45%, target 50%) is closest and the only one losing most often by wipe. Every per-dungeon number has a 95% interval roughly ±25-35 points, so none is statistically off-target except possibly cops/poors on the easy side.

### Cited Findings
Targets are the store's `targetWinRate` (matches content/ on disk): barbie 0.61, cops 0.62, lady-of-knight 0.70, monks 0.50, poors 0.80 — [supabase://content_files dungeons/*](supabase://beuxmpnsuhxhwhfckuax/public.content_files)

Per dungeon (all levels) — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights):

| dungeon | n | wins | win% | target | wiped | timer |
|---|---|---|---|---|---|---|
| barbie | 9 | 6 | 67% | 61% | 1 | 2 |
| cops | 7 | 6 | 86% | 62% | 1 | 0 |
| lady-of-knight | 11 | 8 | 73% | 70% | 2 | 1 |
| monks | 11 | 5 | 45% | 50% | 6 | 0 |
| poors | 7 | 7 | 100% | 80% | 0 | 0 |
| **all** | 45 | 32 | 71% | — | 10 | 3 |

Per dungeon × level (n, wins, avg headcount, avg rating, enemy count, level stat_scale, party hp/atk scale) — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights):

| place | L | n | W | hc | rating | enemies | stat_scale | p.hp | p.atk | avg ticks |
|---|---|---|---|---|---|---|---|---|---|---|
| barbie | 2 | 1 | 0 (wipe) | 1 | 389 | 6 | 4.23 | 0.80 | 0.40 | 79 |
| barbie | 3 | 3 | 1 (2 timer) | 6.0 | 800 | 7 | 10.76 | 1.05 | 1.16 | 368 |
| barbie | 4 | 5 | 5 | 8.2 | 1023 | 7.2 | 15.64 | 1.16 | 1.44 | 153 |
| cops | 3 | 6 | 5 | 6.8 | 822 | 7 | 17.60 | 1.09 | 1.13 | 110 |
| cops | 4 | 1 | 1 | 9 | 976 | 7 | 22.27 | 1.20 | 1.55 | 123 |
| lady-of-knight | 3 | 8 | 7 | 7.8 | 824 | 5 | 4.85 | 1.14 | 1.36 | 284 |
| lady-of-knight | 4 | 3 | 1 (1 timer) | 8.0 | 979 | 5 | 5.34 | 1.15 | 1.29 | 272 |
| monks | 2 | 2 | 0 (wipes) | 1 | 290 | 3 | 7.85 | 0.80 | 0.40 | 23 |
| monks | 3 | 5 | 3 | 7.8 | 816 | 5 | 20.49 | 1.14 | 1.39 | 143 |
| monks | 4 | 4 | 2 | 8.5 | 1068 | 5 | 25.02 | 1.18 | 1.48 | 237 |
| poors | 3 | 5 | 5 | 6.2 | 735 | 7.8 | 69.80 | 1.06 | 1.13 | 209 |
| poors | 4 | 2 | 2 | 7.5 | 1020 | 8.5 | 88.52 | 1.13 | 1.33 | 226 |

- By level across dungeons: L2 0/3 (all solos), L3 21/27 (78%), L4 11/15 (73%). Levels 1, 5 and 6 were never fielded — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights)
- Timers: 3 fights hit the 400-tick ceiling (2 barbie L3, 1 lady-of-knight L4). Wipes end early: avg 112 ticks. Wins average 210 ticks; overall fights use 50% of the ceiling on average — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights)
- barbie L3 averaged 368 of 400 ticks across its 3 fights — the slowest cell — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights)

### Inferences
- With n=7, 7/7 wins has a 95% Wilson interval of roughly 65-100%, and 6/7 roughly 49-97%; with n=11, 5/11 is roughly 21-72%. Poors and cops look easier than target but cannot be called mistuned on this sample; monks and lady-of-knight are consistent with target.
- The solver's targets were set against a reference party (`bandParty`) at each level; real parties are judged by what band their rating falls in, so these per-cell rates mix very different parties. Comparing them to targets only means something once a cell has ~30+ fights.
- barbie L3's timeouts (2 of 3) are the one concrete "timer" signal: the fight is long rather than deadly. With n=3 it is a lead, not a finding.

### Gaps
- No simulated reading next to each cell under the same fingerprint (report:balance would add this but cannot reach the store without a service key).

## 3. Levels, thresholds, rating, headcount and late joiners

### Takeaway
Every multi-player fight landed on Level 3 or 4; ratings ranged 489-1179, so the live tester pool lives in a ~700-point slice of a ladder whose thresholds run 0-2960. 16 of 42 multi-player fights (38%) rated within 60 points of the 940 Level-3/4 line, so a single join or leave could plausibly have flipped the level in a third of fights. Bigger parties rated higher and won more; small (≤4) parties lost most of their fights.

### Cited Findings
- Thresholds in the engine: weak 0, seasoned 110, elite 430, brutal 940, infernal 1640, apocalyptic 2960 — [AGENTS.md §5 Thresholds](file:///home/user/CorruptedRaids/AGENTS.md)
- Live party_rating range: min 190 (a solo), multi-player min 489, max 1179. L3 fights: avg rating 735-824 by dungeon; L4: 976-1068 — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights)
- Near the 940 line: 9 of 27 L3 fights rated 880-939; 7 of 15 L4 fights rated 940-1000. Only 1 L3 fight was within 60 of the 430 floor — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights)
- Solo fights: 3 (headcount 1, single tank, no healer), all Level 2, all wiped; ratings 190-389 against party scale hp 0.8 / atk 0.4 — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights)
- Correlations over 45 fights (Pearson): headcount↔rating 0.55; headcount↔level 0.43; headcount↔win 0.42; party-atk-scale↔win 0.43; rating↔win 0.29; level↔win 0.21 — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights)
- Win by size: ≤4 heads 3/8 (38%); 5-9 heads 21/27 (78%); ≥10 heads 8/10 (80%) — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights)
- Average headcount of L4 fights 8.2 vs L3 7.1 — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights)
- Composition: fights with ≥1 tank and ≥1 healer won 27/34 (79%); fights with no healer won 3/9 (33%, includes the 3 solos); wiped fights averaged 0.8 healers and 1.5 tanks vs 1.6 healers and 2.5 tanks in wins — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights)

### Inferences
- Rating is a mean, so headcount should not raise it directly; the positive headcount↔rating correlation is most plausibly the composition factor (small parties lack a healer/tank and are multiplied toward 0.56) plus the strongest testers being present in the big sessions. This is a confound: "big parties win more" is partly "parties with healers win more" and partly "the high-level testers were there".
- The win-rate rise with headcount despite partyScaling (enemy atk +65% per doubling) suggests that, at these sizes (5-14), the extra bodies and role coverage outweigh the enemy scaling. Small parties are the losing case, opposite to the old "big crowd is a free loss" problem.
- Levels 1, 2, 5, 6 are effectively untested live. Anything said about them must come from the simulator.

### Gaps
- Late joiners: the log stores only the FINAL level, rating and headcount at fight start; there is no record of the level during the gathering window or of join order. Whether a late joiner pushed a level up cannot be measured from this schema. The only indirect evidence is the 38% of fights sitting within ±60 of the 940 line and L4 parties being ~1 head larger. Recording `level_at_first_join` (or the level history during gathering) would answer it.

## 4. Roles: deaths, damage, heals, threat, point allocation

### Takeaway
DPS die at more than twice the rate of tanks and healers (45% vs 21%/18%), matching the documented "DPS take close to full damage" trade. Tanks absorb two thirds of all hits. The surprise is healers: 5 high-level healer characters dealt 34% of all damage (more per head than DPS) and put more points into Attack than any other stat. Tanks are over-represented (33% of slots vs ideal 17%) and DPS under (46% vs 67%).

### Cited Findings
Per role over 317 live member rows — [supabase://fight_members](supabase://beuxmpnsuhxhwhfckuax/public.fight_members):

| | DPS | Healer | Tank | All |
|---|---|---|---|---|
| member rows | 147 (46%) | 66 (21%) | 104 (33%) | 317 |
| distinct characters | 19 | 5 | 8 | 29 |
| avg char level | 33.9 | 62.1 | 29.5 | 38.3 |
| avg Corruption | 957 | 1457 | 643 | 958 |
| death rate (all fights) | 44.9% | 18.2% | 21.2% | 31.5% |
| death rate (wins only) | 34.4% | 8.0% | 7.4% | 20.6% |
| damage dealt share | 57.1% (93.7k) | 33.6% (55.1k) | 9.3% (15.3k) | 164.1k |
| damage per member-fight | 637 | 835 | 147 | |
| hits taken share | 18.5% | 15.3% | 66.2% | 1,942 |
| damage taken share | 40.3% | 18.4% | 41.3% | 19.2k |
| heals given | 0 | 16.2k (100%) | 0 | |
| heals received share | 25.6% | 15.2% | 59.2% | 16.2k |
| taunts | — | — | 463 (4.5 per tank-fight) | |

- Ideal shares in the composition model: tank 1/6, healer 1/6, dps 4/6 — [AGENTS.md §5 Composition](file:///home/user/CorruptedRaids/AGENTS.md)
- Design: Tank HP+Skill, Healer Skill+Speed, DPS Attack+Speed — [AGENTS.md §2.6](file:///home/user/CorruptedRaids/AGENTS.md)
- Average allocated points per member row (hp / atk / spd / skill), weighted by fight appearances — [supabase://fight_members.allocated](supabase://beuxmpnsuhxhwhfckuax/public.fight_members):
  - DPS: 9.0 / 27.9 / 20.5 / 5.0 → 78% in Atk+Spd (on design)
  - Healer: 21.1 / 39.9 / 23.1 / 37.8 → 50% in Skill+Spd, 33% in Attack (Attack is the single largest)
  - Tank: 18.5 / 15.4 / 8.4 / 12.2 → 56% in HP+Skill, 28% in Attack
- Final stats (after gear) averages: DPS hp 37.8 / atk 35.8 / spd 24.9 / skill 13.3; healer 65.5 / 47.9 / 26.0 / 50.6; tank 66.2 / 20.8 / 11.0 / 25.9 — [supabase://fight_members.stats](supabase://beuxmpnsuhxhwhfckuax/public.fight_members)
- Unspent points: average allocated total is 0.67 of 2×level, and 13 of 29 viewers have fewer than 2×(level-1) points allocated at their highest logged level — [supabase://fight_members](supabase://beuxmpnsuhxhwhfckuax/public.fight_members)
- The most-bought item, Shardspire Staff (legendary mainHand, 6 purchases by 6 viewers at 2,574g), has NO attribute requirement and gives atk 10 / spd 3 / skill 12 — [content/gear/shardspire-staff.json](file:///home/user/CorruptedRaids/content/gear/shardspire-staff.json); [supabase://economy_events](supabase://beuxmpnsuhxhwhfckuax/public.economy_events)
- The healing-by-urgency change (2026-10-28) predicted DPS deaths ~37% and heals-to-DPS 54% in sim at L10 typical; live shows DPS deaths 45% and only 26% of heals going to DPS (59% to tanks) — [AGENTS.md §4 Healers heal by urgency](file:///home/user/CorruptedRaids/AGENTS.md); [supabase://fight_members](supabase://beuxmpnsuhxhwhfckuax/public.fight_members)

### Inferences
- Healer damage share is driven by 5 characters averaging level 62 and Corruption 1457 (vs DPS 957), so "healers out-damage DPS" is partly "the veterans picked healer". Per Corruption point, DPS still deal slightly more (0.67 vs 0.57 dmg per Corruption). Still, an Attack-heavy healer build being the strongest damage dealer is off-design and worth watching.
- Heals going 59% to tanks while tanks take 66% of hits is consistent with urgency healing (tanks are the ones getting hurt). The live DPS share of heals is lower than the sim's 54%, but the sim used 2/2/8 parties while live parties are tank-heavy (avg ~2.4 tanks, ~1.5 healers, ~3.3 DPS per fight), so this is not a like-for-like contradiction.
- Many unspent points suggests the allocate flow is not obvious, or players do not care; it also deflates live ratings relative to the reference party.

### Gaps
- Whether the allocation rule counts starting points: I compared against 2×level without knowing the engine's exact starting-points rule; treat the 0.67 ratio as indicative.
- Hit attribution (threat-picked vs focus-break) is not logged — [AGENTS.md §3 The balance log](file:///home/user/CorruptedRaids/AGENTS.md)

## 5. XP and character levels

### Takeaway
A viewer earns ~110 XP per run (52-172 by dungeon) and gained 3.4 levels in the ~3-hour first session (9.8 runs) and 2.2 on the second (5.7 runs) — about 0.35-0.38 levels per run at levels ~30-40. Most logged characters were already high-level (median entry level in the 10-40 range, three above 60) before the log began, so the log does not show early-game pacing.

### Cited Findings
- XP per member-fight: overall avg 110; by dungeon barbie 77, cops 172, lady-of-knight 171, monks 61, poors 52; survivors of wins: barbie 101, cops 198, lady-of-knight 233, monks 133, poors 59 — [supabase://fight_members](supabase://beuxmpnsuhxhwhfckuax/public.fight_members)
- By role, avg XP per fight: DPS 106, healer 106, tank 118 — [supabase://fight_members](supabase://beuxmpnsuhxhwhfckuax/public.fight_members)
- Total XP earned in the log: 34,908 over 317 member-fights; 113 `level_up` economy events across 28 characters — [supabase://fight_members](supabase://beuxmpnsuhxhwhfckuax/public.fight_members); [supabase://economy_events](supabase://beuxmpnsuhxhwhfckuax/public.economy_events)
- Level-ups per viewer per day: 10-28 avg 3.39 (max 9), 10-29 avg 2.19 (max 9). Level span per viewer across the log: avg 3.6 levels, max 11 — [supabase://fight_members.level_ups](supabase://beuxmpnsuhxhwhfckuax/public.fight_members)
- Level at first logged fight (29 viewers): 9 at 1-10, 8 at 11-20, 4 at 21-30, 3 at 31-40, 1 at 51-60, 3 at 61-70, 1 at 71-80 — [supabase://fight_members](supabase://beuxmpnsuhxhwhfckuax/public.fight_members)
- Roster (`characters`, 85 rows): levels 1-9: 57 (21 of them `sim:` ids); 10-19: 14 (4 sim); 22-29: 3; 33-39: 5; 44: 1; 63-69: 3; 73-74: 2 — [supabase://characters](supabase://beuxmpnsuhxhwhfckuax/public.characters)
- Design budget: XP curve 40 + 10×level, level 300 in ~2,920 runs — [AGENTS.md §2 progression budget](file:///home/user/CorruptedRaids/AGENTS.md)

### Inferences
- At level 35 the curve asks 390 XP per level; at ~110 XP/run that is ~3.5 runs/level, consistent with the observed ~0.35 levels/run. The log fits the formula; it says nothing new about whether 300 takes a year, because the characters reached 30-74 off-log (earlier alpha days, grants, or play before the log existed — the roster has rows updated from 2026-10-26).
- XP per run varies 3x by dungeon (poors 52 vs cops/lady 172); poors, the "starter", pays the least even to high-level parties at L3-4.

### Gaps
- How the level-60+ characters got there is not in the log (no fights before 2026-10-28 12:28). Could be operator `grant_*` commands or pre-log play; not determinable here.

## 6. Loot, gold and the economy

### Takeaway
Drops run at 0.29 per viewer per run (2.9 per viewer on the 9.8-run first day), roughly 2-3x the 0.08-0.15 the docs describe, because the live store's loot chances are 0.7088 / 0.1418 / 0.0709 — about 1.9x the 0.375 / 0.075 / 0.0375 the balance.json comment records. The observed survivor drop rate (0.42) matches 0.7088 × mobDropChance 0.6 = 0.425 exactly. Gold is now a real resource only because the shop has 2,500-8,700g overrides: viewers earned ~36.7k in fights and spent ~22.4k, 69% of it on six copies of one ungated legendary staff.

### Cited Findings
- Live loot knobs (store): survivorLootChance 0.7088, casualtyLootChance 0.1418, defeatLootChance 0.0709, mobDropChance 0.6; the balance.json `_comment` still describes 0.375 / 0.075 / 0.0375 after a 2026-10-27 raise, and AGENTS.md §4 still says 0.25 with 0.08-0.15 drops/viewer/run. content/balance.json on disk matches the store — [supabase://content_files balance.json](supabase://beuxmpnsuhxhwhfckuax/public.content_files); [content/balance.json](file:///home/user/CorruptedRaids/content/balance.json); [AGENTS.md §4](file:///home/user/CorruptedRaids/AGENTS.md)
- Drops: 93 items in 317 member-fights = 0.29/viewer/run. By outcome: survived a win 85/201 = 0.42; died in a win 7/52 = 0.13; lost 1/48 = 0.02 (order survived > died-in-win > lost holds) — [supabase://fight_members.loot](supabase://beuxmpnsuhxhwhfckuax/public.fight_members)
- Drops per viewer per run by dungeon: barbie 0.33, cops 0.36, lady-of-knight 0.33, monks 0.16, poors 0.33 — [supabase://fight_members.loot](supabase://beuxmpnsuhxhwhfckuax/public.fight_members)
- Drops per viewer per day: 10-28 2.87 (9.8 runs); 10-29 1.69 (5.7 runs) — [supabase://fight_members](supabase://beuxmpnsuhxhwhfckuax/public.fight_members)
- Fight-drop rarity mix (93): common 26 (28%), uncommon 26 (28%), rare 31 (33%), epic 10 (11%), legendary 0 — [supabase://fight_members.loot](supabase://beuxmpnsuhxhwhfckuax/public.fight_members)
- Chest openings (`open_chest`, all gear_source loot): 89 — common 22, uncommon 25, rare 23, epic 19 — [supabase://economy_events](supabase://beuxmpnsuhxhwhfckuax/public.economy_events)
- Gold from fights: 36,703 total, avg 116 per member-fight (DPS 104, healer 116, tank 133); by dungeon avg barbie 84, cops 174, lady-of-knight 194, monks 44, poors 66 — [supabase://fight_members.gold](supabase://beuxmpnsuhxhwhfckuax/public.fight_members)
- Spending (economy_events, live, snapshot): buy_gear 10 purchases = 16,006g (shardspire-staff ×6 by 6 different viewers at 2,574g = 15,444g; plated-greaves ×1 at 452g; 2 uncommon at 45g; 1 common at 20g); buy_consumable 15 = 6,360g (17 by a later query; cheapest 70g). Total spent ≈ 22,366g = 61% of fight gold — [supabase://economy_events](supabase://beuxmpnsuhxhwhfckuax/public.economy_events)
- Recycling: loot-sourced 57 items → 536g total (common 16 → 32g, uncommon 16 → 64g, rare 14 → 154g, epic 11 → 286g; i.e. 2/4/11/26g each = 10% of value); shop-sourced 4 items → 220g (full refund of value) — [supabase://economy_events](supabase://beuxmpnsuhxhwhfckuax/public.economy_events)
- Level-up events 113 across 28 characters — [supabase://economy_events](supabase://beuxmpnsuhxhwhfckuax/public.economy_events)
- Shop price overrides in shop.json: straw-hat 8,741, shinobi-wrap 8,745, lion-heater 6,600, bounty-hunter-helm 4,200, frost-sceptre 3,210, shardspire-staff 2,574, plated-greaves 452, pitch-torch 75; only the staff and greaves have been bought — [content/shop.json](file:///home/user/CorruptedRaids/content/shop.json); [supabase://economy_events](supabase://beuxmpnsuhxhwhfckuax/public.economy_events)
- Gold held (roster): level 22-39 characters average ~2,400-2,800g (max 5,628); level 1-9 average 175g — [supabase://characters](supabase://beuxmpnsuhxhwhfckuax/public.characters)

### Inferences
- The "about one item a night" target set on 2026-10-26 is not what is live: the store's knobs are ~2.8x that day's 0.25 survivor chance. Either the Loot tab dial was moved up again on 2026-10-28 (balance.json updated 10:06 UTC that day) without the comment and AGENTS.md being updated, or it is intentional for alpha. The code comment and AGENTS.md are stale either way.
- "The starter dungeon drops only greys" (AGENTS §10) does not show up live: poors' 15 drops were part of a mix that is 72% uncommon-or-better overall. But live parties fight poors at L3-4, not L1, so this does not test the L1 finding.
- Monks gives roughly half the drops, a third of the gold and a third of the XP of the other dungeons per viewer-run because it is the one players lose (45% win). Losing is costly in rewards, as designed (defeat 0.15 XP, no gold).
- Gold has a sink now, but it is one item: 69% of all spending is the same ungated legendary staff. With no `requires`, it is the obvious buy for any role, which may also feed the attack-heavy healer finding. The 4,200-8,745 overrides have bought nothing yet (they are 15-75 runs of gold at ~116g/run).
- Loot recycling is near worthless (10% of value: a rare is 11g), so drops are worn or binned; 57 of ~93 fight drops + 89 chests were recycled — a lot of loot is unwanted.

### Gaps
- Gold spent per night and per viewer distribution (beyond totals) not computed; a few big spenders could dominate.
- Chests opened (89) vs chests dropped is not reconcilable from the schema (fight `loot` lists gearId/rarity; whether a drop is a chest or a direct item is not tagged).

## 7. Surprises and data-quality notes

### Takeaway
The biggest surprises: live loot knobs ~1.9x what the docs say; no level outside 3-4 is being played by groups; healers are the veterans and out-damage DPS per head; tanks are double their ideal share; and 25 `sim:` characters sit in the production roster even though no sim fights are logged.

### Cited Findings
- 25 of 85 roster rows in `public.characters` have `sim:` ids (21 at levels 1-9, 4 at 10-19). AGENTS.md says `ROSTER_STORE=file` exists so a sim party does not land "beside real viewers" — [supabase://characters](supabase://beuxmpnsuhxhwhfckuax/public.characters); [AGENTS.md §3 Content is data](file:///home/user/CorruptedRaids/AGENTS.md)
- Zero sim/sandbox fights in the log even though sim characters exist in the roster — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights)
- Live loot chances 0.7088 / 0.1418 / 0.0709 vs documented 0.375 / 0.075 / 0.0375 (comment) and 0.25 / 0.05 / 0.025 (AGENTS §4) — [supabase://content_files balance.json](supabase://beuxmpnsuhxhwhfckuax/public.content_files)
- Every multi-player fight: Level 3 or 4 (ratings 489-1179). Solo players: Level 2, 0/3 wins — [supabase://fights](supabase://beuxmpnsuhxhwhfckuax/public.fights)
- Tank share of slots 33% vs ideal 17%; healers 21% (5 characters); DPS 46% vs ideal 67% — [supabase://fight_members](supabase://beuxmpnsuhxhwhfckuax/public.fight_members)
- Level stat_scale varies enormously by dungeon at the same level: L3 lady-of-knight 4.85x vs poors 69.8x, because each dungeon's base stat block differs; the poors' store bandStatScale runs 4.8 (weak) to 192 (apocalyptic) — [supabase://content_files dungeons/*](supabase://beuxmpnsuhxhwhfckuax/public.content_files)
- The store's bandStatScale for brutal and infernal are identical in barbie (33.477), cops (44.026) and lady-of-knight (8.544) — [supabase://content_files dungeons/*](supabase://beuxmpnsuhxhwhfckuax/public.content_files)

### Inferences
- Identical brutal/infernal multipliers look like the solver's ratchet holding infernal at brutal's value (a band may not solve below the one under it); harmless live because nobody reaches L5, but it means L5 in those dungeons only gets harder through body count.
- Sim characters in the live roster suggest a `sim_join` was run against a server without `ROSTER_STORE=file` at some point (or before the log existed). Their fights would be tagged `sim` and none are logged, so it predates 2026-10-28 12:28 or the log was off.
- For balance recommendations: the live data can support "small parties and healer-less parties lose", "DPS die most", "loot is ~0.3/viewer/run as configured", and "gold sinks are one item deep". It cannot support per-dungeon target tuning, anything about Levels 1/2/5/6, raids, or early-game pacing.

### Gaps
- Whether the loot-knob raise was deliberate: `content_history` for balance.json was not inspected (could show who changed it and when).
- A simulated reading under the live fingerprints would let live and sim be compared directly; needs `report:balance` with a service key.
