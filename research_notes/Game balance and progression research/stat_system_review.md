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

Verification pass, 2026-10-29. Every claim below is tagged with what it rests on:
- **[primary]** is the developer's own words, read in full. That means the developer's post or patch notes, or a verbatim reprint of them.
- **[interview]** is a developer quoted in a journalist's interview, read in full.
- **[secondary]** is press or wiki, read in full.
- **[unverified]** means the source could not be opened in this pass.
- **[corrected]** marks where the earlier version of this section was wrong.

How the sources were read: WebFetch could not resolve any host from this session. Pages were fetched with curl through the session's egress proxy instead, and read as extracted text. These hosts refused (403 or a Cloudflare challenge), so their claims stay as they were: wowhead.com, icy-veins.com, bulbapedia, forums.obsidian.net, darkestdungeon.wiki.gg, warcraft.wiki.gg, diablo.fandom.com, en-forum.guildwars2.com, giantbomb.com, subsetgames.com, en.wikipedia.org. gdcvault.com answered with a "Maintenance in Progress" page. bungie.net article pages render only with JavaScript, so Bungie's text was read from destiny.bungie.org's BWU archive, which reprints each TWID in full.

### Takeaway
The primary sources back the shape of the earlier conclusion, and are sharper than the snippets were. Shipped games cut a stat when it is a **non-choice**: a cap you must hit (WoW hit/expertise), a stat everyone maxes (Destiny 2's Resilience, fixed for all players in Armor 3.0), or a number whose effect is hidden (Destiny 2's 1-10 bars). When a stat is merely *weak* for a role, the fix that shipped was to **make it valuable**, not to delete it: WoD gave Warriors a passive "to ensure that Haste has strong, competitive value". The rule Blizzard stated is "all secondary stats are valuable (except Bonus Armor for non-tanks and Spirit for non-healers, of course)". That is the same "wanted by some roles, ignored by others" shape Corrupted Raids uses. No source argues for fewer stats as a goal in itself. Three corrections: Diablo III's 2012 overhaul dropped **Attack, Precision and Defense**, not Willpower. Destiny 2's Armor 3.0 **re-pointed** what the stats do, not just their names. The WoW "not fun stats" quote comes from Blizzard's alpha patch notes, not from Engadget.

### Cited Findings

