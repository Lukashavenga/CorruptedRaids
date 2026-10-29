# Stat system review: can Corrupted Raids go from four stats to three?

Scope: the four allocatable stats (HP, Attack, Speed, Skill) across the three roles (Tank, Healer, DPS). Part A reads the repo's code and measures it with a throwaway probe. Part B looks at published design on small stat sets. The repo was only read: the probes live in the session scratchpad (`statprobe.mts`, `probe2.mts`, `probe3.mts`), import the real engine, and write nothing.

Method note for every measured number below: party 2 tank / 2 healer / 8 DPS. It is built exactly as `report:threat` builds its reference party (`referenceParty` plus `spendPoints`, src/engine/difficulty.ts:143-206), with 60 seeded fights × 5 dungeons = **n=300 per cell**. At n=300 one standard error is about 2.9 pp, so **differences under ~6 pp are noise**. The same seeds run in every variant (common random numbers), which reduces the noise a little but does not remove it. "Same fight" means the enemy is expanded at the *baseline* party's rating, so it isolates combat value. "Own fight" means the enemy is expanded at the *modified* party's rating, which is what the live game does: matchmaking reacts to the build.

---

## Q1. What does each stat actually do today, for each role? (code-level table)

### Takeaway
None of the four stats is a single number. Skill drives **seven** mechanics, and three of them belong to the Tank alone. Attack also raises threat. Speed is the only stat that works purely as a multiplier. HP buys 2 per point where every other stat buys 1. Crit is a hidden fifth stat: points cannot buy it and gear never carries it. Several Skill effects **cap between 20 and 50 Skill**, and gear alone supplies about 33 Skill by level 25. So at endgame Skill stops being a choice.

### Cited Findings

**Per-point values and base spread**
- Points per level = 2. Each point gives **+2 HP**, or +1 Attack, +1 Speed, +1 Skill — content/balance.json:77-84 (perPoint hp 2 at line 79); applied in src/engine/stats.ts:87-97.
- Base spread: Tank hp 14 / atk 1 / spd 2 / skill 3 / crit 0.03. DPS 9 / 3 / 4 / 0 / 0.12. Healer 10 / 1 / 3 / 4 / 0.05 — src/engine/stats.ts:72-76.
- The final stat block is floored by `clampStats`: hp ≥ 1, spd ≥ 1, others ≥ 0, crit capped at 0.95 — src/engine/stats.ts:36-44.
- Auto-spend (the reference party and sim viewers) alternates the role's pair. Tank: hp, skill. DPS: atk, spd. Healer: skill, spd — src/engine/difficulty.ts:189-206.

**Mechanic table**

