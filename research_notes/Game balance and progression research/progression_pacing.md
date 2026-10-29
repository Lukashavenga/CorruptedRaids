# Progression pacing: XP curves, level size, and level vs gear as the progression axis

Verification pass, 2026-10-29. Rewrites the earlier pass. That pass rested partly on search snippets because several sites were blocked.

**How sources were checked.** In this session the WebFetch tool still failed DNS for business.columbia.edu, gamebalanceconcepts.wordpress.com and msbfile03.usc.edu. Plain `curl` through the session proxy did reach most hosts, so most pages below were downloaded and read in full (PDFs through `pdftotext`). Each finding carries a status tag:
- **[PRIMARY]**: read in full at the original source (paper PDF, official developer post, official data table).
- **[READ]**: a secondary page read in full (press coverage, a community wiki or database).
- **[SNIPPET]**: only seen as a search-result summary. Not verified.
- **[CORRECTED]**: the earlier pass had this wrong.

**Still unreachable this pass:**
- icy-veins.com, poewiki.net, warcraft.wiki.gg, wowpedia, en.wikipedia.org, selfdeterminationtheory.org, reddit, diablowiki.net and Oxford Academic answered HTTP 403.
- msbfile03.usc.edu (the Nunes & Drèze PDF) has an expired TLS certificate. It was not bypassed.
- bungie.net news pages render with JavaScript, so a fetch returns no text.

Every "Inference" below is the researcher's reasoning, not a sourced fact.

**Local context (from the repo, not external research).**
- `src/engine/stats.ts`: `xpToNextLevel(level) = round(40 + 10*level)`.
- `content/balance.json`: `progression.xpRate: 0.25`.
- Cumulative XP to reach a level: L10 = 810, L20 = 2,660, L50 = 14,210, L100 = 53,460, L300 = 460,460. The step is 50 XP at level 1 and 3,030 XP at level 299. Cumulative XP grows as ~5L².
- At the alpha figure of ~110 XP per viewer per run, level 300 takes **~4,186 runs**. AGENTS.md's figure of ~2,920 runs assumed ~158 XP/run.
- At 110 XP/run the current curve gives: level 5 in ~2 runs, level 12 in 10 runs, level 20 in 25 runs, level 33 in 60 runs, level 100 in 488 runs.
- 0.35 levels per run (the alpha figure) is what a character around level 27 sees: there a level costs 310 XP, about 2.8 runs.

## 1. XP curve shapes, their trade-offs, and reference curves from shipped games

