# Difficulty Scaling for Variable-Size Groups, DDA, and Flow (for a shared, auto-resolved fight with late joiners)

Research method note: web search worked, but fetching full pages was blocked for most primary hosts in this session (warcraft.wiki.gg, users.cs.northwestern.edu, arxiv.org, ncbi.nlm.nih.gov all failed DNS resolution). Every finding below therefore comes from search-result abstracts and excerpts, not full-text reads. Where a figure came from a fan wiki or a forum, it says so. Anything I could not source is in Gaps rather than stated as fact.

Corrupted Raids context, for reference: the level (1-6) is chosen from the party's mean power and re-read on every join during the gathering window. Headcount scales the enemy separately (+5% HP per member past five, +65% attack per doubling, clamped 0.4x-6x). The proposal under study is to lock difficulty earlier and let turnout raise reward instead.

## 1. How commercial games scale group content by player count and power, and when they lock difficulty

### Takeaway
Most co-op games scale enemy health, and sometimes reward, with headcount, using a smooth rule that grows more slowly than the group's added power. Several of them have had to retune that rule after players found it unfair, usually in small groups. When the difficulty TIER is set, it is almost always chosen before the activity starts (difficulty select, keystone, hazard level) and then fixed. Live, mid-activity adaptation exists mainly as pacing (Left 4 Dead's Director), not as tier changes. Diablo II is the clearest precedent for "more people means more reward as well as more HP".