| Stat | Mechanic | Formula (values from balance.json) | Where | Who benefits |
|---|---|---|---|---|
| **HP** | Max health | +2 per point | balance.json:79; stats.ts:92 | All roles. Tank most, because aggro sends most hits there. DPS also need some, because of the 22% focus-break (resolver.ts:213-216) |
| HP | Role-scarcity bonus (Tank) | ×1.15 if Tanks are <20% of the party; ×0.92 if >50% | stats.ts:50-57; resolver.ts:69-83; balance.json:70-75 | Tank |
| HP | Rating | `effectiveHp = hp/(1-mit)`, weighted ×0.5 | partyStrength.ts:52-54,71 | Matchmaker prices it the same for every role |
| **Attack** | Damage per hit | `atk × (1 ± 0.2)`; crit ×1.8; then × (1 − target mitigation); floor 1 | formulas.ts:52-68; balance.json:32-40 | DPS. Also Healers on turns when nobody is below 70% (they attack: resolver.ts:428-443 falls through to 523-528). Tanks on non-taunt turns |
| Attack | **Threat from damage** | `aggro += damage × 0.08` | resolver.ts:499, 528; balance.json:4 | Hidden *cost*: high-Attack bodies draw more hits |
| Attack | Role-scarcity bonus (DPS) | ×1.15 / ×0.92 as above | stats.ts:55 | DPS |
| Attack | Rating | `atk × (1+crit) × 2s/(s+3)`, weighted **×12** | partyStrength.ts:69-71; statGuide.ts:42 (baseSpd 3) | The largest coefficient in the scorer |
| **Speed** | Initiative (global draw) | P(act) = `spd × initiativeWeight / Σ` over all living combatants | resolver.ts:415-419 | Everyone. It scales *every* action a unit has: DPS damage, Healer heals, Tank taunt cadence (taunt every 3rd action and costs the action: resolver.ts:448-460, balance.ts:511) |
| Speed | Rating | saturating `2s/(s+3)`, max ×2 on offence only | partyStrength.ts:69 | Priced only as offence. A Healer's speed is priced as if it were attack tempo |
| Speed | On gear, can be negative | `statMods` may subtract; result floored at 1 | stats.ts:21-44; types.ts:86-106 | Lets gear make trade-offs ("greatsword costs speed") |
| **Skill** | (1) Mitigation, all roles | `skill/(skill+10)`, cap 0.75 → **capped at Skill 30** | formulas.ts:33-37, 61-62; balance.json:35-36 | All roles. Gear supplies it, so DPS get it without spending points (see gear below) |
| Skill | (2) Tank self-mitigation | `min(0.40, 0.012 × skill)` → **cap at Skill 33** | resolver.ts:166-168; balance.json:19-20 | Tank |
| Skill | (3) Tank party guard | best other living tank: `min(0.35, 0.01 × skill)` → **cap at Skill 35**; total role mitigation clamped 0.75 | resolver.ts:170-178; balance.json:14,17 | Every *other* party member (and the second tank) |
| Skill | (4) Tank threat | `aggro = 10 × 6 × (1 + min(1.5, 0.03 × skill))` → **cap at Skill 50** (aggro 150 vs a DPS's base 10) | resolver.ts:302-313; balance.json:3,7,16,18 | Tank, and the party it shields |
| Skill | (5) Heal amount | `(2 + 0.5 × skill) × (1 ± 0.2)`; ×1.6 on tanks, ×0.4 on self | formulas.ts:71-75; resolver.ts:431-437; balance.json:24-29, 54-58 | Healer |
| Skill | (6) Healer extra speed | `spd += min(3, 0.15 × skill)` → **cap at Skill 20** | resolver.ts:285-291; balance.json:25-26 | Healer |
| Skill | (7) Rating | via effectiveHp, plus a flat **+5 per point** | partyStrength.ts:53-54,71 | Matchmaker |
| Skill | Role-scarcity bonus (Healer) | ×1.15 / ×0.92 | stats.ts:56 | Healer |
| (Crit) | Crit chance | role base only; ×1.8 damage | stats.ts:72-76; formulas.ts:58-59 | Fixed per role. Not allocatable, and on **0 of 127** gear files |

- Heal targeting: anyone under 70% HP, ranked by HP fraction, with the tank's fraction ×0.8; the Healer heals itself first below 35% — resolver.ts:123-134; balance.ts:501-502.
- Player-facing copy already says "Tank: Health + Skill", "Healer: Skill + Speed", "DPS: Damage + Speed … Skill is not for you" — src/text/en.ts:330-350. Skill's general tooltip packs in four effects: "Cuts damage taken … Tanks get more, and it drives their threat and their party guard. Healers heal for more and act more often" — src/text/en.ts:454.

**Gear (counted across all 127 files in content/gear/*.json; AGENTS.md still says 119)**
- Stats appearing in `statMods`: **Skill 112**, HP 59, Attack 38, Speed 33. Summed magnitude: Skill 337, HP 280, Attack 172, Speed 62.
- Negative mods: Speed 9, HP 5, Attack 3, Skill 2. Speed is the stat gear most often *charges*, which is the trade-off lever AGENTS.md §2.6 describes.
- Dominant stat per item (HP halved for its 2/pt rate): Skill 64, HP 38, Attack 22, Speed 3.
- Slot pattern: all **47 face items are Skill-only**. Head items are Skill/HP. Main-hand items carry Attack (25), Speed (20), Skill (14) and HP (10).
- `requires`: **113 of 127 ungated**, 13 gate on Attack, 1 on Skill, 0 on HP. The gates check points spent (src/engine/character.ts:168-180). AGENTS.md §10's "59 ungated / 33 hp / 26 atk" is stale.
- Effect: the L25 "best gear" reference DPS has **Skill 33 with zero points in Skill** (probe output), so it is already at the 75% mitigation cap from gear alone. The L10 "typical" DPS has Skill 16, which is 61.5% mitigation.

**Band thresholds that depend on ratePoints**: weak 0, seasoned 110, elite 430, brutal 940, infernal 1640, apocalyptic 2960 — src/engine/squad.ts:52-59.

### Inferences
- The "each stat wanted by two roles, ignored by one" symmetry from AGENTS.md §2.6 holds for **point allocation** but not for **mechanics**. Skill feeds DPS too (mitigation via gear). Attack feeds Healers on their idle turns. Speed feeds Tanks (taunt cadence). This is not a bug, but the explanation to players should be "what you should *spend* on", not "what does nothing for you".
- Skill is overloaded: seven effects, and it is the main stat on half the catalogue. That makes it a "god stat" early and a dead stat late. Most of its effects cap between Skill 20 and 35, and gear supplies roughly that by L25.
- `ratePoints` is role-blind. It prices Healer Skill only as mitigation plus 5/pt, with no heal value, and Tank Skill with no aggro or guard value. Attack carries a ×12 weight on every role.

### Gaps
- I did not measure how Healer heal throughput splits between Skill's heal amount and its speed bonus. Only whole allocations were tested.
- Crit's absence from gear might be intentional; I found no comment saying so.

---

## Q2. What do the measurements say each stat is worth to each role?

### Takeaway
DPS need Attack **and** Speed together: either one alone is a trap, so the DPS "choice" is a fixed 50/50 split. Tanks need Skill early, and Skill stops paying for them by L25. Healers are the least sensitive role, and at L25 **Attack beats their designed pair**. HP alone is a weak dump for every role.

### Cited Findings (probe `statprobe.mts`: one role's points all put into one stat, same fight, n=300 per cell)

| L10 typical gear (baseline 83% win, timer 10%) | all HP | all Attack | all Speed | all Skill |
|---|---|---|---|---|
| Tank | 69% (tank deaths 27%) | 51% (64%) | 52% (60%) | **87%** (8%) |
| Healer | 67% | 70% | 79% | 73% |
| DPS | 16% (timer 55%) | 61% | 43% (timer 45%) | 13% |

| L25 best gear (baseline 47% win, **timer 42%**) | all HP | all Attack | all Speed | all Skill |
|---|---|---|---|---|
| Tank | 48% | 53% | 33% | 40% |
| Healer | 52% | **71%** (timer 13%) | 39% | 48% |
| DPS | 0% (timer 93%) | 33% | 0% (timer 91%) | 0% |

- DPS: the designed pair (83% / 47%) beats all-Attack (61% / 33%) and all-Speed (43% / 0%). This is what you expect when damage is `atk × speed share` (formulas.ts:56 × resolver.ts:415-419): the product peaks at an even split. Speed alone is near worthless for a DPS.
- Tank at L10: all-Skill (87%) is at least as good as the pair, and cuts tank deaths from about 27% (all-HP) to 8%. At L25, all-Skill (Skill 84 against caps at 30-50) falls to 40%, below the pair's 47%. That is the caps biting.
- Healer: the swings are the smallest of any role at L10 (67-79%). At L25 all-Attack wins 71% against 47%, because the L25 loss mode is the timer (42%) and a Healer's idle turns are attacks.
- Matchmaker reaction (probe2, "own fight"): when Healers split Skill/Attack, the party's rating rises from 1081 to 1157 at L25 and own-fight win drops to 39%. The matchmaker partly cancels the combat gain, because `ratePoints` weights Attack ×12. DPS putting a share into HP lowers the rating (L10 376 → 339-346), so they draw an easier fight inside the level and win *more* (67-85%) even though they are weaker in the same fight (48-65%). The scorer under-prices DPS HP relative to what it does in combat.
- Skill caps reached: mitigation at Skill 30, tank self-mitigation at 33, guard at 35, aggro at 50, Healer speed bonus at 20 (arithmetic from balance.json:14-29, 35-36).

### Inferences
- **Speed is load-bearing, not decorative.** Anything that removes it has to rebuild DPS damage tempo somewhere else (Q3, model A).
- **Attack + Speed for DPS is a "false choice"** in the sense of the source cited in Q4: two sliders whose right answer is always "even". The split adds UI and decisions without adding build variety.
- **The Healer's two stats are the least important pair in the game.** Its identity comes from the role's behaviour (heal first, by urgency), not from its stats.
- **The real late-game problem is Skill saturation, not the stat count.** Removing a stat does not fix it. Raising the caps, or re-pointing what Skill does past them, would.

### Gaps
- Two gear tiers and one composition (2/2/8) only. Raid rooms, solo or small parties, and L50+ were not run.
- Whole-allocation extremes show direction, not the marginal value of the next point. A per-point gradient would need a finer sweep.

---

## Q3. Which concrete 3-stat merges are viable, and what does each break?

### Takeaway
Only one merge comes close to free: **fold Speed into Attack** as a single offence stat ("Might"), and move the Healer's speed onto Skill, which already partly does that. Every merge that touches Skill or HP damages Tank or Healer identity. Dropping Speed outright collapses the game.

### Cited Findings (probe2 / probe3. Budget-neutral approximation: a merged point is split evenly between its parts. n=300 per cell. Format: same-fight win / rated band / own-fight win)

| Model | L10 typical | L25 best |
|---|---|---|
| Baseline (4 stats) | 83% / seasoned 376 / 83% | 47% / brutal 1081 / 47% |
| **A. Drop Speed** (Healer all Skill, DPS all Attack) | 49% / **elite 435** / **36%** | 40% / brutal 1381 / **12%** |
| **B. Might = Attack+Speed**; Healer Skill .5 + Might .5 | 81% / seasoned 390 / 74% | 58% / brutal 1125 / 50% |
| B′. Healer all Skill (speed only through spdPerSkill) | 73% / 379 / 69% | 48% / 1094 / 45% |
| **C. Defence = HP+Skill**; Healer Defence .5 + Speed .5 | 81% / 375 / 83% | 49% / 1079 / 49% |
| **D. Symmetric 3-stat**: Tank HP+Skill, Healer Skill+Might, DPS Might+HP | 58% / 346 / 78% | 40% / 1024 / 61% |
| DPS 40/40/20 Attack/Speed/HP (reference) | 65% / 346 / 85% | 40% / 1019 / 62% |

**A. Remove Speed** (initiative fixed per role/gear)
- Breaks: DPS damage tempo. L10 own-fight win 83% → 36%, and the rating jumps a whole level (seasoned → elite). Gear loses the 33 Speed items and the 9 negative-Speed trade-offs. The ratePoints offence term (partyStrength.ts:69-70) loses its multiplier.
- Simplifies: one fewer slider. The DPS false choice is gone.
- Verdict: not viable without re-tuning Attack per point and every threshold.

**B. Might = Attack + Speed (recommended *if* three is required)**
- Mapping: Health (2/pt) / Might (+atk and +tempo per point) / Skill. Tank wants Health+Skill. Healer wants Skill, with its "act more often" folded into Skill by raising `maxSpdBonus` (balance.json:25) past today's cap of 3 at Skill 20. DPS wants Might, plus Health as a survival tax.
- Measured: within noise of baseline in the same fight (81% / 58% against 83% / 47%). Own fight at L10 is 74% against 83%, a small loss because the Healer's rating rises.
- Breaks:
  1. The symmetry "each stat wanted by two roles". Might becomes a DPS stat, and the Healer's Speed demand has to live inside Skill, making Skill even more overloaded (8 effects).
  2. Gear trade-offs. "+Attack, −Speed" (9 items) cannot be written inside one stat. It would have to become "+Might, −Health" or "+Might, −Skill".
  3. A base speed spread still has to exist inside the engine for initiative (resolver.ts:417). Tank 2 / Healer 3 / DPS 4 becomes a fixed role trait, and Might would raise an internal speed number.
  4. The ratePoints offence term and `BAND_THRESHOLDS` (squad.ts:52-59) must be re-measured. So must every dungeon's solved `bandStatScale` (AGENTS.md §6), which is a full re-solve of the content.
  5. `ROLE_PRIMARY_STAT`, `spendPoints`, the gear schema, 33+38 gear files, `statGuide`, en.ts copy, and the loadout UI all change.
- Simplifies: removes the trap of all-Attack or all-Speed for DPS. One offence number is easier to read on stream. Matches the Diablo III "one main stat per class" pattern (Q4).

**C. Defence = HP + Skill**
- Measured: neutral for Healers (81% / 83%, 49% / 49%). The Healer barely notices losing half its Skill, which itself shows how weak the Healer's stat dependence is.
- Breaks: **the Tank becomes a one-stat role.** Its only remaining choice would be Defence against Attack. Tank HP/Attack measured 68% same fight / 55% own fight at L10, worse than baseline. Heal power gets bundled with HP, which reads oddly ("my heals got bigger because I bought health"). `ROLE_PRIMARY_STAT` loses the Tank/Healer separation that stats.ts:51-53 explicitly protects. Skill's overload grows.
- Verdict: simplifies the panel and erases the Tank's build.

**D. Split Skill into Attack / HP** (mitigation from HP, heals from Attack)
- Not run, because it needs engine changes. On the code: the Healer would want Attack+Speed, exactly the DPS pair, so the roles converge. The tank's three Skill mechanics would need a new home. 112 Skill gear items would be remapped. The mitigation curve's K (formulas.ts:29-31) would have to be re-derived on a different stat scale.
- Verdict: the most expensive merge, and it breaks the most.

**Forcing 3-stat symmetry (model D in the table)**
- With three stats and three roles each wanting two, the only symmetric assignment forces DPS to want HP. Same-fight win falls to 58% / 40%. Own-fight win looks good (78% / 61%) only because the role-blind scorer under-rates HP and hands the party an easier fight. That is a matchmaker artefact, not a better design.

### Inferences
- The four-stat model is the smallest set that keeps "two per role, each stat shared by two roles" *and* lets gear express trade-offs. Three stats and three roles cannot keep that symmetry unless one role is made to want a stat that hurts it (D).
- Model B is the only defensible three. Its cost is mostly re-tuning and content migration, not design, but that re-tuning is large: thresholds, every dungeon's solve, and gear.

### Gaps
- Merged-stat per-point values were approximated as even splits. A real Might point might be tuned to be worth more than half of each part.
- Model D (split Skill) was not measured.

---

## Q4. What does published design say about very small stat sets, trap stats and legibility?

### Takeaway
Shipped games cut stats when a stat is either mandatory with a fixed right answer (WoW's hit and expertise caps) or invisible (Destiny 1/2's 1-10 stats). They give each class **one** main stat to simplify (Diablo III). They warn that "choices" between complementary stats are false choices, and that every stat should matter to every build (Pillars of Eternity). None of the sources argues for fewer stats as a goal in itself. The argument is for **fewer non-choices**.

### Cited Findings
- **Diablo III: one primary stat per class.** Strength for Barbarian/Crusader, Dexterity for Demon Hunter/Monk, Intelligence for Wizard/Witch Doctor/Necromancer, with Vitality shared. Each point of the main stat raises damage by about 1% — [Diablo Wiki, Strength](https://diablo.fandom.com/wiki/Strength); [DiabloWiki, Stat](https://di.diablowiki.net/Stat). The fan wiki sources disagree on exact per-point values.
- The attributes were overhauled in Jay Wilson's 19 Jan 2012 "System Changes" post, which removed Willpower and introduced Intelligence — [DiabloWiki, Stat](https://di.diablowiki.net/Stat); [Game Informer](https://gameinformer.com/b/news/archive/2012/01/20/these-are-the-changes-coming-to-diablo-iii); [Blizzplanet reprint](https://blizzplanet.substack.com/p/diablo-iii-jay-wilsons-system-changes-article). I did not read the original Blizzard post.
- **WoW Warlords of Draenor (BlizzCon 2013 / 6.0).** Hit and Expertise were removed as "not fun stats" that "acted to remove a penalty, instead of making you stronger", and players treated their caps as mandatory. Dodge and Parry were removed from items in favour of a single Bonus Armor tank stat. Reforging was cut for causing hesitation over gear — [Engadget, BlizzCon 2013](https://www.engadget.com/2013-11-09-blizzcon-2013-huge-changes-coming-to-itemization.html); [Wowhead, item changes in WoD](https://www.wowhead.com/cn/guide/gear/item-changes-in-warlords-of-draenor); [Warcraft Wiki, WoD class changes](https://warcraft.wiki.gg/wiki/Wodclass). Wowhead says old Hit/Expertise was converted to Crit/Haste/Mastery. These quotes come through search summaries; the Engadget page could not be fetched from this session.
- **WoW Legion 7.1.5**: secondary-stat ratings were raised so focus would "return to primary stats". Primary stats were removed from rings and necklaces so the secondary-stat choices there "are impactful" — [Mein-MMO](https://mein-mmo.de/en/wow-legion-sekundaerwerte-geaendert,127758); [Ten Ton Hammer, blue comment](https://www.tentonhammer.com/news/wow-secondary-stat-nerf-blue-comment).
- **Stat squish** = scaling every number down algorithmically, done for legibility — [Warcraft Wiki, Stat squish](https://warcraft.wiki.gg/wiki/Stat_squish); [Icy Veins on the Midnight squish](https://www.icy-veins.com/wow/news/the-midnight-stat-squish-will-make-your-numbers-look-absurdly-small). Corrupted Raids already did the equivalent with its level-1 scale (AGENTS.md §2.6).
- **Diablo IV Season 4 "Loot Reborn" (May 2024)**: fewer and simpler base affixes. Rares drop with 2 affixes, Legendaries with up to 3. Complexity moved to opt-in crafting (Tempering, Masterworking), so loot is "easier to understand and more impactful" — [mp1st](https://mp1st.com/news/diablo-4-season-4-loot-reborn-out-may-14-brings-item-updates-and-here-are-the-changes); [Dexerto patch notes](https://www.dexerto.com/diablo/diablo-4-patch-notes-1-4-0-itemization-crafting-2676111/); [Icy Veins](https://www.icy-veins.com/d4/guides/diablo-4-latest-season/).
- **Destiny 2**: Armor 2.0's Mobility/Resilience/Recovery used tiered breakpoints, gave no benefit past tier 10, and had uneven returns. Early on the game shown a 1-10 scale "but nowhere in the game can you find what the actual difference between Mobility 1 and Mobility 8 are" — [Shacknews tier charts](https://www.shacknews.com/article/119193/armor-stats-and-tier-charts-destiny-2); [Vice](https://broadly.vice.com/en/article/ne8vew/destiny-2-is-thank-god-finally-leaning-into-its-rpg-roots).
- **Destiny 2 Armor 3.0 (Edge of Fate, 2025)** renamed the six stats after what they do (Weapons, Health, Class, Grenade, Super, Melee). Legacy rolls were converted 1:1, and archetypes fix each piece's top two stats — [Bungie TWID 26 Jun 2025](https://www.bungie.net/7/en/News/Article/twid_06_26_2025); [The Game Post](https://thegamepost.com/destiny-2-edge-of-fate-reveals-stats-overhaul-armor-builds/). Bungie's stated goal was that every stat point gives a benefit; players found bugs that broke it — [The Game Post](https://thegamepost.com/destiny-2-armor-3-0-rework-broken-mess-stats-bug-bungie-promise/).
- **Pillars of Eternity (Josh Sawyer)**: aimed for no dump stats, with every class gaining something from any attribute build. Asked whether that meant there was no dump stat, Sawyer answered "Exactly" — [PCWorld interview](https://www.pcworld.com/article/440496/in-depth-interview-pillars-of-eternitys-josh-sawyer-talks-character-creation-cloaks-and-ten-foot-po.html); [GameBanshee interview](https://gamebanshee.com/k9fcw); GDC 2016 talk "Gods and Dumps: Attribute Tuning in Pillars of Eternity" — [GDC Vault](https://gdcvault.com/play/1023481/Gods-and-Dumps-Attribute-Tuning). Players still call Perception and Resolve dumps — [Obsidian forums](https://forums.obsidian.net/topic/67321-a-how-to-on-revamping-the-6-attribute-system/).
- **False choice**: if a fighter's Strength drives damage and Dexterity drives to-hit, the player "needs both", so the choice is false. Guild Wars 2's stats are cited as all viable because each has broad scope — [Kitsune Games, "MidBoss stats and you"](https://kitsunegames.com/post/archived/2013/06/02/midboss-stats-and-you/). Attribution is from a search summary and was not verified against the page. An Obsidian attribute questionnaire lists "no dump stats; every attribute must be useful for every character (class)", and some posters there felt 3-4 attributes is too thin — [Obsidian forums](https://forums.obsidian.net/topic/64891-attribute-questionnaire/).
- **GW2** in practice: Berserker (offence) gear is the PvE default, and current raid builds still keep defensive stats at baseline values — [GW2 forum](https://en-forum.guildwars2.com/discussion/comment/1019921); [Snow Crows build](https://snowcrows.com/builds/raids/warrior/power-berserker-axe-axe-mace).
- **Pokémon**: Gen I's single "Special" stat covered both special damage dealt and taken. Gen II split it into Special Attack and Special Defense — [Bulbapedia, Stat](https://bulbapedia.bulbagarden.net/wiki/Stat); [StrategyWiki](https://strategywiki.org/wiki/Pok%C3%A9mon_Gold_and_Silver/Special). It is a shipped example of a merged offence+defence stat being *un*-merged.
- **Darkest Dungeon** uses six combat stats (HP, Dodge, Protection, Speed, Accuracy, Crit). Speed sets turn priority without guaranteeing order, and Protection caps at 80% — [Darkest Dungeon Wiki](https://darkestdungeon.wiki.gg/wiki/Getting_Started); [Heroes](https://darkestdungeon.wiki.gg/wiki/Critical_Chance).
- **Into the Breach**: numbers "rarely exceeding single digits", built from a few verbs (move, damage, push/pull, status) — [Giant Bomb review](https://www.giantbomb.com/into-the-breach/3030-58234/user-reviews/2200-31048/); [Tampere PlayLab](https://blogs.tuni.fi/playlab/game-reviews/into-the-breach-complex-simplicity/); [Wikipedia](https://en.wikipedia.org/wiki/Into_the_Breach).
- **Schreiber & Romero, *Game Balance***: transitive balancing means equal cost and benefit per element; a dominant strategy makes everything else extraneous; test by doubling or halving values — [Routledge](https://www.routledge.com/Game-Balance/Schreiber-Romero/p/book/9781498799577); [Game Balance sketchnote](https://mechanicsofmagic.com/wp-content/uploads/2023/11/Game-Balance-Sketchnote.pdf); [UBC lecture](https://www.cs.ubc.ca/~rhodin/2020_2021_CPSC_427/lectures/14_BalancingGames.pdf).

### Inferences
- The shipped pattern is to **cut stats that are not choices**: mandatory caps, a fixed right split, invisible effects. Corrupted Raids has one such case: DPS Attack/Speed, where the right split is always even. It also has a stat that **becomes** a non-choice late: Skill past its caps. Neither is solved by going from 4 to 3 in the abstract.
- Diablo III's "one main stat per class plus shared Vitality" is closest to model B: Might for DPS, Skill for Tank and Healer, Health for everyone. It shipped and players read it easily. It also gave up stats as a build axis, which is the trade this game would make.
- For a spectator audience, legibility comes mainly from **effects named for what they do** (Destiny 3.0) and **small numbers** (Into the Breach, WoW squish), not from the stat count. Corrupted Raids already has small numbers. Its weak point is that one name, Skill, means seven things.

### Gaps
- gdcvault.com and engadget.com could not be fetched from this session; network-blocked. Quotes from them come through search summaries.
- I found no primary dev source for Slay the Spire's or Hades' choice to have no stats, or for FTL's or Into the Breach's minimal stats beyond reviews.
- I found no source on stat counts in Twitch or chat-played games.

---

## Q5. Recommendation-ready conclusion

### Takeaway
**Keep four stats.** Present them per role as "two to buy", and fix the two real problems: Skill saturating, and the DPS Attack/Speed false choice. If the streamer still wants three, the only viable model is **Health / Might / Skill**, where Might is Attack plus Speed. Expect a full re-tune: thresholds, every dungeon's solve, and about 70 gear files.

### Cited Findings (summary of the evidence above)
- Removing Speed outright: own-fight win 83% → 36% (L10), 47% → 12% (L25), n=300 (probe2).
- Might merge: within noise in the same fight (81% / 58% against 83% / 47%); own fight 74% / 50% (probe2).
- Defence merge (HP+Skill) leaves the Tank a single stat. Forced 3-stat symmetry makes DPS want HP: same fight 58% / 40% (probe3).
- Shipped precedent is to cut non-choices, not stat count: WoW WoD hit/expertise; Diablo III one main stat; Destiny renaming stats by effect (Q4).

### Inferences: per-role explanation for the stream (if keeping four)
- **Tank: Health + Skill.** Health is how much you can take. Skill is how little each hit does to you, how hard you pull enemies off your friends, and how much you shield the whole party. Skill matters most until about 35, then Health.
- **Healer: Skill + Speed.** Skill is how big each heal is, and it makes you act a little more often. Speed is how often you act at all. When nobody needs healing you attack, so a late-game healer can still use some Attack.
- **DPS: Attack + Speed, split evenly.** Damage is Attack times turns, so pumping one does little. You will get Skill from gear anyway, and buying it with points is a waste. Keep a little Health, because about one hit in five ignores the tank.
- Where each stat lands: Health (Tank; everyone a little), Attack (DPS; Healer late), Speed (DPS, Healer), Skill (Tank, Healer; everyone via gear).

### Inferences: changes cheaper than a merge (all need re-measuring; none were applied)
1. Raise or replace the Skill caps (Healer speed bonus at 20; tank mitigation, self-mitigation and guard at 30-35), or make Skill past the caps feed threat or heals, so late Skill points are not wasted. Today all-Skill tanks at L25 do worse (40%) than the pair (47%).
2. Consider making `ratePoints` role-aware, or at least pricing HP for DPS correctly. The scorer currently rewards DPS for buying HP with an easier fight (own fight 67-85% against same fight 48-65%), which is an exploit chat could find.
3. Optionally show the DPS pair as one "Offence" readout in the loadout while keeping the two stats in the engine. That captures most of model B's legibility at none of its migration cost.
4. Update AGENTS.md's gear counts (127 files; 113 ungated) when the doc is next edited. That is outside this read-only task.

### Gaps
- No live balance-log data (actual viewer allocations) was checked. `report:balance` reads Supabase, which was not used here.
- Model B's per-point value, the Healer `maxSpdBonus` needed to replace allocatable Speed, and the re-solved thresholds were not computed. Each would need a branch with engine changes.