**World of Warcraft: Warlords of Draenor (6.0), hit, expertise, dodge, parry, reforging**
- [primary] **[corrected: source]** The "not fun" wording is in Blizzard's WoD alpha patch notes (2014; the exact posting date was not confirmed), reprinted verbatim by Blizzplanet: "Hit and Expertise were not fun stats. They acted to remove a penalty, instead of making you stronger. Most players treated Hit/Expertise caps as mandatory (rightfully so), with failure to reach those caps as a trap of sorts. After adjusting, gemming, and reforging gear to meet that cap, players could then go after the actual damage-increasing stats. We decided to remove Hit and Expertise, and make it so you don't need them." The same notes: "Hit and Expertise bonuses on all items and item enhancements (gems, enchants, etc.) have been converted into Critical Strike, Haste, or Mastery." — [Blizzplanet, WoD Alpha Patch Notes](https://warcraft.blizzplanet.com/?p=39875)
- [primary] The same notes on dodge and parry: "items in Warlords of Draenor will not have Dodge or Parry on them as a stat", because spiky tank damage "generally isn't much fun". Tanks get Bonus Armor instead: "one of the new secondary stats available to all tanks is Bonus Armor." — [Blizzplanet, WoD Alpha Patch Notes](https://warcraft.blizzplanet.com/?p=39875)
- [primary] **New, and the most relevant line for this game:** "Haste has long been a problematic stat for Warriors, usually being of little value. As part of our commitment to ensuring all secondary stats are valuable (except Bonus Armor for non-tanks and Spirit for non-healers, of course), we're making a significant change to Warriors, to ensure that Haste has strong, competitive value." — [Blizzplanet, WoD Alpha Patch Notes](https://warcraft.blizzplanet.com/?p=39875)
- [primary] On primaries: "The 'primary' stats, Agility, Strength, and Intellect, are foundations of a character's power. But they have not been created equally, making it difficult to properly balance them against secondary stats." — [Blizzplanet, WoD Alpha Patch Notes](https://warcraft.blizzplanet.com/?p=39875)
- [interview] Ion Hazzikostas to AusGamers (reposted by GameBanshee, 1 Nov 2014): "hit and expertise were actively anti-fun. We want our stats to feel good about making you more powerful … you needed to get a certain amount of hit and expertise for the game to feel right, but once you had that unlocked anything over that also felt bad. It was this bizarre constraint, it was this penalty if you didn't have it but never actually made your life better so we are happy to get rid of it." — [GameBanshee / AusGamers](https://www.gamebanshee.com/k3pk4)
- [secondary] **[corrected: wording]** Engadget's BlizzCon 2013 panel report (Adam Koebel, 9 Nov 2013) does *not* contain "not fun stats" or "remove a penalty". What it says is: "Hit and expertise are gone. Blizzard felt like they didn't feel like a bonus." It also reports: "Dodge and parry stats are gone … New stat for tanks: bonus armor", and "Reforging is gone!" On reforging, the stated reason is "too much modification needed to be done every time you get a new piece of gear: enchants, gemming, and reforging your caps". The earlier note's "hesitation over gear" is not in this source. — [Engadget](https://www.engadget.com/2013-11-09-blizzcon-2013-huge-changes-coming-to-itemization.html)
- [secondary] Engadget on the item squish: "Your relative power will not change whatsoever … If it takes you 5 seconds to kill a Gulp Frog, it will still take you 5 seconds after the item squish." — [Engadget](https://www.engadget.com/2013-11-09-blizzcon-2013-huge-changes-coming-to-itemization.html). The Warcraft Wiki "Stat squish" page and the Icy Veins "Midnight" squish article were **[unverified]** (blocked) — [Warcraft Wiki](https://warcraft.wiki.gg/wiki/Stat_squish); [Icy Veins](https://www.icy-veins.com/wow/news/the-midnight-stat-squish-will-make-your-numbers-look-absurdly-small).

**World of Warcraft: Legion 7.1.5**
- [primary, via verbatim repost] **[corrected]** The phrase "return to primary stats" is not in the blue post. Community manager Lore (6 Dec 2016) wrote: "Increasing the amount of rating that you need per percentage of a secondary stat tips the balance of an item's power more heavily toward primary stat", and "More overall character power will come from your primary stats than it did before". Primary stats were taken off rings and necks at Legion's launch, not in 7.1.5. The 7.1.5 post looks back on that change: "The removal of primary stats from those slots on Legion gear means that your choices of secondary stats there are impactful, which we like." — [Ten Ton Hammer, reposting the blue post](https://www.tentonhammer.com/news/wow-secondary-stat-nerf-blue-comment); [Mein-MMO](https://mein-mmo.de/en/wow-legion-sekundaerwerte-geaendert,127758) (German, consistent).

**Diablo III: one primary stat per class**
- [primary, via verbatim repost] **[corrected]** Jay Wilson's "System Changes" post (19 Jan 2012) dropped **Defense, Attack and Precision**. It did not remove "Willpower". The text: "We're changing core character attributes to Strength, Dexterity, Intellect, and Vitality … Strength +Barbarian damage +Armor; Dexterity +Demon Hunter damage +Monk damage +Dodge; Intellect +Wizard damage +Witch Doctor damage +Health from globes; Vitality +Health. We're dropping Defense, Attack, and Precision as attributes, Armor is taking over for what Defense used to provide, +Physical Resist will take over for Armor, and +Chance to Crit will fill in for Precision." — [GameBanshee, quoting the official post](https://www.gamebanshee.com/ku6xk); consistent with [Game Informer](https://gameinformer.com/b/news/archive/2012/01/20/these-are-the-changes-coming-to-diablo-iii) and [Blizzplanet](https://blizzplanet.substack.com/p/diablo-iii-jay-wilsons-system-changes-article) ("Defense, Attack and Precision have been removed from the attributes system").
- [primary, via verbatim repost] The stated *reason* is item legibility, not stat count: "This change makes the stats more intuitive and fixes some of the itemization issues … We want to make it clear that junk items aren't worth picking up, and make it easy to identify other items as not for your character … By specifically targeting stats at classes, we can reduce the amount of item overlap." — [GameBanshee](https://www.gamebanshee.com/ku6xk)
- [unverified] The figure of "~1% damage per point of main stat", and the class list including Crusader (2014) and Necromancer (2017), come from fan wikis that were blocked in this pass — [Diablo Wiki](https://diablo.fandom.com/wiki/Strength); [DiabloWiki](https://di.diablowiki.net/Stat). Blizzard's own game-guide page rendered no text.

**Diablo IV Season 4, "Loot Reborn"**
- [primary] Blizzard, 30 Apr 2024: "One of our several goals for the Itemization changes is to make it easier to understand which items are upgrades when they drop. We reduced the number of affixes on items (down to 3 on Legendary items, 2 on Rare items) and made these affixes more effective. Instead of seeing an affix that relies on conditional values (+10% damage on non-injured Elites), you'll see affixes such as base increases to your Movement Speed, Max life, or single ranks of a Core Skill. Dropped Items are now simpler to evaluate, and we've moved their complexity and customization to our new crafting systems, Tempering and Masterworking." Greater Affixes are "1.5x more powerful versions of normal affixes". — [Blizzard News, Season 4: Loot Reborn](https://news.blizzard.com/en-us/article/24077223/4). This is consistent with [mp1st](https://mp1st.com/news/diablo-4-season-4-loot-reborn-out-may-14-brings-item-updates-and-here-are-the-changes) and [Dexerto](https://www.dexerto.com/diablo/diablo-4-patch-notes-1-4-0-itemization-crafting-2676111/), so the earlier claim holds. The earlier quote "easier to understand and more impactful" is a paraphrase; the primary wording is the one above.

**Destiny 2**
- [secondary] Before Armor 2.0 (Vice, 14 Aug 2019): "The three current stats on armor (Mobility, Resilience, and Recovery) are all represented by a simple 1 to 10 scale, but nowhere in the game can you find what the actual difference between Mobility 1 and Mobility 8 are. This meant there was little incentive to try different builds." — [Vice](https://www.vice.com/en/article/ne8vew/destiny-2-is-thank-god-finally-leaning-into-its-rpg-roots). Note that this describes Destiny 2 *before* Armor 2.0, not Destiny 1.
- [secondary] Armor 2.0 tiers (Shacknews, 14 Jul 2020): "For every 10 points in a given stat, that stat is increased one tier, from Tier 1 through to Tier 10. At 100 Points, a stat will be at Tier 10, so any points over 100 are excess." — [Shacknews](https://www.shacknews.com/article/119193/armor-stats-and-tier-charts-destiny-2)
- [primary, via BWU archive] **[corrected: it was a rework, not a rename]** TWID of 5 Jun 2025 gives the mapping: "Mobility is now Weapons / Resilience is now Health / Recovery is now Class / Strength is now Melee / Discipline is now Grenade / Intellect is now Super". It also gives every stat *new effects*. For example, Health 1-100 "Grants 0-70 healing when picking up an Orb of Power" and Weapons 1-100 "Improves weapon reload and handling speeds". The old effects were taken off the stats entirely: "For the stats going away with the new system, we have set them to a fixed value for all players … Resilience is fixed to what 100 once was. Recovery is fixed to around what 60 once was." The stated aim: stats "now go up to 200 for extra effects and take every point into consideration, pushing buildcrafting to its limits and making every choice matter." — [BWU archive of TWID 5 Jun 2025](https://destiny.bungie.org/bwu/559) (original on bungie.net; JavaScript-only, not read directly)
- [primary, via BWU archive] TWID of 26 Jun 2025: "One of the major focuses for us when redesigning how armor works in The Edge of Fate was clarity." Archetypes "determine the two highest stats on each piece of armor" (e.g. "Bulwark: Health primary, Class secondary", "Gunner: Weapons primary, Grenade secondary"), and existing rolls "will just have their stats moved over, 1:1". — [BWU archive of TWID 26 Jun 2025](https://destiny.bungie.org/bwu/562)
- [secondary] The Game Post (8 Aug 2025) quotes Bungie's promise that "every point in a stat will provide a benefit", ending the tier system "that only improved abilities every 10 points". It reports that bugs left scaling effectively tiered after launch. — [The Game Post](https://thegamepost.com/destiny-2-armor-3-0-rework-broken-mess-stats-bug-bungie-promise/). Bungie's own wording sits in its "Developer Insight: Next Generation Armor" article, which is **[unverified]** because it is JavaScript-rendered — [Bungie](https://www.bungie.net/7/en/News/Article/next_gen_armor).

**Pillars of Eternity: "no dump stats"**
- [interview] Josh Sawyer to PCWorld (Hayden Dingman, 24 Jul 2014): "we made sure that all the attributes are good for all classes. So if you want to make a super genius barbarian, you can, and it's actually good for them because Intellect affects area of effect and duration." Asked "So there's not just a dump stat?", he answered: "Exactly. We wanted to avoid—well, not just avoid dump stats, but if you have an idea … you can do all of that". And: "if there's only one or two builds you can really make with a character, why have attributes? Why not just say you're a barbarian and you're strong because you're a barbarian." — [PCWorld](https://www.pcworld.com/article/440496/in-depth-interview-pillars-of-eternitys-josh-sawyer-talks-character-creation-cloaks-and-ten-foot-po.html)
- [interview] The GameBanshee Q&A (the earlier `gamebanshee.com/k9fcw` link; the working address is the `www.` one, from the game's 2013 title reveal, exact date not confirmed) has Sawyer saying: "every character class can gain something from a particular build. We're not trying to make everything perfectly balanced, but we do want players to feel like there are viable concepts for every attribute/class combination." Note the hedge: *viable*, not equal.
- [primary] The GDC talk exists: "Gods and Dumps: Attribute Tuning in Pillars of Eternity", GDC 2016. Obsidian's Update #106 (23 Mar 2016) says it "gave an in depth look into the history of attributes in RPGs and how that history guided our decisions" — [Obsidian Update #106](https://eternity.obsidian.net/news/update-106-new-obsidian-game-announced). A 58-minute recording is on GDC's YouTube channel as "'Pillars of Eternity' and Proper Attribute Tuning" — [YouTube](https://www.youtube.com/watch?v=fvyrEhAMUPo). **[unverified: contents]** Both the GDC Vault page ([1023481](https://gdcvault.com/play/1023481/Gods-and-Dumps-Attribute-Tuning)) and the video's captions were unreachable, so nothing from inside the talk is quoted here.
- [unverified] That players still call Perception and Resolve dump stats rests on Obsidian forum threads that were blocked — [Obsidian forums](https://forums.obsidian.net/topic/67321-a-how-to-on-revamping-the-6-attribute-system/).

**"False choices", dominant strategies and complexity that adds nothing**
- [primary, developer blog] **[verified: attribution]** Eniko of Kitsune Games ("MidBoss: Stats and you", 2 Jun 2013): "in a game where you play a fighter and strength controls damage while dexterity controls to-hit, this presents the player with a false choice; he can choose strength or dexterity, but clearly needs both." And: "A fighter will need strength and dexterity, and also constitution … though you can tweak the ratios there's very little choice involved; you just need all of them." Guild Wars 2's four stats are "for the most part (in PvE) … all viable choices because they have broader scope." — [Kitsune Games](https://kitsunegames.com/post/archived/2013/06/02/midboss-stats-and-you/). Note: MidBoss's answer was the *opposite* of fewer stats. It used four broad "meta" stats that each feed nine core stats per form.
- [primary] Soren Johnson ("Water Finds a Crack", Game Developer, Mar 2011): "Given the opportunity, players will optimize the fun out of a game." And: "a single, dominant strategy actually takes away choice from a game because all other options are provably sub-optimal. The sweet spot for game design is when a specific decision is right in some circumstances but not in others." — [Designer Notes](https://www.designer-notes.com/game-developer-column-17-water-finds-a-crack/)
- [primary] David Sirlin ("Balancing Multiplayer Games, Part 1", 15 Aug 2014): "Such a game might have thousands of options, but we only care about the meaningful ones. If those thousands of options all accomplish the same thing, or nothing, or all lose to the dominant move … they are not meaningful options. They just get in the way and add the worst kind of complexity to the game: complexity that makes the game harder to learn yet no more interesting to play." — [Sirlin.net](https://www.sirlin.net/articles/balancing-multiplayer-games-part-1-definitions)
- [unverified] The Obsidian "attribute questionnaire" thread ("no dump stats; every attribute must be useful for every character (class)") was blocked — [Obsidian forums](https://forums.obsidian.net/topic/64891-attribute-questionnaire/).

**Ian Schreiber, *Game Balance Concepts* (2010 course; basis of Schreiber & Romero, *Game Balance*, 2021)**
- [primary] Level 1, on solvability: "If the player knows the best move, they aren't making any interesting decisions; every decision is obvious." — [Level 1](https://gamebalanceconcepts.wordpress.com/2010/07/07/level-1-intro-to-game-balance/)
- [primary] Level 2 analyses a **four-stat** RPG (Dragon Warrior: HP, MP, Attack, Defense) and finds "everything — Attack, Defense, MP, Monster Encounters — is linked directly to HP … This is a common technique, making a single resource central to all of the others." Also: "at any given time in the game, you probably want the choices made available at that time to be at least somewhat balanced with each other." — [Level 2](https://gamebalanceconcepts.wordpress.com/2010/07/14/level-2-numeric-relationships/)
- [primary] Level 3, on costing a choice: "if you give the player a choice between two benefits, the cost of the choice must be at least the cost of the more expensive of the two benefits … if it is a choice between two equally good things, that choice is a lot more interesting than choosing between an obviously strong and an obviously weak effect." — [Level 3](https://gamebalanceconcepts.wordpress.com/2010/07/21/level-3-transitive-mechanics-and-cost-curves/)
- [primary] Level 6, on situational stat value. A stat's worth depends on the *encounter mix*, here in d20 terms. Outnumbered, "+1 AC is much more powerful"; ganging up on one giant, "+1 BAB is more powerful". So "AC is more powerful than BAB; the two stats are not equivalent on the cost curve, even though the game behaves like they should be." — [Level 6](https://gamebalanceconcepts.wordpress.com/2010/08/11/level-6-situational-balance/)
- [secondary] The book itself, and the "double or halve values" heuristic, were not re-read in this pass — [Routledge](https://www.routledge.com/Game-Balance/Schreiber-Romero/p/book/9781498799577); [sketchnote](https://mechanicsofmagic.com/wp-content/uploads/2023/11/Game-Balance-Sketchnote.pdf); [UBC lecture](https://www.cs.ubc.ca/~rhodin/2020_2021_CPSC_427/lectures/14_BalancingGames.pdf).

**Pokémon: Gen I's single Special stat**
- [secondary] Smogon's RBY mechanics guide: "In RBY, Special Attack and Special Defense are merged into one, singular 'Special' stat. Therefore, if Special is increased or decreased, this will improve your offensive and defensive capabilities concerning special attacks. This makes Amnesia act like two Calm Mind uses". — [Smogon](https://www.smogon.com/rb/articles/rby_mechanics_guide). The Gen II split is **[unverified]** this pass (Bulbapedia and StrategyWiki were blocked) but undisputed — [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Stat); [StrategyWiki](https://strategywiki.org/wiki/Pok%C3%A9mon_Gold_and_Silver/Special).

**Slay the Spire, Hades, FTL, Into the Breach: minimal-stat games**
- [interview] Slay the Spire. Anthony Giovannetti (Mega Crit) frames the design around cards and combos, not character numbers: "Our process was to brainstorm thousands of different card designs and cut out the chaff down to the designs that we felt had the most impact", and "we believe in rewarding player mastery". — [Game Developer, Road to the IGF](https://www.gamedeveloper.com/disciplines/road-to-the-igf-mega-crit-games-i-slay-the-spire-i-). His GDC 2019 talk was "'Slay the Spire': Metrics Driven Design and Balance". The team "took a very metrics-focused approach to game balance early on" and "continued to make heavy use of data-driven development throughout the Early Access process". — [Game Developer, GDC 2019 preview](https://www.gamedeveloper.com/design/learn-i-slay-the-spire-i-s-metrics-driven-approach-to-game-balancing-at-gdc-2019). This is a published precedent for AGENTS.md §6's "difficulty is measured".
- [secondary] PC Gamer's Best Design 2019 (27 Dec 2019) credits StS's legibility: "A lot is owed to how transparent Slay the Spire makes information and enemy intents." — [PC Gamer](https://www.pcgamer.com/best-design-2019-slay-the-spire/)
- [interview] Hades. Greg Kasavin (creative director) on the one permanent power track: "The Mirror of Night is there to make you meaningfully more powerful from one playthrough to a next, so that through a combination of your own growing knowledge and experience, plus your character becoming stronger, you could get farther." — [Tom's Guide, 5 Sep 2021](https://www.tomsguide.com/uk/features/hades-exclusive-interview-supergiant)
- [interview] FTL GDC 2013 postmortem ("Designing Without a Pitch", Matthew Davis and Justin Ma; reported by Simon Parkin, 26 Mar 2013): "By having one singular focus we were able to abandon everything else that didn't fit in line with that vision", and "We kept ditching things to keep moving towards the goal." — [Game Developer](https://gamedeveloper.com/design/designing-without-a-pitch---an-em-ftl-em-postmortem). The quote that "very minimal UI was a driving force in our game design" surfaced only in a search summary and was **[unverified]**.
- [interview] Into the Breach (Kotaku, 22 Mar 2019). Justin Ma on the cut features: "We had city-building. We had multiple squads. All that sort of junk. The closest thing to our eureka moment was just literally, 'This part of the game works. This part of the game doesn't work. Cut all that, and just focus on the part that does work.'" — [Kotaku](https://kotaku.com/the-creators-of-into-the-breach-came-very-close-to-givi-1833498295). A review describes mech attacks as "deal 3 damage … deal 1 damage" — [Tampere PlayLab](https://blogs.tuni.fi/playlab/game-reviews/into-the-breach-complex-simplicity/). The phrase "rarely exceeding single digits" is **[unverified]** (Giant Bomb was blocked) — [Giant Bomb](https://www.giantbomb.com/into-the-breach/3030-58234/user-reviews/2200-31048/).

**Other entries carried over**
- [secondary, partly corrected] Guild Wars 2. **[corrected]** The Snow Crows page cited earlier is a build for the Warrior's *Berserker elite specialization*. The word "Berserker" there is the class spec, not the Berserker's stat prefix, so the page does not show "Berserker gear is the default". What it does show for that raid build: Power 3060, Precision 2141, Ferocity 1766, Toughness 1000 (the level-80 base) and Vitality 1572. Defence sits at or near base and offence is stacked. — [Snow Crows](https://snowcrows.com/builds/raids/warrior/power-berserker-axe-axe-mace). The GW2 forum comment is **[unverified]** (Cloudflare) — [GW2 forum](https://en-forum.guildwars2.com/discussion/comment/1019921).
- [unverified] Darkest Dungeon's six combat stats, Speed as non-guaranteed turn priority, and the 80% Protection cap all rest on wiki.gg pages that served a Cloudflare challenge — [Darkest Dungeon Wiki](https://darkestdungeon.wiki.gg/wiki/Getting_Started).
- [unverified] The Wowhead "item changes in WoD" guide and Warcraft Wiki's WoD class page were blocked; the primary alpha notes above supersede them — [Wowhead](https://www.wowhead.com/cn/guide/gear/item-changes-in-warlords-of-draenor); [Warcraft Wiki](https://warcraft.wiki.gg/wiki/Wodclass).

### Inferences
- **The shipped rule is "cut non-choices, fix weak stats".** WoW removed the stat with a fixed right answer (the cap). In the same patch notes, it kept a stat that was weak for one class (Warrior Haste) and changed the class until the stat paid. It also wrote down, as policy, that some stats are deliberately worthless to some roles (Bonus Armor for non-tanks, Spirit for non-healers). Corrupted Raids' Skill saturation is the Warrior-Haste case: a stat that stops paying for a role. By that precedent, the fix is re-pointing what Skill does past its caps, not deleting a stat.
- **Destiny's Armor 3.0 is a closer precedent than "renamed for clarity" suggested.** Bungie took the stat everyone maxed (Resilience, fixed at "what 100 once was" for all players) and turned it into a baseline, then rebuilt the remaining stats so "every point" counts. The analogue here: if a stat is always maxed, fold its effect into the role's base kit rather than asking players to buy it.
- **The DPS Attack/Speed split is the textbook false choice.** The Kitsune Games text is almost exactly this game's case: two stats both needed by one role, with "very little choice involved". Schreiber's solvability line ("every decision is obvious") and Sirlin's "complexity that makes the game harder to learn yet no more interesting to play" back the same reading. Showing the pair as one readout (Q5, change 3) answers that critique without touching the engine.
- **Merged stats double-dip.** Pokémon's single Special made one buff (Amnesia) count twice, for offence and defence. That is a caution for both merge models in Q3: "Might" (Attack+Speed) and "Defence" (HP+Skill). One point in a merged stat buys two effects, so its per-point price has to be re-derived rather than averaged.
- **Situational value is real here.** Schreiber's BAB/AC example says a stat's worth depends on the encounter mix. Corrupted Raids is one shared fight whose headcount changes the ratio of attackers to targets (party scaling, AGENTS.md §5), so the value of Skill (mitigation) against Attack should shift with party size. The Q2 probes measured only a 12-person party.
- **Diablo III's reason was item legibility, not stat count.** Wilson wanted it to be easy "to identify other items as not for your character". For a stream audience the parallel is gear that reads at a glance as "Tank gear" or "DPS gear". Corrupted Raids gets most of that from `requires` gates and the dominant stat on each item, so no merge is needed for it.

### Gaps
- **No primary source** says that Slay the Spire, Hades or FTL deliberately chose to have no character stats. The developer material found frames those games around cards, boons and focus, and in StS's case around metrics-driven balance. "Minimal stats as a design goal" in these games is still an inference from the games themselves.
- The Pillars GDC talk's contents (slides or transcript) were not read: GDC Vault was under maintenance and YouTube's captions were unreachable. No claim from inside the talk is made.
- Blocked hosts, so their claims stay as they were: Wowhead, Icy Veins, Bulbapedia, StrategyWiki, Obsidian forums, wiki.gg (Darkest Dungeon, Warcraft Wiki), Diablo fandom, the GW2 forum, Giant Bomb, Wikipedia. Bungie's Developer Insight article is JavaScript-rendered.
- The exact posting date of the WoD alpha patch notes was not confirmed from the reprint.
- I found no source on stat counts in Twitch or chat-played games. The closest legibility evidence is PC Gamer on StS's "transparent … information and enemy intents".

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