### Cited Findings
**Diablo II (/players and real headcount)**
- From v1.10 on, monster HP scales as X × (n+1)/2 with player count n, and experience uses the same formula. Versions 1.00-1.08 used X × (2n+1)/3 for experience. — [Diablo Wiki: Player Settings](https://diablo2.diablowiki.net/Player_Settings); [Diablo Wiki: Experience](https://diablo2.diablowiki.net/Experience)
- Player count also raises drop frequency and amount. For unpartied players and for `/players X`, only every second extra player changes the drop rate (steps at players 3, 5 and 7). — [Diablo Wiki: Player Settings](https://diablo2.diablowiki.net/Player_Settings)
- As of v1.11, `/players` accepts 1-8. — [PureDiablo: Players X Overview](https://www.purediablo.com/?p=6422)
- Conflict: one guide claims XP does not change with the players setting in D2R. The wiki and speedrun.com both disagree. — [ExpertBeacon](https://expertbeacon.com/how-does-players-8-work-in-d2r/) vs [speedrun.com D2R guide](https://www.speedrun.com/d2r/guides/h9fk4)

**Diablo III**
- Patch 1.0.8 (2013) cut co-op monster HP from +70% to +50% per extra player. Two players face 150% of solo HP, three face 200%. — [Engadget, 2013-04-03](https://www.engadget.com/2013-04-03-diablo-iii-gets-massive-multiplayer-improvements-in-1-0-8.html)
- Before that, the per-player multiplier depended on difficulty (75/85/95/110% in 1.0.3). The 1.0.4 preview planned a flat 75%. — [Ubergizmo, 1.0.4 preview](https://www.ubergizmo.com/2012/08/diablo-3-patch-1-0-4-preview/amp/)
- "Monster Power" was a separate, player-chosen difficulty dial (set before entering) that weighted monster health much more heavily than monster damage. — [GameBanshee: Intro to Monster Power](https://gamebanshee.com/wh9d)

**Diablo IV**
- In World Tiers III/IV, level scaling trails at most 5 levels above or below the player. World bosses scale to the average level of the instanced party on World Tier 4. — [Game8](https://game8.co/games/Diablo-4/archives/415872)
- Party members get double the nearby-player XP bonus. — [Game8](https://game8.co/games/Diablo-4/archives/415872)
- I found no source for D4's per-player health multiplier (see Gaps).

**World of Warcraft: Flexible raids and Mythic+**
- Flexible raids scale to 10-30 players, adjusting difficulty to how many are in the raid when the boss is engaged. Flex arrived in 5.4 (10-25 players) and was extended to Raid Finder, Normal and Heroic in 6.0.2. Mythic stays fixed at 20. — [Warcraft Wiki: Flexible Raid](https://warcraft.wiki.gg/wiki/Flexible_Raid) (search excerpt only); [Engadget, 2013-06-07](https://www.engadget.com/2013-06-07-flexible-raids-come-to-world-of-warcraft-with-patch-5-4.html)
- Blizzard's stated principle, as reported: boss health and damage grow more slowly than raid throughput, which slightly favours larger groups. — [Warcraft Wiki: Flexible Raid](https://warcraft.wiki.gg/wiki/Flexible_Raid) (search excerpt)
- Some mechanics change at set player counts rather than smoothly (for example, fewer chains at 10 players than at 30). — [Blizzard EU forum: scaling breakpoints](https://eu.forums.blizzard.com/en/wow/t/scaling-in-raids-where-is-the-breakpoints/271435)
- Blizzard later announced "flex difficulty smoothing" to remove the bumps in flex scaling. — [Engadget, 2013-12-10](https://www.engadget.com/2013-12-10-flex-difficulty-smoothing-coming-soon.html)
- Mythic+: a fixed 5-player dungeon whose run is set by the keystone activated at the Font of Power. Affixes depend on key level and rotate weekly. Deaths cost timer time (5s, rising to 15s at +12). The key's level moves AFTER the run (finishing over time downgrades it by 1). — [Warcraft Wiki: Mythic Plus](https://warcraft.wiki.gg/wiki/Mythic_Plus); [wow.gg M+ guide](https://wow.gg/guides/mplus); [Raider.IO M+ 101](https://raider.io/news/51-mythic-plus-101-what-to-know-for-your-first-keystone)
- Sources disagree on the affix thresholds (levels 4/7/10 vs 2/5/10). The 2/5/10 figures reflect the 11.1.0 squish. — [Warcraft Wiki: Mythic+ affix](https://warcraft.wiki.gg/wiki/Mythic%2B_affix)

**Monster Hunter World**
- Fan wiki: two hunters face about 150% of solo HP, and three or four face about 220-260% depending on the monster. — [Fextralife MHW Multiplayer](https://monsterhunterworld.wiki.fextralife.com:443/Multiplayer)
- Players dispute the commonly quoted "2.6x for 2-4 players". Some say three and four players share one multiplier. Capcom has not published the figures. — [Steam discussion](https://steamcommunity.com/app/582010/discussions/0/1735462352482827576)
- World used two HP tables, one solo and one multiplayer, and some two-player hunts were reported as unusually hard. — [KitGuru](https://www.kitguru.net/page/617/!https:/www.kitguru.net/gaming/matthew-wilson/monster-hunter-world-is-getting-a-proper-dynamic-difficulty-system/)
- Design relevance: as I understand MHW, the multiplayer HP table applies once a second hunter joins, so a late joiner makes the monster tougher. This is the same complaint Corrupted Raids has. I could not verify the exact join-time behaviour from a primary source (see Gaps).

**Helldivers 2**
- Difficulty is chosen before the mission launches, and one guide says it does not scale with friends. — [GGRecon](https://www.ggrecon.com/guides/helldivers-2-difficulty-scaling-more-players/)
- Patrol spawns DO scale with player count. In 2024 Arrowhead made the scaling linear, so a solo player now gets 1/4 of a four-player squad's patrols instead of about 1/6. The stated aim was to make 1-2 player lobbies feel less empty. Players widely called solo and duo much harder afterwards. — [PCGamesN: patrol changes](https://www.pcgamesn.com/helldivers-2/patrol-changes); [GameWatcher](https://www.gamewatcher.com/news/helldivers-2-players-arent-happy-with-patchs-changes-to-solo-patrol-spawns)

**Deep Rock Galactic**
- The difficulty multipliers (enemy resistance by size class, and enemy count) are set by the Hazard Level the team picks before the mission AND by the number of players. — [DRG Wiki: Difficulty Scaling](https://deeprockgalactic.wiki.gg/wiki/Hazard)
- An older wiki stub claimed player count does not affect resistance and gave legacy effective-health values of 3.5 (Hazard 1) to 6.0 (Hazard 4-5). It looks outdated, and the current table could not be read. — [DRG Fandom: Glyphid Spawn (old)](https://deeprockgalactic.fandom.com/wiki/Glyphid_Spawn?oldid=7710)

**Destiny 2**
- Bungie's 2018 goal for Nightfalls was that fireteams of any size, solo included, could take part. — [Destiny 2 Update 2/27/2018 (Bungie)](https://www.bungie.net/en/Explore/Detail/Update/46666)
- A 2023 hotfix reduced enemy health in Legend/Master activities and specifically reduced health scaling for 2- and 3-player fireteams in one exotic mission. So fireteam-size health scaling exists in at least some activities. — [GamingBolt](https://gamingbolt.com/destiny-2-hotfix-nerfs-enemy-health-in-legend-and-master-activities)

**Left 4 Dead (AI Director)**
- Mike Booth's Director changes pacing, difficulty and atmosphere during play. His stated ideal is survivors barely reaching the next saferoom. — [Wikipedia: Left 4 Dead](https://en.wikipedia.org/wiki/Left_4_Dead); [Wikipedia: Mike Booth](https://en.wikipedia.org/wiki/Mike_Booth)
- Valve documents the pacing states BUILD_UP → mob spawn → SUSTAIN_PEAK → RELAX → BUILD_UP. Mobs spawn only in BUILD_UP, which lasts at least 15s by default. Peak lasts SustainPeakMinTime-MaxTime (examples use 5-10s). Relax begins only once every survivor's intensity drops below a threshold (default 0.99). — [Valve Developer Wiki: L4D2 Director Scripts](https://developer.valvesoftware.com/wiki/L4D2_Director_Scripts); [Valve Dev Wiki (zh): Director Scripts](https://developer.valvesoftware.com/wiki/Zh/Left_4_Dead_2/Scripting/Director_Scripts)
- A Game Developer analysis argues the Director is really pacing control rather than DDA in the strict sense. — [Game Developer: The Discomfort Zone](https://www.gamedeveloper.com/design/the-discomfort-zone-the-hidden-potential-of-valve-s-ai-director)

### Inferences
- The common pattern is to set the TIER at entry and fix it, and to let headcount move only continuous parameters (HP, spawn count), usually sub-linearly. Diablo III picks the tier by difficulty select or Monster Power, Mythic+ by the keystone, DRG by Hazard and Helldivers by the mission dial. Corrupted Raids already follows this for headcount (`partyScaling`). Re-picking the *level* on every join is the outlier.
- WoW Flex samples headcount at the moment the boss is engaged, which is effectively "lock at start". Blizzard also deliberately lets enemy scaling trail group throughput so that bringing more people is rewarded. Corrupted Raids' +65% attack per doubling is sub-linear for the same reason.
- Diablo II is a direct precedent for the proposal: one headcount number raises HP AND XP by the same factor, and raises drops in steps. Both risk and reward scale with turnout, and players read "/players 8" as "harder but more loot".
- The Helldivers 2 and Diablo III retunes show that scaling-by-count complaints cluster at the small and mid end (solo, duo), where one person is a large share of the group. In Corrupted Raids, one late joiner shifts the mean most when the group is small.

### Gaps
- No primary source for WoW Flex per-player boss-health percentages (only that health trails throughput). warcraft.wiki.gg could not be fetched.
- No source for Diablo IV's per-player monster HP multiplier.
- No primary source for Vermintide 2 / Darktide scaling by player count or for how bots fill empty slots. Not searched, for lack of budget.
- No source on what happens when someone joins mid-mission (Helldivers 2 drop-in, MHW SOS flares, DRG late join): whether the multiplier updates live or only applies on next spawn. This is the closest analogue to the late-joiner complaint and remains unconfirmed.
- No confirmed exact DRG per-player-count resistance table (the wiki table was garbled in extraction).

## 2. What academic DDA research finds, and whether visible or announced adjustment harms fairness or enjoyment

### Takeaway
Academic DDA (Hamlet, Polymorph, Missura & Gärtner) is mostly about invisible, gradual, individual-scale adjustment that keeps a player near a target challenge, and it stresses stability. The evidence on visibility is mixed but useful. Telling players a game adapts tends to RAISE immersion, even when it does not adapt (Denisova & Cairns). DDA can make players overconfident (Constant & Levieux). Developers say adjustment that players can SEE as rule-bending in-play (rubber-banding) reads as unfair. What hurts is an adjustment that looks like the rules changing against the player mid-play, not the fact of adjustment.

### Cited Findings
- **Hunicke & Chapman, "AI for Dynamic Difficulty Adjustment in Games" (Hamlet, ~2004, built on the Half-Life engine).** Hamlet treats difficulty as an inventory supply/demand problem. Its reactive changes alter NPC accuracy and damage. Its proactive changes alter NPC health and damage *before spawn*. The paper stresses intervening only as needed, so that behaviour stays relatively stable and predictable over time. — [Hunicke & Chapman PDF](https://users.cs.northwestern.edu/~hunicke/pubs/Hamlet.pdf) (search excerpt); [Wikipedia: Dynamic game difficulty balancing](https://en.wikipedia.org/wiki/Dynamic_game_difficulty_balancing)
- **Jennings-Teats, Smith & Wardrip-Fruin, "Polymorph" (PCG workshop / AIIDE 2010).** A 2D platformer that generates the next level sections ahead of the player, using a difficulty model learned from players rating short segments (over 2,000 playthroughs in a few days). Difficulty changes in the content *not yet reached*, never under the player's feet. — [AIIDE 2010 paper](https://ojs.aaai.org/index.php/AIIDE/article/view/12417); [PCG workshop PDF](https://www.pcgworkshop.com/archive/jennings-teats2010polymorph.pdf); [UCSC EIS blog](https://eis-blog.soe.ucsc.edu/2010/04/dynamic-difficulty-in-platformers/)
- **Missura & Gärtner.** DS 2009 clusters players into types from short gameplay traces and predicts the type. NeurIPS 2011 ("Predicting Dynamic Difficulty") treats DDA as online learning that finds a setting neither too easy nor too hard, with a bound on wrong settings relative to the best static setting in hindsight. Missura's thesis reports that predicted adjustments matched players' preferences in a self-built game. — [Springer DS 2009](https://www.springerprofessional.de/en/player-modeling-for-intelligent-difficulty-adjustment/3212732); [NeurIPS 2011](https://papers.nips.cc/paper/4302-predicting-dynamic-difficulty); [Missura thesis, Bonn](https://bonndoc.ulb.uni-bonn.de/xmlui/handle/20.500.11811/6543?show=full)
- **Zohaib (2018), "Dynamic Difficulty Adjustment (DDA) in Computer Games: A Review", *Advances in Human-Computer Interaction*, Hindawi article 5681652.** A survey of DDA approaches. Later work cites it for the variety of adaptive systems and the need for more empirical testing across genres. Citations give conflicting page ranges. — [IntechOpen chapter citing it](https://www.intechopen.com/online-first/1228576). I could not read the review's own content.
- **Constant & Levieux, "Dynamic Difficulty Adjustment Impact on Players' Confidence", CHI 2019 (DOI 10.1145/3290605.3300693).** An in-game betting measure across three games (logical, motor, sensory difficulty) compared random difficulty with DDA. Result: "DDA systems can lead players to high level of overconfidence". The authors suggest this may be part of why DDA improves experience. — [CNAM record CL19](https://cedric.cnam.fr/index2.php/publis/article/CL19). Sample sizes and effect sizes were not confirmed.
- A 2025 VR eye-tracking DDA study found the opposite bias (players chose easier levels than the model set). It attributes the difference to the betting incentive in Constant & Levieux. — [arXiv 2512.17882](https://arxiv.org/pdf/2512.17882)
- **Denisova & Cairns: the placebo effect of adaptation.** CHI PLAY 2015: players NOT told about a performance-adjusted timer found the game more immersive. *Entertainment Computing* 2019: across two studies and two games, players told the game adapts felt more immersed whether or not adaptation was present, and the effect persisted in longer sessions. The authors suggest developers may not need to fear telling players about adaptation. — [Denisova CHI PLAY 2015 PDF](https://www-users.york.ac.uk/~pc530/pubs/Denisova_CHIPLAY15.pdf); [White Rose eprint 139704](https://eprints.whiterose.ac.uk/id/eprint/139704/); [City Research Online 21352](https://openaccess.city.ac.uk/id/eprint/21352)
- Press summary (secondary source): 21 volunteers played *Don't Starve* twice, told one session was "adaptive", and many rated that session harder. — [Inverse](https://inverse.com/article/6944-study-finds-gamers-can-t-tell-adaptive-ai-from-the-placebo-effect)
- **Rubber-banding (designer opinion, not a controlled study).** Black Rock's *Pure* team rejected rubber-banding: "its unfairness is easy to spot" and players "want to feel like they are playing with the same rules as their opponents". — [Game Developer: The Pure Advantage](https://www.gamedeveloper.com/design/the-pure-advantage-advanced-racing-game-ai); [MCV: Black Rock blasts rubber banding](https://www.mcvuk.com/development-news/black-rock-studio-blasts-arubber-bandinga/)
- A 2014 IEEE paper on "circuit-adaptive challenge balancing" (adapting the track instead of opponent speed) balanced challenge in human trials without hurting player experience. — [UvA DARE](https://dare.uva.nl/id/7ca2dc26-d739-487f-9986-04c1c9c48158)

### Inferences
- Hamlet and Polymorph both apply changes *before the encounter* (Hamlet's proactive pre-spawn HP and damage; Polymorph's sections ahead of the player). This supports locking the Corrupted Raids level at a defined moment and applying it to a fight that has not started yet, rather than letting it jump visibly on the banner.
- Corrupted Raids' level jump is visible AND attributable to one specific person (the late joiner), so players experience it as rule-bending, not adaptation. Denisova & Cairns suggest that announcing an adaptation is not harmful in itself. The harm in the complaint more likely comes from a single step that is (a) negative, (b) caused by someone else, and (c) arriving at the last second.
- Constant & Levieux's overconfidence result suggests adaptive systems shift how players judge their own odds. A banner that changes level just before the fight resets those expectations at the worst moment. This is my inference, not a tested finding.

### Gaps
- No controlled study found that specifically compares visible versus hidden difficulty changes in *group* or *spectator* settings.
- Could not read the Hamlet paper body, the Zohaib review or Constant & Levieux's full results (hosts blocked or abstract-only).
- No academic study found on DDA in Twitch, crowd-play or audience-participation games specifically.

## 3. Flow theory, target win rates, challenge versus frustration, and loss aversion

### Takeaway
Flow theory says to match challenge to skill, and Chen adds that players should have *control* over that match. Empirical work supports "intermediate difficulty" and stresses that *meeting expectations* matters to enjoyment. There is no well-sourced universal game win-rate target. The often-quoted 85% comes from machine-learning and learning theory, not from game enjoyment. Corrupted Raids' solver targets of 55-85% are designer choices and do not come from research.

### Cited Findings
- Jenova Chen, "Flow in Games (and everything else)", *Communications of the ACM* 50(4):31-34, 2007, based on his 2006 USC MFA thesis. It advocates player-centric difficulty choices: the player must have control over the activity to reach flow. — [Springer bibliography](https://link.springer.com/chapter/10.1007/978-981-99-8248-6_1); [Wikipedia: Flow (video game)](https://en.wikipedia.org/wiki/Flow_(video_game))
- CHI 2016 (Smeddinck et al.) credits Chen with emphasising personal control and autonomy in difficulty adjustment. — [Smeddinck CHI 2016 PDF](https://www.cs.mcgill.ca/~jeromew/data/COMP766/CHI2016/p5595-smeddinck.pdf)
- Brändle, Wu & Schulz (2025, *Scientific Reports*), "Leveling up fun": people preferred intermediate difficulty in every game tested. Enjoyment also tracked learning progress, how closely difficulty matched expectations, and motivation by success. No win-rate number is given. — [PMC12488971](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12488971/) (abstract only, fetch blocked)
- Churn modelling (arXiv 2008.12937) notes the flow-channel sweet spot but found its data consistent with earlier work in which LOWER difficulty produced the most engagement. — [arXiv 2008.12937](https://arxiv.org/pdf/2008.12937)
- The "85% rule" (an error rate of about 15.87% is optimal for learning) comes from learning-theory and ML work attributed to a University of Arizona team, with some support in human perceptual learning. Applying it to game enjoyment is an extrapolation. — [Newsweek Japan](https://www.newsweekjapan.jp/articles/-/22118); cited in [arXiv 2008.12937](https://arxiv.org/pdf/2008.12937)
- The "70-85% success" Goldilocks zone is a popular-press claim. — [Abandon the Script](https://abandonthescript.beehiiv.com/p/are-we-failing-enough)

### Inferences
- "Difficulty matches expectations" (Brändle et al.) supports a level that is *known before commit and then holds*. A late jump is an expectation violation, and that is exactly what the complaint describes.
- Chen's "control" point fits the idea that a viewer's choice to join should not change the fight for people already in it. Joining should be a choice about one's OWN stake (more reward), not one that imposes risk on others.
- The loss-aversion framing (a jump toward a harder fight feels worse than an equal step easier feels good) is a standard behavioural-economics claim. I found no game-specific source for it in this session, so treat it as plausible but unsourced here.
- For a stream audience, where a wipe is a shared public event, the low-difficulty-engagement finding (arXiv 2008.12937) is a reason not to set default targets near 50%.

### Gaps
- No peer-reviewed game-specific optimal win rate found.
- No sourced study on loss aversion in response to difficulty increases in games.
- Could not access Csikszentmihalyi primary texts or the full Chen thesis this session.

## 4. Group-composition rating (average vs total vs max), and how to keep one strong player from condemning or carrying a weak group

### Takeaway
In PvP matchmaking research, a team's MAX-skill member often predicts outcomes better than the mean. Some shooters (Apex) have used the party's highest rating for premades and the closest average for random squads. That is the opposite of Corrupted Raids' choice, but the context differs: Corrupted Raids is PvE, one shared fight, and its aim is that "the fight matches the room". Diablo IV's world bosses using the party's average level is the closest PvE precedent for averaging.

### Cited Findings
- "Evaluating Team Skill Aggregation in Online Competitive Games" (2021) compared aggregation methods under Elo, Glicko and TrueSkill on over 100,000 matches. In most cases the MAX method did best, i.e. a team's performance is best captured by its strongest member. — [arXiv 2106.11397](https://arxiv.org/abs/2106.11397v1); [PapersWithCode](https://astro.paperswithcode.com/paper/evaluating-team-skill-aggregation-in-online)
- Respawn (Apex Legends, 2023) described premade-trio options such as using the best player's rating or the team average. HIGHEST is reported for Pubs and Ranked in one statement, and closest average for Pubs in another, so the two statements conflict. Respawn also aims to offset the premade advantage. — [EA: Apex matchmaking 2023](https://www.ea.com/en-gb/games/apex-legends/news/matchmaking-2023); [esports.gg](https://esports.gg/news/apex-legends/apex-legends-reveals-recent-matchmaking-changes-with-more-to-come)
- Diablo IV World Tier 4 world bosses scale to the average level of the instanced party. — [Game8](https://game8.co/games/Diablo-4/archives/415872)

### Inferences
- MAX predicts PvP outcomes because a strong player can carry. For PvE fairness, Corrupted Raids' AGENTS.md records the same thing in its own data: one level-150 among fifty level-1s lifts the room a level, and everyone still wins 100%. Mean aggregation therefore under-predicts how strong a carried room is, but in the *safe* direction. Switching to MAX would put newcomers in a fight priced for the veteran, which is the failure the design rejected.
- The late-joiner problem follows from averaging: in a small room, one strong late joiner moves the mean a lot. With n members, a joiner shifts the mean by (r_new − mean)/(n+1). Possible damping that keeps legibility: use the median or a trimmed mean, cap any one member's contribution at k × the room's median, or snapshot the rating at a lock point. These are design inferences, not sourced practice.
- Diablo II gives everyone the same per-headcount reward multiplier. That is a legible alternative to per-member, rating-based scaling.

### Gaps
- No source found on how PvE group-finder systems (WoW LFR item level, FFXIV Duty Finder, Destiny) aggregate power for enemy scaling beyond D4's level average.
- Could not read the arXiv paper's full comparison (which other two methods were tested, and the effect sizes).
- TrueSkill's own team model (team performance as a sum of individual performances) was not confirmed from a fetched source this session.

## 5. Concrete patterns for late-join fairness: difficulty locks, smooth versus step scaling, and reward that scales with turnout

### Takeaway
The industry evidence points to three patterns. (1) Lock the *tier* at a clear commit moment before the encounter (keystone insertion, Hazard select, mission launch, Flex at boss engage). (2) Let headcount move only smooth, sub-linear parameters, and smooth away breakpoints (WoW's "flex smoothing", D3 cutting +70% to +50%). (3) Scale reward with headcount alongside or instead of risk (Diablo II raises XP and drops with players). This supports locking the Corrupted Raids level earlier and moving the turnout incentive to reward.

### Cited Findings
- WoW Flex sets difficulty from the player count when the boss is engaged, and Blizzard later smoothed the step-wise parts of flex scaling. — [Warcraft Wiki: Flexible Raid](https://warcraft.wiki.gg/wiki/Flexible_Raid); [Engadget: flex smoothing](https://www.engadget.com/2013-12-10-flex-difficulty-smoothing-coming-soon.html)
- Diablo III reduced per-player scaling (+70% to +50%) as part of "massive multiplayer improvements" meant to make co-op more attractive. — [Engadget 1.0.8](https://www.engadget.com/2013-04-03-diablo-iii-gets-massive-multiplayer-improvements-in-1-0-8.html)
- Diablo II scales HP and XP by the same (n+1)/2 factor and raises drops at steps of 3/5/7 players. Reward scales with turnout. — [Diablo Wiki](https://diablo2.diablowiki.net/Player_Settings)
- Diablo IV gives party members a doubled nearby-player XP bonus, a reward for grouping. — [Game8](https://game8.co/games/Diablo-4/archives/415872)
- Mythic+ fixes the challenge by the activated keystone and moves it only between runs, based on the outcome. — [Warcraft Wiki: Mythic Plus](https://warcraft.wiki.gg/wiki/Mythic_Plus)
- Helldivers 2, DRG and D3 Monster Power all set the difficulty dial before launch. — [GGRecon](https://www.ggrecon.com/guides/helldivers-2-difficulty-scaling-more-players/); [DRG Wiki](https://deeprockgalactic.wiki.gg/wiki/Hazard); [GameBanshee](https://gamebanshee.com/wh9d)
- L4D's Director varies intensity over time but on a documented, legible cycle (build-up, peak, relax) gated by survivor intensity. It does not jump the tier. — [Valve Dev Wiki](https://developer.valvesoftware.com/wiki/L4D2_Director_Scripts)
- Polymorph and Hamlet's proactive mode apply changes to content not yet encountered. — [AIIDE 2010](https://ojs.aaai.org/index.php/AIIDE/article/view/12417); [Hamlet PDF](https://users.cs.northwestern.edu/~hunicke/pubs/Hamlet.pdf)

### Inferences (concrete options for Corrupted Raids, ordered by simplicity)
1. **Level lock at a fixed point in the gathering window** (for example at T−10s or at half-time). The banner shows "LEVEL 3 — LOCKED". Later joiners enter that level. This is closest to the keystone and Hazard-select pattern, and it is very legible.
2. **Lock-at-start, but with only upward-safe changes:** after the lock, a joiner can only *lower* the level (never raise it), or cannot change it at all. This removes the "someone joined and it got harder" complaint entirely.
3. **Turnout scales reward, not tier:** a flat headcount reward multiplier in the style of Diablo II (for example XP and gold × f(n), stepped like D2's 3/5/7 drop steps so it reads as a few clear tiers), shown on the banner ("12 joined: +30% loot"). Keep the existing sub-linear HP and ATK `partyScaling` (already precedented by WoW Flex and D3), or reduce it. Turnout then visibly pays, and the risk stays smooth.
4. **If live re-reading is kept, damp it:** hysteresis (the level only changes if the new rating clears the threshold by a margin), a trimmed mean, or a cap per member. Precedent: Blizzard smoothing flex breakpoints.
5. **Announce rather than hide.** Denisova & Cairns suggest telling players about adaptation does not harm, and may help, immersion. A lock plus an announcement ("the room's power set the fight at LEVEL 3") is consistent with the evidence and with the project's "measured, legible" design premise.
- Caveat: Corrupted Raids' existing within-level ramps (`squadFor` body count over the first 35% of a level, and the stat multiplier sliding across the level's width) already convert some steps into slopes. The complaint is about the level boundary itself, and a lock addresses it most directly.

### Gaps
- No primary source found on drop-in mid-mission behaviour (Helldivers 2, MHW SOS, DRG, Vermintide). This is the most direct analogue of the late joiner and the biggest remaining hole.
- No player-research data (A/B tests, surveys) found on locked versus live difficulty in co-op games.
- No source for "reward-scales-with-turnout" schemes in Twitch or audience-participation games specifically (for example Marbles on Stream, Stream Raiders). Not searched.