### Takeaway
The curve Corrupted Raids uses (each level's cost rises by a fixed amount) is exactly the "linear progression curve" that Pascal Luban recommends as the compromise between flat and exponential. The problem is not the curve's shape. It is the scale: a level is under one run early on, and each one grants only 2 points. Exponential curves (RuneScape, Path of Exile) push most of the grind to the top. The earlier pass overstated how extreme Path of Exile's top end is; that claim is corrected below.

### Cited Findings
- **Luban's three threshold techniques** [PRIMARY; author Pascal Luban, Game Developer featured blog]:
  - *Constant increment* ("each threshold value increases by 3") is "the simplest one to implement and to control", but "Progression could either be too slow during early stages of the game or too fast in later ones."
  - *Exponential* (each threshold = previous × Y, example Y = 1.4): "it is very difficult to find the right coefficient. If it is too low, the curve will offer a flat progression only. And if Y is too high, values for later thresholds will skyrocket."
  - *Linear progression curve*: "the increase between each threshold that follows a linear curve". He calls it "an interesting compromise": "Early thresholds are easy to reach, then require an increasing amount of points but without reaching hyperbolic values."
  - His two rules: correct a computed curve "by hand" ("Think of Supercell games"), and "time spent by the player between two thresholds is as important as the values associated with each of them. If it takes too much time for players to reach early thresholds, you are going to loose them."
  - [Game Developer, "Quantitative design - How to define XP thresholds?"](https://www.gamedeveloper.com/design/quantitative-design---how-to-define-xp-thresholds-)
  - Note: the earlier pass called this a linear-increment curve on the strength of a snippet. In Luban's terms, Corrupted Raids' 40 + 10L is his recommended third technique, not the first.
- **Aversa on curve shapes** [PRIMARY, practitioner blog]:
  - Defines the experience curve as the inverse of L = f(E). Of linear, exponential and logarithmic curves: "They are all valid experience curves, everything depends on what kind of game you want."
  - Derives the exponential form E(L) = a(1−b^L)/(1−b).
  - On why levels exist instead of a smooth number: "We want to see the number get bigger, but we want to perceive the change. That's the reward after the 'work'."
  - Reproduces RuneScape's formula and a piecewise WoW "legacy" formula: ΔE(L) = ((8×L) + Diff(L)) × MXP(L) × RF(L), which "start[s] as a quadratic experience curve and then explode[s] into exponential". His WoW piecewise constants are his own reproduction and were not checked against Blizzard data.
  - [Davide Aversa, "GameDesign Math: RPG Level-based Progression"](https://davideaversa.it/blog/gamedesign-math-rpg-level-based-progression/)
- **Old School RuneScape** [READ; official community wiki, which publishes the formula and table]:
  - "The amount of experience needed for the next level is approximately 10% more than the last level" (83 XP to level 2, 91 XP to level 3).
  - "By around level 30 ... the amount of experience required doubles for each 7th level."
  - Level 99 = 13,034,431 XP. "Level 92 is nearly the exact halfway mark to level 99, requiring 6,517,253 experience." "Level 85 requires very nearly one quarter of the experience needed for level 99."
  - The formula is the floor of Σ floor(n + 300·2^(n/7)) / 4. The earlier pass's figures are confirmed.
  - [OSRS Wiki, Experience table](https://oldschool.runescape.wiki/w/Experience_table)
- **Path of Exile cumulative XP (PoE1)** [READ; PoEDB, a game-data database]:
  - L10 = 61,693; L50 = 54,607,467; L70 = 363,906,163; L80 = 855,129,128; L90 = 1,934,009,687; L95 = 2,876,116,901; L98 = 3,638,186,694; L99 = 3,932,818,530; L100 = 4,250,334,444.
  - [PoEDB, Experience](https://poedb.tw/us/Experience)
  - Corroborated by an unofficial table: [VHPG](https://www.vhpg.com/poe-level-100/).
- **[CORRECTED] Path of Exile's top end.** The earlier pass carried two claims, and both are wrong by the table above:
  - "99→100 takes almost as much XP as 1→99" is false. 99→100 is 317.5M XP; 1→99 is 3.93B. The last level is ~7.5% of the total.
  - "98 is roughly 50% of the way from 90 to 100" is also false: it is ~74%.
  - What does hold: level 90 is ~45.5% of the XP to level 100, so 90→100 costs slightly more than 1→90.
  - The death-penalty anecdotes (lose 10% of the current level's XP from level 71) were not re-verified: pathofexile.com and poewiki answered 403.
- **Pokémon growth rates** [READ]:
  - Totals at level 100: Erratic 600,000; Fast 800,000; Medium-Fast 1,000,000; Medium-Slow 1,059,860; Slow 1,250,000; Fluctuating 1,640,000.
  - Formulas: Fast 0.8n³; Medium Fast n³; Medium Slow 1.2n³ − 15n² + 100n − 140; Slow 1.25n³. Earlier figures confirmed.
  - [Serebii, EXP](https://serebii.net/games/exp.shtml)
- **Schreiber, Game Balance Concepts, Level 7** [PRIMARY; Ian Schreiber's free 2010 course]:
  - Power pattern: "within a single area like an individual dungeon or level, you start with a sudden jump in difficulty ... Over time, the player's power increases, either through level-ups or item drops, until ... another sudden difficulty jump in the form of a boss, and then after that typically another sudden jump in player power when they get loot from the boss".
  - Pacing of transitions: "a rule of thumb is to offer new levels or areas on a slightly increasing curve, where each level takes a little bit longer than the last."
  - On RPGs: "Usually these games are paced on a slightly increasing curve, where each area takes a little more time than the last ... the actual gains are close to linear."
  - [Schreiber, "Level 7: Advancement, Progression and Pacing"](https://gamebalanceconcepts.wordpress.com/2010/08/18/level-7-advancement-progression-and-pacing/)
- **Idle-game cost curves** [PRIMARY; Anthony Pecorella, Game Developer]:
  - "idle games are a seesaw between production rates and costs. Early on in a run, your production will exceed costs while eventually costs will become prohibitive. This is typically accomplished by having costs grow exponentially while production grows at a linear or polynomial rate."
  - Example: AdVenture Capitalist Lemonade Stand cost growth rate 1.07.
  - Prestige is the deliberate answer to the resulting wall.
  - [Pecorella, "The Math of Idle Games, Part I"](https://www.gamedeveloper.com/design/the-math-of-idle-games-part-i)
- **Polynomial exponent rules of thumb** [SNIPPET / low weight; practitioner blogs and AI-generated skill pages]: ~1.0 for tutorials, ~1.5 casual, ~2.0 MMO-style. Opinion, never validated.
  - [StraySpark](https://www.strayspark.studio/blog/rpg-stat-systems-character-progression-design); [OpenSkillIndex (low weight)](https://openskillindex.com/skills/absolutelyskilled-absolutelyskilled-game-balancing)

### Inferences
- 40 + 10L is Luban's compromise curve and needs no change of shape. What is wrong is its *unit*: at 110 XP/run the first ~10 levels cost under 1.3 runs each. The bar fills several times a session and each fill is worth 2 points.
- Luban's "time between thresholds" rule and Schreiber's "slightly increasing curve" point the same way: design in **runs per level**, then derive XP from it. Do not design in XP.
- An exponential curve would be wrong for a shared bar. Even PoE, now correctly measured, puts more than half its total XP in the last ten levels. A long dead stretch at the top is exactly what a chat watching one bar would notice.

### Gaps
- Exact WoW XP-per-level tables could not be read (warcraft.wiki.gg and wowpedia answered 403). Only Aversa's secondary reproduction is represented.
- No official GGG statement of PoE's curve or of time-to-100 was found. The SEO blog's "150-300+ hours for PoE2" claim was dropped as unverifiable.

## 2. "Fewer, bigger levels": level squishes, horizontal vs vertical progression, power creep

### Takeaway
Both Blizzard precedents are now verified at or near the source.
- **WoW Shadowlands** cut the cap from 120 to 60, with a promise that "each and every level will also unlock a new ability, talent, or some other upgrade so that each level is meaningful". The developer had called levelling to 120 "kind of an empty experience".
- **Diablo IV patch 2.0 / Season 6** split levels 1-60 (character level, carrying skill points) from realm-wide Paragon. Blizzard's own stated reason was "getting you to endgame activities and gear at a more rapid pace".

Both moved to fewer character levels with something attached to each, and put the long tail on a separate track.

### Cited Findings
- **WoW, March 2019 live Q&A (Ion Hazzikostas with Josh Allen)** [READ; Blizzard Watch's write-up, partly direct quotation]:
  - At "around the 34 minute mark" they discussed levelling. Hazzikostas described levelling to 120 as "It's kind of an empty experience."
  - A level squish was "being discussed internally very seriously".
  - [Blizzard Watch, Mar 22 2019](https://blizzardwatch.com/2019/03/22/level-squish-inevitable/)
- [READ] Mein-MMO summarises the same Q&A: according to Hazzikostas, it had long been discussed at Blizzard that the cap of 120 was too high, and reducing it to around 60 was being considered. Blizzard first wanted to hear the community's view. [Mein-MMO (German)](https://mein-mmo.de/wow-level-squish-auf-60/)
- **[CORRECTED] the Hazzikostas wording.** The earlier pass attributed "to make levels feel meaningful again" and "it would be too overwhelming ... to reward players for each earned level" to Hazzikostas. Those phrasings come from an Icy Veins forum roundup, which is a paraphrase. It was blocked again (403), so they remain [SNIPPET], not verbatim quotes. The verifiable direct quote is "kind of an empty experience".
  - [Icy Veins forum roundup](https://www.icy-veins.com/forums/topic/42603-live-developer-qa-roundup-march-21st/)
- **WoW fans on how thin the late levels had become** (quoted in Mein-MMO, opinion): from 1 to 60 you get something every second level; 60-80 gives 3-4 abilities and 2 talent points over 20 levels; 80-100 gives two talent points and nothing else; 100-110 nothing. [Mein-MMO](https://mein-mmo.de/wow-level-squish-auf-60/)
- **Shadowlands, BlizzCon 2019** [READ; PC Gamer, from the panel and the press release]:
  - Max-level characters squished to 50, levelling to a new cap of 60.
  - New characters get a new 1-10 zone, then pick one expansion for 10-50.
  - "Each and every level will also unlock a new ability, talent, or some other upgrade so that each level is meaningful."
  - Background: "players have long complained of the way new skills and meaningful upgrades have been stretched too thin across WoW's current 120 character levels."
  - [PC Gamer](https://www.pcgamer.com/world-of-warcrafts-level-cap-is-being-reduced-to-60/)
- **Diablo IV 2.0 PTR post, Aug 29 2024** [PRIMARY; Blizzard]:
  - "Paragon and character levels are now split out, with Levels 1–60 representing character level. This means you can earn an additional 10 Skill Points ... Starting at Level 60, players will begin to earn Paragon Levels".
  - Conversion: a level-100 character becomes level 50 with 200 realm-wide Paragon Levels.
  - Developer's Note: "The changes to leveling and Paragon were made with the intent of getting you to endgame activities and gear at a more rapid pace and making it easier to ramp up your alt characters".
  - Developer's Note: "Our original vision for character progression was that you would have a grand journey, traversing through World Tiers, swapping out gear, gaining incremental strength through the Paragon system. We felt that was fun the first time, but on repeated play throughs, World Tier III and Sacred items felt artificial and added a lot of stat bloat that didn't make the game more fun."
  - "The number of Paragon Points that can be earned by leveling has increased from 200 to 300."
  - The Glyph upgrade system "did not scale well and was needlessly grindy", so Glyph upgrades moved from experience to Pit attempts.
  - [Blizzard News, "The 2.0 PTR: What You Need to Know"](https://news.blizzard.com/diablo4/24130178)
- [READ] Maxroll's live Season 6 change log confirms: "The new 'Max Level' is 60"; Paragon "account/realm-wide with a cap of 300"; a "stat squish" in which "numbers have been significantly reduced across the board". [Maxroll](https://maxroll.gg/d4/news/season-6-change-log)
- **[CORRECTED] Diablo IV's rationale.** The earlier pass said "no direct Blizzard quote retrieved" and gave the rationale as "streamline endgame / enhance customisation" from secondary sources. The primary rationale is the developer's notes quoted above, and it is about *speed to gear and endgame* and *removing stat bloat*.
- [SNIPPET, not re-verified] Diablo IV originally put level 85 at about halfway to 100 by XP. [TweakTown](https://www.tweaktown.com/news/91936/diablo-iv-gamers-relate-to-runescape-players-after-realizing-level-85-is-halfway-100/)
- **Schreiber on the "elder game"** [PRIMARY]:
  - In games with no end, "at some point, more progression just isn't meaningful ... there is a sharp transition into what's sometimes called the 'elder game' ... this transition can be jarring."
  - Of FarmVille-style games: "it'll happily let you keep earning experience and leveling up… although after a certain point you don't really get any interesting rewards for doing so."
  - [Schreiber, Level 7](https://gamebalanceconcepts.wordpress.com/2010/08/18/level-7-advancement-progression-and-pacing/)
- **Horizontal vs vertical** [not re-verified this pass; editorial opinion carried over]: [Engadget 2014](https://www.engadget.com/2014-02-05-mmo-mechanics-comparing-vertical-and-horizontal-progression.html); [Massively OP, Apr 2025](https://massivelyop.com/2025/04/03/vague-patch-notes-whats-so-hopeless-about-horizontal-progression-in-mmos/); [Torchlight III, "Horizontal Progression"](https://www.torchlight3.com/de/news-article/11006473)

### Inferences
- Corrupted Raids grants a uniform, invisible +2 points at every level and has 300 of them. That is the WoW-120 situation in miniature. Both studios' fix was fewer levels, each carrying a visible reward, plus a separate long track.
- D4's own wording is a close fit for the streamer's goal. The levels were cut *so that players reach gear faster*: levels serve gear, not the other way round.
- The FarmVille warning from Schreiber applies to 300 levels × 2 points. Past a point the bar keeps moving and nothing interesting happens.

### Gaps
- No retention or engagement data comparing few-big against many-small levels exists in public. The evidence is developer statements.
- The verbatim Q&A transcript was not obtained; only Blizzard Watch's partial quotes.

## 3. Level vs gear as the progression axis; gating gear by level, by stats, or not at all

### Takeaway
Gear-score systems make every drop a potential "level-up", but they need caps and good drop quality. Bungie's own post-mortem on Edge of Fate is now the strongest primary-adjacent warning: the gear climb must feel like earning something, not like climbing "throwaway tiers". Diablo III's Loot 2.0 still supports "fewer, better drops", but its sources here are secondary.

### Cited Findings
- **Bungie, Renegades Content Calendar (Nov 2025)** [READ via The Game Post, which quotes the post at length; Bungie's own page did not render to text]:
  - "With Edge of Fate, we presented a different vision ... a familiar but deeper pursuit of Power and ascending to higher Tiers of gear".
  - "Very quickly, the feedback made it clear that this was the wrong path for Destiny. Even if our execution had been perfect, and we see plainly that it was not, it is clear that grinding Power will never be a substitute for earning a trophy."
  - "Climbing though throwaway tiers en-route to the gear you want to build around isn't aspirational."
  - Updates 9.0-9.1.5 were reported as speeding up rewards, improving drop rates and removing Power gaps between friends.
  - [The Game Post](https://thegamepost.com/bungie-edge-of-fate-was-the-wrong-path-destiny-2-power-tier-grind/); original: [bungie.net, Renegades Content Calendar](https://www.bungie.net/7/en/News/Article/d2renegades_contentcalendar)
- **Edge of Fate numbers** [SNIPPET; sources conflict]:
  - Everyone reset to Power 10, with a base cap of 200.
  - The seasonal cap is reported as 450 by some guides and 400 by others (later 500/550).
  - Seasonal Power stopped resetting.
  - [Gfinity](https://www.gfinityesports.com/article/destiny-2-what-are-the-edge-of-fate-power-level-caps); [Sportskeeda](https://www.sportskeeda.com/mmo/new-power-leveling-explained-destiny-2-the-edge-fate)
- **Pre-2025 Destiny 2 Power** [not re-verified; guides]: Power is the average of equipped gear, with soft/powerful/pinnacle caps (e.g. 1,750 / 1,800 / 1,810 in Lightfall). Below the soft cap ordinary drops raise you; above it only weekly Powerful and Pinnacle rewards do.
  - [GGRecon](https://www.ggrecon.com/guides/destiny-2-power-cap-reach-quickly); [High Ground Gaming](https://www.highgroundgaming.com/destiny-2-power-level-guide/)
- **Diablo III Loot 2.0 (patch 2.0.1, Feb 2014)** [SNIPPET or secondary; diablowiki returned 403 and the Blizzard blog URL returned nothing]:
  - Fewer drops with better stats.
  - "Smart Drop" biases rolls toward the finder's class (Shacknews: it "attunes drops to the classes that find them").
  - A greatly raised legendary drop rate.
  - Game director Josh Mosqueira, as quoted in fan-wiki summaries: players "are going to get fewer items, so we have to make sure they're the right items". Not verified verbatim.
  - [Shacknews](https://www.shacknews.com/article/83266/diablo-3-patch-201-deploys-with-loot-20); [Game Informer](https://www.gameinformer.com/b/features/archive/2014/02/28/five-reasons-to-return-to-diablo-after-patch-2-0-1.aspx); [Diablo Wiki](https://di.diablowiki.net/Loot_2.0)
- **Loot 2.0 criticism** ("worked too well", builds finished early, Ancient items added as a further tier) [not re-verified; forum opinion]: [Blizzard forums](https://us.forums.blizzard.com/en/d3/t/d4-how-much-randomness-is-too-much/49525). No primary Blizzard statement of this criticism was found. Treat it as player opinion.
- **Schreiber on loot pacing** [PRIMARY]:
  - Random drops are "tied to the deliberate player action of defeating enemies, so the player is rewarded but on a random schedule."
  - "you can play around with 'randomness' here, for example by having your game track the time between rare loot drops, and having it deliberately give a big reward if the player hasn't seen one in awhile."
  - "many little gains produce a lot more happiness than one big gain ... Giving too many big rewards in a small space of time diminishes their impact."
  - [Schreiber, Level 7](https://gamebalanceconcepts.wordpress.com/2010/08/18/level-7-advancement-progression-and-pacing/)
- **Elden Ring stat requirements** [not re-verified; guide-level]: [Game8](https://game8.co/games/Elden-Ring/archives/457799)

### Inferences
- Bungie's lesson maps directly onto drops in Corrupted Raids. With ~0.08-0.15 drops per viewer per run (AGENTS.md §4), each drop is rare enough that it has to be worth wearing, not a slightly-better tier to be thrown away later.
- Schreiber's pity-timer note is a ready, simple answer to "a viewer went three nights with nothing".
- If gear is the main axis, Level should *feed* gear. Gates are on points spent, so a level-up that visibly opens a new gate ("you can now wear X") ties the two loops together. The D4 note says this outright: levels exist to get you to gear faster.

### Gaps
- No primary Blizzard Loot 2.0 design post could be read.
- No source compares level-gated, stat-gated and ungated gear on player satisfaction.

## 4. Progression legibility and motivation: goal gradient, endowed progress, SDT, shared bars

### Takeaway
Both loyalty-card studies are now checked: Kivetz et al. against the original PDF, Nunes & Drèze against the official abstract. People speed up as a goal nears, start faster when given a head start, and slow down right after a reward. A field study of Kickstarter extends the pattern to a *collective* progress bar and finds an important difference: contributions fall after the shared goal is reached.

### Cited Findings
- **Kivetz, Urminsky & Zheng (2006)**, "The Goal-Gradient Hypothesis Resurrected", *Journal of Marketing Research* XLIII (Feb 2006): 39-58 [PRIMARY]:
  - Café programme ("buy ten coffees, get one free"): "The mean difference between the first and the last observed interpurchase times was .7 days (t = 2.6, p < .05), representing an average acceleration of 20%."
  - Mean card completion was 24.6 days, against 29.4 days at the first-purchase rate: "nearly 5 days (16%)".
  - Illusionary progress field experiment (10-stamp card vs 12-stamp card with 2 "bonus" stamps): the control group completed the ten purchases "in 15.6 days. In contrast, customers in the experimental (illusionary goal progress) condition completed the ten required purchases ... in only 12.7 days, nearly three days or 20% faster (t = 2.0, p < .05; medians = 15 versus 10 days)."
  - Also: "purchase and effort rates reset (to a lower level) after the first reward is earned and then reaccelerate toward the second reward goal" (postreward resetting, analysed on 110 members who completed a first card).
  - Also: "people's tendency to accelerate toward their first reward predicts a greater probability of retention and faster reengagement."
  - The finding generalises to online song-rating: more visits, more ratings per visit, more persistence near the reward.
  - [Columbia Business School PDF](https://business.columbia.edu/sites/default/files-efs/pubfiles/1200/goalgradient.pdf)
  - **[CORRECTED, wording only]** The 20% figure compares the first and last *observed* interpurchase time, and the paper calls it "average acceleration". The earlier summary was right in substance.
- **Nunes & Drèze (2006)**, "The Endowed Progress Effect: How Artificial Advancement Increases Effort", *Journal of Consumer Research* 32(4): 504-512 [PRIMARY for the abstract via RePEc; the body was unreachable]:
  - "By converting a task requiring eight steps into a task requiring 10 steps but with two steps already complete, the task is reframed as one that has been undertaken and incomplete rather than not yet begun. This increases the likelihood of task completion and decreases completion time. The effect appears to depend on perceptions of task completion rather than a desire to avoid wasting the endowed progress. Moderators include the reason, if any, offered for the endowment and the currency in which progress is recorded."
  - [IDEAS/RePEc abstract](https://ideas.repec.org/a/oup/jconrs/v32y2006i4p504-512.html)
  - The 300 car-wash cards and the 34% vs 19% completion remain [SNIPPET]. They are consistent across several secondary summaries but were not checked against the paper body (USC PDF: expired certificate). [Coglode](https://coglode.com/nuggets/endowed-progress-effect)
- **Kuppuswamy & Bayus (2017)**, "Does my contribution to your crowdfunding project matter?", *Journal of Business Venturing* 32(1): 72-89 [PRIMARY abstract; new this pass]:
  - "because perceptions of impact are positively related to goal proximity, we predict that support for a crowdfunding project will increase as the project funding approaches its target goal ... because motivation decreases after a goal is attained, we further predict that crowdfunding contributions will significantly decrease after the target goal is reached. We find strong support for these hypotheses from a large-scale field study involving Kickstarter."
  - The effect is "accentuated if the project is nearing its funding deadline, if the target goal is relatively small, or if the project has limited early support."
  - [IDEAS/RePEc](https://ideas.repec.org/a/eee/jbvent/v32y2017i1p72-89.html)
  - A related summary of the same authors' Kickstarter work reports a *bystander effect*: "backer support is negatively related to its past backer support", and that effect diminishes near the deadline. [Yannig Roth summary (secondary)](https://yannigroth.com/2013/02/24/the-dynamics-of-backer-support-in-crowdfunding-findings-from-kickstarter)
- **Ryan, Rigby & Przybylski (2006)**, "The Motivational Pull of Video Games: A Self-Determination Theory Approach", *Motivation and Emotion* 30: 347-363 [PRIMARY]:
  - Four studies. Studies 1-3 are lab studies with undergraduates (e.g. n = 89, n = 50). Study 4 is a survey of 730 MMO players.
  - "perceived in-game autonomy and competence are associated with game enjoyment, preferences, and changes in well-being". In Study 4, "autonomy, competence, and relatedness independently predict enjoyment and future game play."
  - On competence: "factors that enhance the experience of competence, such as opportunities to acquire new skills or abilities, to be optimally challenged, or to receive positive feedback enhance perceived competence, and, in turn, intrinsic motivation."
  - [University of Rochester PDF](https://www.rochester.edu/warner/lida/wp-content/uploads/2022/11/02bfe513dd59366750000000.pdf)
- **Schreiber on reward timing** [PRIMARY]:
  - "Giving too few rewards, or spacing them out for too long so that the player goes for long stretches without feeling any sense of progression, is usually a bad thing."
  - "you do need to make sure the player notices you're rewarding them."
  - He calls the "random reward schedule" "more powerful than a fixed schedule", provided the rewards are linked to deliberate player action.
  - [Schreiber, Level 7](https://gamebalanceconcepts.wordpress.com/2010/08/18/level-7-advancement-progression-and-pacing/)

### Inferences
- A bar that fills every run never has a "nearly there" phase. Goal gradient puts effort and attention at the end of the bar, so the bar should span enough runs that chat can see a run-up. Kuppuswamy & Bayus suggest a *small, near* goal sharpens this.
- Postreward resetting in both the café data and the Kickstarter data means engagement dips right after a level-up. Endowed progress is the counter: carry overflow XP, or grant a small head start on the next bar, framed with a reason ("first run of the night bonus"). Nunes & Drèze found the reason given is a moderator.
- The bystander result is the one caution for **shared** bars. If a whole-chat goal is fed by everyone, each viewer's contribution feels smaller the more others have already given. Per-viewer bars stay personal; any communal bar is best kept small and time-boxed (one stream), which is where the effect was weakest.
- None of these are game studies except Ryan et al. Carrying the loyalty and crowdfunding results over to XP bars is an inference, though a widely made one.

### Gaps
- No peer-reviewed study of game XP bars watched by a live audience, or of Twitch-integrated game progression, was found.
- The car-wash percentages remain unverified against the paper body.

## 5. Concrete pacing guidance for short-session games, and the Corrupted Raids proposal

### Takeaway
There is still no published numeric standard such as "N minutes per level". The sourced guidance is qualitative but consistent:
- Early thresholds must be reached quickly (Luban).
- Each step takes slightly longer than the last (Schreiber).
- There must be no long stretch without a noticed reward (Schreiber).
- Levels should exist to speed the player towards gear (Blizzard, D4).

That converts cleanly into a runs-per-level target for Corrupted Raids, sketched below. The numbers are the researcher's calculations.

### Cited Findings
- Luban: "If it takes too much time for players to reach early thresholds, you are going to loose them. Thus, you must estimate the progression speed of players." [PRIMARY] [Game Developer](https://www.gamedeveloper.com/design/quantitative-design---how-to-define-xp-thresholds-)
- Schreiber: each level or area should take "a little bit longer than the last", so the player is "moving ahead more rapidly at the start of the game when they haven't become as emotionally invested". [PRIMARY] [Schreiber, Level 7](https://gamebalanceconcepts.wordpress.com/2010/08/18/level-7-advancement-progression-and-pacing/)
- Blizzard (D4): levels changed "with the intent of getting you to endgame activities and gear at a more rapid pace". [PRIMARY] [Blizzard News](https://news.blizzard.com/diablo4/24130178)
- **Battle-pass analogues** [SNIPPET / low-weight guides]: Fortnite runs ~100 tiers over ~10 weeks and Call of Duty ~100 over ~8 weeks, i.e. about 10-12 tiers a week. One guide argues that under 50 tiers finish too fast. [Abratabia guide (low weight)](https://abratabia.com/game-economy/battle-pass-design.php)
- **Adams & Dormans, *Game Mechanics: Advanced Game Design*** [READ, table of contents only]: has a chapter "11 Progression Mechanisms" (lock-and-key mechanisms, emergent progression). No excerpt on curve numbers was reachable. [Designer's Notebook TOC](https://designersnotebook.com/Books/Game_Mechanics/game_mechanics.htm)

### Inferences: worked proposal (researcher's calculations, not sourced)
**Cadence assumed:** 5-20 runs per viewer per day, 5 days a week, so about 25-100 runs a week (mid ≈ 60). XP per run ≈ 110, as in the alpha.

**Proposal: 50 levels, defined in runs.** runs_per_level(L) = min(25, 3 + 0.5·(L−1)), and XP_to_next(L) = runs_per_level(L) × 110.

| Level reached | Runs for that level | Cumulative runs | XP to next |
|---|---|---|---|
| 2 | 3 | 3 | 385 |
| 5 | 4.5 | 15 | 550 |
| 10 | 7 | 45 | 825 |
| 20 | 12 | 142 | 1,375 |
| 30 | 17 | 290 | 1,925 |
| 40 | 22 | 488 | 2,475 |
| 50 | 25 (cap) | 730 | 2,750 |

- Total ≈ 730 runs: ~7 weeks at 100 runs/week, ~12 at 60, ~29 at 25.
- The first night (~10-15 runs) gives 2-4 level-ups. After that it is about one level per night, stretching to roughly 2-3 nights per level at the top. No level ever takes more than 25 runs.
- If the year-long target in AGENTS.md must stay, a post-cap track carries it rather than more identical levels. A variant with cap 30 and slope 0.6 gives ~850 runs, which is about a third of the old ~2,920.

**Points per level: 5 keeps gear gates on schedule.** Gear gates read points spent (`4 × tier depth`), so the pace that matters is points per run, not levels per run. Cumulative points after N runs, current (2/level) against the proposal (5/level):

| Runs | Current | Proposal |
|---|---|---|
| 15 | 28 | 20 |
| 45 | 54 | 45 |
| 100 | 84 | 75 |
| 142 | 102 | 90 |
| 290 | 150 | 145 |
| 488 | 198 | 195 |
| 730 | 244 | 245 |

- The proposal tracks today's gate pace within ~10% from about run 45 onwards, so **the gear catalogue's gates need no re-tuning**.
- It is ~30% slower on the first night. A one-time level-1 grant of +5 to +10 closes that, and it doubles as an "endowed progress" head start.
- At the top it stops at 245 points instead of creeping on to 598 by level 300. Any gate above ~245 points becomes unreachable, so check the catalogue before adopting.

**Make each level visible.** Following the WoW and D4 precedents, each level-up shows what it opened: "you can now wear X", a slot, a cosmetic, or the next shop tier. A level should never be an invisible +2.

**Bar presentation** (goal gradient and endowed progress):
- Carry overflow XP into the next bar.
- Show "N runs to next level" rather than raw XP. Runs are the unit chat understands.
- Optionally grant a small, explained first-run-of-the-night bonus.

**Gear as the main axis:** ~1 drop per viewer per night (AGENTS.md §4) is in line with Loot 2.0's "fewer, right items". Add role-weighted ("smart") rolls and Schreiber's pity counter so no viewer goes several nights without an upgrade.

### Gaps
- No GDC talk, postmortem or paper giving target minutes or sessions per level for 10-60 minute session games was found. The table above is derived, not sourced.
- Twitch-integrated games' progression pacing (e.g. Stream Raiders) was not researched in this pass.
- Schreiber & Romero's *Game Balance* (2021 book) was not accessible. Only Schreiber's free 2010 course, its precursor, is represented.
