# Loot and Reward Schedules: drop rates, rarity distributions, reinforcement, pity, delayed reveal, group fairness

Scope note (verification pass, 2026-10-29). This rewrites the first pass of these notes. Each claim was re-opened at its primary source where one could be reached, and quotes are given verbatim where they were checked. `WebFetch` could not resolve hosts in this session, so pages were downloaded with `curl` through the session proxy and read as text. PubMed abstracts came from NCBI E-utilities, and wiki pages came from their MediaWiki API. These hosts were still unreachable: warcraft.wiki.gg, hearthstone.wiki.gg, poewiki.net, purediablo.com/d2wiki and uwspace.uwaterloo.ca were blocked by Cloudflare or Anubis; academic.oup.com and icy-veins.com returned 403; VentureBeat returned 429; and Blizzard's own support page needs JavaScript to render. Claims that rest only on those hosts are marked.

Labels:
- **[Research]**: peer-reviewed or empirical.
- **[Dev]**: a statement by the developer or an official disclosure.
- **[Community]**: a wiki, a forum, or datamined values.
- **[Opinion]**: press or a designer's opinion.

Verification status:
- **VERIFIED**: read at the primary source, or at the developer's own page, in this pass.
- **VERIFIED-SECONDARY**: read in full on a reliable secondary page that cites the primary.
- **UNVERIFIED**: only a snippet or a second-hand account, carried over.

Game state, checked in `content/balance.json` this pass:
- The loot chances are `survivorLootChance` 0.7088, `casualtyLootChance` 0.1418 and `defeatLootChance` 0.0709. The roll then has to pass `mobDropChance` 0.6, and a fight with a boss always passes.
- So the effective chance of an item in a non-boss fight is about **42.5%** for a survivor, **8.5%** for someone who died in a win and **4.3%** for a member of a losing party.
- Note that AGENTS.md §4 still describes survivorLootChance as 0.25. That text is stale against the file.
- Alpha data from the brief: 0.29 drops per viewer per run, a rarity mix of 28% common / 28% uncommon / 33% rare / 11% epic / 0% legendary, and a starter dungeon that drops only commons.
- `economy.lootRecycleRate` is 0.1: a found item recycles for 10% of its value.

**Corrections to the first pass, found in this pass:**
1. Hopson's phrase is "can be a real issue for game designers", not "can be a problem for designers". The line "there is always a reason to be active" describes **variable-interval** schedules. For variable ratio the article says "there's always a reason to go hunting".
2. Larche et al. on rare loot boxes appeared online in 2019 and is in print as *J Gambl Stud* 2021;37(1):141-163. The abstract adds that post-reinforcement pauses are **longer** after rarer boxes.
3. Hearthstone's pity timers were **officially published by Blizzard on 14 March 2023**. They are no longer community-only. Legendary is 5.0% per pack with a 40-pack cap, and epic is 21.0% per pack with a 10-pack cap.
4. Diablo III patch 2.0.1 (Loot 2.0) went live in the Americas on **25 Feb 2014** (Shacknews, dated that day), so the "March 2013" reading in the first pass is wrong. Smart Loot covers 85% of drops, and 15% roll for a random other class.
5. The Diablo III anniversary buff was "+100% chance to find Legendary items" from 15 to 22 May 2014, made permanent on 22 May 2014.
6. The "at the mercy of others" quote from Hazzikostas on master loot is still second-hand. Mein-MMO's report gives different stated reasons: the system was a relic, it was slow and tied to DKP, and it enabled split-raiding.
7. The specific tactic quotes attributed to King & Delfabbro 2018 could not be checked against the editorial's full text.

---

## 1. Reinforcement schedules: what makes a drop feel good versus noise

### Takeaway
A variable-ratio drop with a chance on every action produces the highest and steadiest activity. Hopson, the primary behavioural source, also warns of two things. First, variable ratio is "not necessarily the best", only the most active. Second, a sudden **cut** in the rate of reward is "very punishing" and invites quitting. The neuroscience and loot-box data say the arousal of a reveal scales with how **rare** the item is, not with how many items arrive, and that anticipation itself peaks when the outcome is most uncertain (p ≈ 0.5).

### Cited Findings
- **[Opinion/applied behaviourism, VERIFIED]** John Hopson, "Behavioral Game Design", published 27 April 2001 (Gamasutra, now Game Developer). The author bio says he later became head of User Research at Bungie. Verbatim:
  - On fixed ratio: "First there is a long pause, then a steady burst of activity as fast as possible until a reward is given." Also: "The distinct pause shown under a fixed ratio schedule can be a real issue for game designers. Having a period of time where there is little incentive to play the game can lead to the player walking away." And: "the length of the pause is a function of the size of the ratio."
  - On variable ratio: "participants typically respond with a steady flow of activity at a reasonably high rate… Since it's possible (though unlikely) that the player can gain a life for shooting down only one enemy, there's always a reason to go hunting." Also: "variable ratio schedules produce the highest overall rates of activity… This doesn't necessarily mean they're the best."
  - On behavioural contrast, the lettuce-and-grape chimpanzee example: "reducing the level of reinforcement is a very punishing thing for your players and can act as an impetus for them to quit the game. It needs to be done carefully and gradually… Sudden loss of reward is very aversive and should be avoided when possible."
  - On reward size: "The value of the current reward is compared to the value of the previous rewards. If the current reward is 10 times the last one, it will have a big impact… it's best to avoid sharp changes in the rate of reward."
  - Source: [Game Developer: Behavioral Game Design](https://www.gamedeveloper.com/design/behavioral-game-design)
- **[Research, VERIFIED]** Fiorillo, Tobler & Schultz, "Discrete coding of reward probability and uncertainty by dopamine neurons", *Science* 2003 Mar 21;299(5614):1898-902. Verbatim abstract:
  - Uncertainty "is determined by probability P, being maximal at P = 0.5 and decreasing at higher and lower probabilities."
  - "the phasic activation of dopamine neurons varied monotonically across the full range of probabilities, supporting past claims that this response codes the discrepancy between predicted and actual reward."
  - "In contrast, a previously unobserved response covaried with uncertainty and consisted of a gradual increase in activity until the potential time of reward."
  - It suggests "a possible role for dopamine signals in attention-based learning and risk-taking behavior."
  - The subjects were monkeys. Source: [PubMed 12649484](https://pubmed.ncbi.nlm.nih.gov/12649484/)
- **[Research, VERIFIED]** Larche, Chini, Lee, Dixon & Fernandes, "Rare Loot Box Rewards Trigger Larger Arousal and Reward Responses, and Greater Urge to Open More Loot Boxes", *J Gambl Stud* 2021 Mar;37(1):141-163 (online 2019), doi 10.1007/s10899-019-09913-5. Verbatim abstract:
  - "loot boxes containing rarer items are more valuable, arousing, rewarding and urge-inducing to players, similar to the way slots gamblers treat rare large wins."
  - "the duration of Post Reinforcement Pauses, an index of reward reactivity, are longer for boxes with rarer items."
  - "Boxes containing rarer rewards also trigger larger Skin Conductance Responses and larger force responses."
  - "there was an increase in anticipatory arousal prior to the reveal of loot box rewards."
  - Source: [PubMed 31760581](https://pubmed.ncbi.nlm.nih.gov/31760581/); [PMC7882574](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7882574/)
- **[Research, VERIFIED]** Larche, Musielak & Dixon, "The Candy Crush Sweet Tooth", *J Gambl Stud* 2017 Jun;33(2):599-615.
  - Sixty avid players played for 30 minutes with heart rate, skin conductance level, and subjective arousal, frustration and urge to play recorded.
  - Verbatim: "Near-misses were more arousing than losses as indexed by increased heart rate and greater subjective arousal. Near-misses were also subjectively rated as the most frustrating of all outcomes. Most importantly, of any type of outcome, near-misses triggered the most substantial urge to continue play."
  - Source: [PubMed 27435416](https://pubmed.ncbi.nlm.nih.gov/27435416/)
- **[Research, UNVERIFIED in this pass]** These are carried over from the first pass and not re-opened:
  - A 2014 *International Journal of Serious Games* study found variable ratio better than fixed ratio on its outcome measures ([DOAJ](https://doaj.org/article/764b0a333c784a75ab006371c560e178)).
  - Kao (2012, Princeton TR) reports that variable ratio "may not be preferred" in a video game, meaning that a high response rate is not the same as preference ([Princeton TR](https://www.cs.princeton.edu/techreports/2012/931.pdf)).
  - Yee's motivation model treats "Advancement" (accumulating resources) as one Achievement subcomponent ([DiGRA 2005](https://dl.digra.org/index.php/dl/article/view/239)).
- **[Dev, VERIFIED]** Blizzard on Diablo IV Season 4, "Loot Reborn" (began 14 May 2024, 10 a.m. PT). Verbatim:
  - "By making items more individually impactful, we've significantly decreased the number of items that drop when slaying Monsters. The goal here is to spend more time obliterating and less time sorting through the many items that drop. The result is that fewer items will drop overall, but those items will be more likely to be valuable."
  - "these Itemization changes persist beyond the Seasonal Realm and affect the Eternal Realm as well."
  - "One of our several goals… is to make it easier to understand which items are upgrades when they drop. We reduced the number of affixes on items (down to 3 on Legendary items, 2 on Rare items)."
  - Source: [Blizzard News: Galvanize your Legend in Season 4: Loot Reborn](https://news.blizzard.com/en-us/article/24077223/)
- **[Opinion, UNVERIFIED]** Player reception was positive; carried over: [Mein-MMO](https://mein-mmo.de/en/diablo-4-imagine-if-it-had-been-like-this-since-release-season-4-excites-players-because-they-can-simply-play-it,1125922/).

### Inferences
- **Magnitude, not count, carries the feel.** Larche measured arousal, urge and the post-reward pause all rising with rarity. A drop that is common at 28% and rare-or-better at 44% (the alpha mix) leaves almost no headroom above "rare", so the system has no "grape" to contrast with its "lettuce". The legendary tier, at 0%, is never shown at all.
- **The streamer's cut-then-raise history is Hopson's contrast effect in miniature.** The 2026-10-26 cut took drops from 0.30-0.62 down to 0.08-0.15 per viewer per run, a sudden loss of reward, and a day later it "felt too stingy". Hopson's rule is that reductions should be gradual. A "less is more" goal is better reached by **steepening the rarity curve** (fewer rare items, a real top tier) than by another sharp cut in item count.
- **The per-run "will I get something" roll is already close to the uncertainty peak.** A survivor has about a 42.5% chance of an item, against Fiorillo's maximum at P = 0.5. That makes the roll itself suspenseful, so there is little to gain from changing its frequency. The lever left is the rarity spread.
- **Near-miss staging should stay out.** Larche 2017 shows that a staged near-miss drives the urge to continue. The reveal can be dramatic without showing what the viewer "almost" got.
- In a shared fight of 10-20 viewers, someone in the chat getting a rare item is a far more frequent event than any one viewer getting one. Keeping individual rare rates low while making a rare item loud on the overlay gives everyone the vicarious hit. This is inference, not sourced.

### Gaps
- No peer-reviewed number for an "ideal" drop frequency in games was found.
- No study directly compares "frequent and small" with "rare and large" loot in terms of enjoyment or retention, as opposed to arousal.
- Kao 2012, IJSG 2014 and the Yee material were not re-verified in this pass.

---

## 2. Rarity distributions in shipped games, and the "fewer, better drops" fixes

### Takeaway
Every system with disclosed odds that was checked has a steep, roughly geometric falloff and a guaranteed floor above the bottom tier in every package.
- Hearthstone, per card, from official 2023 numbers: about 70% common / 25% rare / 4% epic / 1% legendary.
- Genshin, per pull, official: 85.4% / 13% / 1.6% after pity.
- Overwatch: a legendary in 5-7.4% of boxes.

Diablo III and IV both fixed "loot explosion" the same way: fewer items, each worth more, aimed at the finder. Even so, Diablo III later **raised** its top-tier rate when players felt starved. Primary drop tables for Diablo II, Borderlands and Path of Exile could not be reached.

### Cited Findings
- **[Dev, VERIFIED-SECONDARY]** Hearthstone's official odds, published by Blizzard on 14 March 2023 in support article 32545 and quoted in full on the wiki:
  - Normal Legendary: "On average, 5.0% chance… guaranteed to get one within 40 packs."
  - Normal Epic: "21.0% chance… guaranteed… within 10 packs."
  - "Each card pack is guaranteed to contain at least one Normal Rare card or better."
  - "Remaining cards will be Normal Common cards on average of 3.5 cards per pack."
  - Golden Legendary: 0.6% per pack, guaranteed within 361 packs.
  - Sources: [Hearthstone wiki (fandom), Card pack statistics](https://hearthstone.fandom.com/wiki/Card_pack_statistics), citing [Blizzard support 32545](https://us.support.blizzard.com/en/help/article/32545). The Blizzard page itself needs JavaScript and was not rendered.
  - Derived per card, out of 5 cards: common ≈ 70%, epic ≈ 4.2%, legendary ≈ 1.0%, rare ≈ 24.8% (the remainder). This is arithmetic on the official figures.
- **[Dev, VERIFIED-SECONDARY]** Hearthstone's China disclosure of 2017, as reported by PC Gamer:
  - "Every Hearthstone pack will contain at least one card of 'rare' quality or better; 'epic' cards will appear at an average of one every five packs; and 'legendary' cards will turn up at a rate of one every 20 packs."
  - The Chinese text adds that the odds "will increase in tandem as players open more packs", which is the pity timer.
  - Source: [PC Gamer](https://www.pcgamer.com/au/blizzards-chinese-hearthstone-website-confirms-card-rarity-drop-rates)
- **[Dev, VERIFIED-SECONDARY]** Overwatch's China disclosure (May 2017), as reported by Game Informer:
  - "Each Loot Box contains four items… Each loot box has at least one rare, epic, or legendary item. Epic items open, on average, every 5.5 Loot Boxes. Legendary items open, on average, every 13.5 Loot Boxes."
  - That works out to about 18.2% and 7.4% per box.
  - Source: [Game Informer](https://gameinformer.com/b/news/archive/2017/05/05/blizzard-reveals-overwatch-loot-box-probabilities-for-china.aspx)
  - The wiki gives about 18.5% and 7.5%, citing the Chinese site: [Overwatch wiki](https://overwatch.fandom.com/wiki/Loot_Box)
- **[Community, VERIFIED-SECONDARY]** Overwatch's current loot boxes (reintroduced, earned only, "cannot be purchased with any in-game currency or real money"):
  - Per-box rates: common 97.97%, rare 96.26%, epic 21.93%, legendary 5.10%.
  - "an Epic item guaranteed after opening 5 consecutive boxes, and a Legendary item guaranteed after opening 20 consecutive boxes."
  - "if a player receives duplicate items, they get bonus progress towards the next Loot Box."
  - Source: [Overwatch wiki, Loot Box](https://overwatch.fandom.com/wiki/Loot_Box). Not cross-checked against a Blizzard page.
- **[Dev and Community, VERIFIED-SECONDARY]** Genshin Impact's Character Event Wish:

  | Tier | Base rate (official) | Average rate including pity (official) |
  |---|---|---|
  | 5★ | 0.6% | 1.6% |
  | 4★ | 5.1% | 13% |
  | 3★ | 94.3% | 85.4% |

  - "If a player does not obtain any 5★ item after 89 wishes, the 90th wish is guaranteed."
  - The **soft-pity** curve is community-estimated from 9.45M wishes: 0.6% for pulls 1-73, then "0.6% + (X − 73) × 6%" from pull 74.
  - Source: [Genshin wiki, Character Event Wish](https://genshin-impact.fandom.com/wiki/Character_Event_Wish)
- **[Dev, VERIFIED-SECONDARY]** Diablo III Loot 2.0 (patch 2.0.1, live 25 Feb 2014):
  - Shacknews says it "heavily revises Diablo 3's drop system, adding in a new 'Smart Drop' system that attunes drops to the classes that find them… and an across-the-board buff for Legendary items that help make them feel more special."
  - Lead designer Kevin Martens is quoted there as "Kevin Marens": "Legendaries were always supposed to be the best items in the game… Mathematically, we did not make that the case."
  - Source: [Shacknews, 2014-02-25](https://www.shacknews.com/article/83266/diablo-3-patch-201-deploys-with-loot-20)
- **[Community, VERIFIED-SECONDARY]** The Diablo wiki on Loot 2.0:
  - "In a sense, it is replacing quantity with quality, with legendaries becoming rarer, but more effective."
  - "Smart Loot does not affect all loot: 15% of items will be dropped with stats for a random class other than the current one."
  - Source: [Diablo wiki (fandom), Loot 2.0](https://diablo.fandom.com/wiki/Loot_2.0)
- **[Dev, VERIFIED-SECONDARY]** The Diablo III anniversary buff:
  - Engadget: "a 100% boost to the chance to find Legendary items in game… applied from May 15 through May 22. … Blizzard has just made the drop rate increase permanent. … The anniversary buff was overwhelmingly popular."
  - Source: [Engadget, 22 May 2014](https://www.engadget.com/2014-05-22-diablo-3-legendary-drop-rate-increase-now-permanent.html)
- **[Dev, VERIFIED-SECONDARY]** Travis Day's Diablo III target: "the team's goal is to have players find a Legendary item every 90 minutes or so of farming." Source: [FullCleared](https://fullcleared.com/news/diablo-iii-will-internal-legendary-drop-timer/), paraphrasing his post on the official forums.
- **[Dev, VERIFIED]** Diablo IV Season 4 gates the quality floor by difficulty: "Sacred items or higher only drop in World Tier III, and only Ancestral items will appear in World Tier IV." Source: [Blizzard News](https://news.blizzard.com/en-us/article/24077223/)
- **[Dev, VERIFIED-SECONDARY]** Destiny (2014), engrams:
  - Engrams are sealed loot "decrypted" at the Cryptarch. The wiki maps the green engram to "Uncommon or rare", the blue to "Rare or legendary" and the purple to "Legendary or exotic".
  - Update 1.0.2 patch notes: "Legendary (purple) engrams will always produce a Legendary-quality item or higher" and "Rare (blue) engrams will always produce a Rare quality item or higher".
  - The wiki describes the update as addressing "widely-discussed concerns with how engrams were earned."
  - Sources: [Destiny wiki, Engram](https://destiny.fandom.com/wiki/Engram); [Destiny wiki, Update 1.0.2](https://destiny.fandom.com/wiki/Destiny_Update_1.0.2), citing Bungie's patch notes.
- **[Community, VERIFIED-SECONDARY]** Path of Exile:
  - "The game rolls for rarity, in order, starting with: unique, followed by rare, then magic, if none of the other rarities are rolled the item will be normal."
  - "Magic, rare, and unique items found by the player are initially unidentified and a Scroll of Wisdom must be used to discover their properties." This is a built-in delayed reveal.
  - No numeric base rates are published there. Source: [Path of Exile wiki (fandom), Rarity](https://pathofexile.fandom.com/wiki/Rarity)
- **[Community, VERIFIED-SECONDARY]** Borderlands uses the five standard tiers (common white → uncommon green → rare blue → epic purple → legendary orange), with extra tiers in later games such as E-tech, Seraph and Pearlescent. No base drop percentages are given. Source: [Borderlands wiki, Rarity](https://borderlands.fandom.com/wiki/Rarity)
- **[Dev, UNVERIFIED]** Borderlands 3 hotfixes raised legendary drop rates several times, including a temporary boost from 16 to 30 January 2020 and permanent rare-spawn buffs on 30 January 2020, without publishing numbers. These come from search summaries of [EGM](https://egmnow.com/borderlands-3-hotfix-makes-changes-to-loot-drops-and-eridium-rewards/) and [Windows Central](https://windowscentral.com/legendary-weapons-borderlands-3-will-be-much-more-common-until-end-january).

### Inferences
- **The alpha rarity mix is inverted against every reference.** Shipped per-item curves put 70-94% in the bottom tier and about 1-1.6% in the top. The alpha has 44% rare-or-better and an empty top tier.
- A "less is more" curve shaped like the references, per item for five tiers, might be roughly **common 55-65 / uncommon 22-28 / rare 8-12 / epic 2-4 / legendary 0.5-1%**. Following Diablo IV, the **floor** would rise with the dungeon's level rather than the count.
- At 0.29 drops per viewer per run and a 12-run night, a 1% legendary share gives about 0.035 legendaries per viewer per night. With 15 viewers that is about 0.5 a night chat-wide, so the chat sees one about every other night, which is close to Diablo III's "one per ~90 min" cadence for the group. This is arithmetic.
- **A floor above the bottom tier is the one rule every disclosed package shares**: Hearthstone, Overwatch and Genshin's 4★-in-10. The starter dungeon's commons-only table breaks it.
- **"Fewer but better" came paired with targeting both times**: Smart Loot at 85% in Diablo III, and simpler, legible upgrades in Diablo IV. Corrupted Raids' analogue is to bias drops toward gear the viewer's `requires` lets them wear.
- **Diablo III's 2014 reversal is the cautionary half.** After cutting quantity, Blizzard **doubled** legendary drops because the top tier felt too scarce. "Less" means fewer junk drops, not a starved top tier.

### Gaps
- **Diablo II**: the treasure-class and quality-ratio tables (itemratio.txt) are on wikis that block scripted access (purediablo d2wiki, diablowiki). No verified per-kill unique or set odds were obtained. Only the tier order is known: low quality > normal > superior > magic > rare > set > unique, from a [purediablo search snippet](https://www.purediablo.com/d2wiki/Item_quality) (UNVERIFIED).
- **Borderlands**: no official percentages found. **Path of Exile**: no published base rarity rates. **Destiny**: no published engram drop rates.
- No per-kill legendary percentage for Diablo III was found, only the 90-minute target.

---

## 3. Pity timers and bad-luck protection: deterministic versus random, and how probability is perceived

### Takeaway
Shipped pity systems cap the worst streak at about **1-2x the average wait**:
- Hearthstone: legendary at 5%/pack, so a mean of 20 packs, capped at 40.
- Genshin: a mean of about 62 pulls after pity, capped at 90.
- Overwatch today: a legendary guaranteed by 20 boxes.
- WoW Legion: a hidden chance that rises with each miss.

Blizzard's stated principle (Hazzikostas) is that protection exists only for the **unlucky** tail, and the cap that stopped it helping lucky players was removed. Players misread odds in a predictable way: Sid Meier's GDC 2010 keynote said that "players expect to win battles at rates far greater than the odds they face".

### Cited Findings
- **[Dev, VERIFIED-SECONDARY]** Hearthstone's official 2023 caps: Legendary within 40 packs, Epic within 10, Golden Legendary within 361. "Pity Timer counters are tracked individually for each store-bought expansion set." Since Knights of the Frozen Throne (June 2017), "at least one Legendary is now guaranteed within the first 10 packs" of a new set. Source: [Hearthstone wiki (fandom)](https://hearthstone.fandom.com/wiki/Card_pack_statistics)
- **[Dev, VERIFIED-SECONDARY]** WoW Legion's legendary bad-luck protection, in Ion Hazzikostas' forum explanation as quoted by PCGamesN:
  - "As its name suggests, the 'bad luck protection' system exists to protect the unluckiest players from the cruel fate of the dice. Those who were on the other end of the spectrum in terms of good fortune, we figured, didn't need a system to help put them even farther ahead… We drew that line at 4 legendaries, initially… 'Bad luck protection' now applies indefinitely."
  - PCGamesN summarises the mechanism: "every time you complete a task that could reward a legendary and don't get one, your chance of doing so the next time pops up a bit."
  - Source: [PCGamesN](https://pcgamesn.com/world-of-warcraft/wow-legion-legendary-soft-cap-removed)
- **[Dev, VERIFIED-SECONDARY]** The Legion 7.1 developer Q&A, in Blizzard Watch's liveblog paraphrase:
  - "There's no time component to it. It is mostly random. If you log off for a month, you aren't more or less likely to get a legendary when you come back."
  - On why legendaries are random at all: "If these items were just on a vendor where you had to progress toward it, it would seem like a huge grind — you'd be relieved when you got there rather than happy or excited. … legendaries fill the role of a rare item which will cause excitement."
  - Source: [Blizzard Watch, 14 Oct 2016](https://blizzardwatch.com/2016/10/14/legion-patch-7-1-developer-qa-liveblog/)
- **[Dev, VERIFIED-SECONDARY]** Diablo III (Reaper of Souls). Travis Day on the forums, quoted by FullCleared: the system "tracks the amount of time you spend fighting creatures without finding a legendary and after a certain period of time will slowly start increasing the legendary drop rate." FullCleared adds that "it would be impossible for a player to go over 10 hours without seeing one", which is its own inference. Source: [FullCleared](https://fullcleared.com/news/diablo-iii-will-internal-legendary-drop-timer/)
- **[Community, VERIFIED-SECONDARY]** Genshin: hard pity at 90, soft pity from pull 74 (community-measured), and 50/50 carry-over that guarantees the featured character within at most 180 wishes. Source: [Genshin wiki](https://genshin-impact.fandom.com/wiki/Character_Event_Wish)
- **[Community, VERIFIED-SECONDARY]** Overwatch's current boxes: epic guaranteed within 5, legendary within 20, "When one receives an item of Epic or Legendary rarity after opening less than the required amount, their count is reset regardless." Source: [Overwatch wiki](https://overwatch.fandom.com/wiki/Loot_Box)
- **[Dev talk, VERIFIED-SECONDARY for the gist]** Sid Meier's GDC 2010 keynote, "The Psychology of Game Design: Everything You Know is Wrong", reported by a Strong Museum attendee (31 March 2010): good design "sometimes means giving the psychology of the player priority over the reality of the simulation. For example, players expect to win battles at rates far greater than the odds they face." Source: [Strong National Museum of Play](https://www.museumofplay.org/blog/gdc-2010-game-psychology-101/)
  - **UNVERIFIED specifics**: the 3:1 battle example, the Civilization Revolution anger, and gambler's-fallacy behaviour come only from a student report ([Aalborg](https://projekter.aau.dk/projekter/files/202105490/Probability_in_Video_Games.pdf)). VentureBeat's quotes page returned 429, and the GDC Vault video could not be reached.
- **[Opinion]** An example of the perceived-unfairness complaint: "35 packs opened and not a single legendary". Source: [Blizzard forums](https://us.forums.blizzard.com/en/hearthstone/t/35-packs-opened-and-not-a-single-legendary/5297)

### Inferences
- **Ratio template:** cap ≈ 1.4-2x the mean wait. Hearthstone is 40/20 = 2.0, and Genshin is 90/62.5 ≈ 1.4.
- In Corrupted Raids, at 0.29 drops per run, an epic-or-better share of 5% means a mean of 20 chests (about 69 runs, or 5-6 nights). A cap at 40 chests is about 11 nights.
- The long tail is worst for viewers who often die or lose, with effective item chances of 8.5% and 4.3% per run. A per-viewer counter is cheap: the roster persists, but the counter needs a schema field and must survive `parseRoster`.
- **Rising chance (WoW, Genshin soft pity) is a better fit for "simple and legible" than a hard counter alone.** Every chest stays uncertain, and the loadout can show a visible "luck builds" mark.
- **Protect the unlucky only, and never punish a hot streak.** This is the explicit Hazzikostas principle, and WoW removed the cap that went beyond it.
- **No time component, per Legion: count fights joined, not time away.** That keeps pity from turning into "log off and come back" pressure.
- Hazzikostas' "relieved rather than happy" line is a developer's argument for keeping the top tier random and not purchasable. It supports leaving legendaries out of the shop.

### Gaps
- No study was found that measures the effect of pity timers on retention.
- Blizzard support article 32545 itself was not rendered (JavaScript); its numbers are taken from the wiki's quotation of it.
- No citable source was found on "shuffle-bag" or deck-of-cards randomness in shipped loot.

---

## 4. Sealed chests and delayed reveal: anticipation, and the loot-box ethics to avoid

### Takeaway
The research pulls two ways, and the shipped precedents combine them.
- **Immediacy** makes rewards build intrinsic motivation for the activity (Woolley & Fishbach 2018, effect independent of reward size).
- **Uncertainty that is created and then resolved** adds pleasure people do not predict (Ruan, Hsee & Lu 2018; Wilson et al. 2005). Anticipatory arousal rises before a loot reveal (Larche).
- Destiny's engrams and Path of Exile's unidentified items show the **tier at once** and reveal the **contents later**.

Loot-box harm evidence concerns *paid* boxes (Zendle & Cairns explicitly scoped out unpaid openings). Even so, Larche 2023 found that **earners** of Overwatch boxes showed greater gambling-related harms than purchasers, so the absence of money is not a full safe harbour.

### Cited Findings
- **[Research, VERIFIED]** Woolley & Fishbach, "It's about time: Earlier rewards increase intrinsic motivation", *J Pers Soc Psychol* 2018;114(6):877-890. Verbatim abstract:
  - "more immediate rewards increase intrinsic motivation by creating a perceptual fusion between the activity and its goal."
  - "immediacy influenced the positive experience of an activity, but not perceived outcome importance (Study 4)."
  - "the effect of the timing of rewards was independent of the effect of the magnitude of the rewards (Study 5)."
  - Source: [PubMed 29771568](https://pubmed.ncbi.nlm.nih.gov/29771568/)
- **[Research, VERIFIED]** Wilson, Centerbar, Kermer & Gilbert, "The pleasures of uncertainty", *J Pers Soc Psychol* 2005;88(1):5-21.
  - "people's positive moods lasted longer in the uncertain conditions… Forecasters seemed unaware of this paradox; they overwhelmingly preferred to be in the certain conditions."
  - The positive event was "an unexpected gift of a dollar coin".
  - Source: [PubMed 15631571](https://pubmed.ncbi.nlm.nih.gov/15631571/)
- **[Research, VERIFIED]** Ruan, Hsee & Lu, "The Teasing Effect: An Underappreciated Benefit of Creating and Resolving an Uncertainty", *Journal of Marketing Research* (Aug 2018), seven studies. Verbatim abstract:
  - "first creating and then resolving an uncertainty can generate a net positive experience, yet laypeople do not seek out this process."
  - "uncertainty engenders curiosity and thereby builds a potential for a positive experience, whereas uncertainty resolution satisfies the curiosity and thereby realizes that potential."
  - Source: [doi 10.1509/jmr.15.0346](https://doi.org/10.1509/jmr.15.0346), abstract via Crossref.
- **[Research, title only]** Shen, Fishbach & Hsee, "The Motivating-Uncertainty Effect: Uncertainty Increases Resource Investment in the Process of Reward Pursuit", *Journal of Consumer Research* 2015. Only the title and metadata were retrieved (OUP returned 403), so the findings are not quoted. Source: [doi 10.1086/679418](https://doi.org/10.1086/679418)
- **[Research, VERIFIED]** Larche et al. 2019/2021 found anticipatory arousal rising before the reveal (see §1). [PubMed 31760581](https://pubmed.ncbi.nlm.nih.gov/31760581/)
- **[Research, UNVERIFIED in this pass]** Loewenstein (1987), *Economic Journal* 97:666-684, on utility from **savoring** a delayed outcome ([RePEc](https://ideas.repec.org/a/ecj/econjl/v97y1987i387p666-84.html)), carried over.
- **[Research, VERIFIED]** Zendle & Cairns, *PLOS ONE* 13(11):e0206767, published 21 Nov 2018:
  - Sample n = 7,422 (from 14,182 responses). Loot-box spend by problem-gambling severity gave "χ2(3) = 284.255, p<0.001, η2 = 0.054", described as "small-to-medium". Other microtransactions gave η2 = 0.004.
  - "it is impossible to understand the direction of the causal relationship."
  - On scope: "we have focused on loot boxes which require monetary outlay… There may be deeper concerns about such 'unpaid openings'… This is not our immediate concern."
  - Source: [PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0206767)
- **[Research, VERIFIED]** Zendle & Cairns' replication, *PLOS ONE* 2019;14(3):e0213194: n = 1,172 gamers who "did not self-select into a loot box study and were not aware of the study's aims"; η2 = 0.051. Source: [PubMed 30845155](https://pubmed.ncbi.nlm.nih.gov/30845155/)
- **[Research, VERIFIED]** Larche, Chini, Lee & Dixon, "To Pay or Just Play? … Purchasers and Earners of Loot Boxes in Overwatch", *J Gambl Stud* 2023;39(2):625-643, pre-registered.
  - Purchasers showed "greater video-game related expenditure harms, risky loot box use, impulsivity…"
  - "Surprisingly, Overwatch loot box earners displayed greater gambling-related harms."
  - Source: [PubMed 35834117](https://pubmed.ncbi.nlm.nih.gov/35834117/)
- **[Research, citation VERIFIED, content UNVERIFIED]** King & Delfabbro, "Predatory monetization schemes in video games (e.g. 'loot boxes') and internet gaming disorder", *Addiction* 2018;113(11):1967-1969, an editorial with no abstract. The tactic list from the first pass (limited disclosure, unavoidable solicitations, manipulated outcomes, entrapment) could not be checked against the full text. Sources: [PubMed 29952052](https://pubmed.ncbi.nlm.nih.gov/29952052/); [Flinders](https://researchnow.flinders.edu.au/en/publications/predatory-monetization-schemes-in-video-games-eg-loot-boxes-and-i/)
- **[Research, UNVERIFIED]** The claim that Xiao et al. 2019 argue random reward mechanisms can manipulate players without money involved is not retrieved.
- **[Dev, VERIFIED-SECONDARY]** Delayed-reveal precedents:
  - Destiny: coded engrams "must be decoded by a cryptarch" until the player reaches a reputation threshold. Update 1.0.2 guaranteed that a purple engram decodes to Legendary or better. [Destiny wiki](https://destiny.fandom.com/wiki/Engram)
  - Path of Exile: magic, rare and unique items drop "unidentified", so their colour (rarity) is visible but their properties are hidden. [PoE wiki](https://pathofexile.fandom.com/wiki/Rarity)
  - Overwatch (current) "items are rolled during the opening animation". [Overwatch wiki](https://overwatch.fandom.com/wiki/Loot_Box)

### Inferences
- **Show the tier now, reveal the item later.** Woolley & Fishbach say the reward should be fused to the fight, while teasing and savoring say a later resolution adds pleasure. The shipped answer that satisfies both is Destiny's engram colour or Path of Exile's unidentified item.
- For Corrupted Raids, the overlay would announce "@viewer: EPIC chest" at the end of the fight (immediate, social, visible), and the phone page would reveal *which* item (the resolution).
- **Never decode below the shown tier.** Destiny had to patch its engrams to guarantee "Legendary or higher". A sealed chest that shows a tier must honour it.
- **Keep the delay voluntary and free.** No timer gate, no currency to open, no "open more" prompt. With no real money the Zendle-type financial risk is mostly gone, but Larche 2023's earners result is a reason to keep compulsion loops out anyway: no near-miss staging, no streaks that reset when a viewer stops playing.
- **Publish the rarity table in How to Play.** This matches the "legible" premise and the disclosure norm.

### Gaps
- No study was found that directly compares a minutes-to-hours delayed loot reveal with an immediate one in a game.
- The findings of Shen et al. 2015 and Xiao et al. 2019 were not retrieved.
- The full text of King & Delfabbro 2018 was not retrieved.

---

## 5. Group loot fairness, participation rewards, and the size of consolation rewards

### Takeaway
WoW's arc runs Legion/BfA personal loot → Dragonflight Group Loot only in its first raid → Hazzikostas in 2022: "I kind of do want to bring back master loot". It shows that personal rolls remove "at the mercy of others" friction and tailor drops to the party, but lose the social act of distributing loot.

Shipped consolation for an unwanted or duplicate drop clusters at **about 12.5-25% of the item's acquisition cost**:
- Hearthstone disenchant gives 12.5-25% of the crafting cost.
- Overwatch duplicates gave 20% of the credit price.
- Overwatch now gives progress toward the next box instead.

Corrupted Raids' `lootRecycleRate` of 0.1 sits just below that band.

### Cited Findings
- **[Dev, VERIFIED-SECONDARY]** WoW, Battle for Azeroth. Mein-MMO (German edition) on the removal of Master Loot:
  - The first reason given is that it is "ein übrig gebliebenes Relikt" (a leftover relic), takes more time and is tied to player-made systems such as DKP.
  - The second reason is top guilds' "Split-Raiding" to funnel items to a few mains.
  - Personal-loot items "kann nach wie vor an andere Spieler gehandelt werden, sofern diese mindestens einen Gegenstand ähnlicher Stärke besitzen" (can still be traded if the holder already owns an item of similar strength).
  - Source: [Mein-MMO](https://mein-mmo.de/en/world-of-warcraft-removes-the-loot-master,217617/)
  - **UNVERIFIED**: the Hazzikostas quote "at the mercy of others", about trial raiders, is from search summaries only (e.g. [Inven Global](https://www.invenglobal.com/articles/6226/master-loots-removal-deals-another-blow-to-wows-dwindling-sense-of-community)).
- **[Dev, VERIFIED-SECONDARY]** Hazzikostas in May 2022, quoted by Blizzard Watch:
  - "What if I told you… I kind of do want to bring back master loot, and the team does? … Loot is a tricky one."
  - Blizzard Watch recalls what personal loot fixed: "you basically just killed a boss for disenchanting purposes… Personal Loot allowed them to tailor drops more directly to the comp of the group."
  - Source: [Blizzard Watch, 11 May 2022](https://blizzardwatch.com/2022/05/11/master-loot-returns/)
- **[Dev, VERIFIED-SECONDARY]** Dragonflight: "While inside Vault of the Incarnates, Group Loot will be the only method of loot distribution. There is no option to select for yourself or your group to return to Personal Loot." It is Need/Greed, not Master Looter. Source: [Blizzard Watch, 29 Sep 2022](https://blizzardwatch.com/2022/09/29/dragonflight-group-loot/)
- **[Opinion, UNVERIFIED]** The critique that removing master loot hurt WoW's community comes from [Inven Global](https://www.invenglobal.com/articles/6226/master-loots-removal-deals-another-blow-to-wows-dwindling-sense-of-community), carried over.
- **[Community, VERIFIED-SECONDARY]** Hearthstone's consolation economy:

  | Rarity | Craft cost (dust) | Disenchant value (dust) | Ratio |
  |---|---|---|---|
  | Common | 40 | 5 | 12.5% |
  | Rare | 100 | 20 | 20% |
  | Epic | 400 | 100 | 25% |
  | Legendary | 1600 | 400 | 25% |

  - "crafting any card costs between four and eight times more Dust than would be rewarded for disenchanting the same card."
  - Duplicate protection means "A card pack will never include more copies of a single card than what may be used in a deck."
  - In *Heroes of the Storm*, "opening a duplicate item automatically gives the player the item's disenchanting value in Shards."
  - Sources: [Hearthstone wiki, Crafting](https://hearthstone.fandom.com/wiki/Crafting); [Card pack statistics](https://hearthstone.fandom.com/wiki/Card_pack_statistics)
- **[Community, VERIFIED-SECONDARY]** Original Overwatch:
  - Credits for duplicates were common 5, rare 15, epic 50 and legendary 200.
  - Standard prices were rare 75, epic 250 and legendary 1000, so a duplicate refunded **20%**.
  - Credits came "either directly, as an amount of money, or indirectly, as a compensation for duplicate drops."
  - Source: [Overwatch wiki, Credits](https://overwatch.fandom.com/wiki/Credits)
- **[Community, VERIFIED-SECONDARY]** Current Overwatch boxes: duplicates give "bonus progress towards the next Loot Box", a consolation paid in future chances rather than currency. Source: [Overwatch wiki, Loot Box](https://overwatch.fandom.com/wiki/Loot_Box)
- **[Dev, VERIFIED]** Diablo IV compensates for fewer drops with materials: "materials gained from Salvaging and Crafting have been adjusted to match this change." Source: [Blizzard News](https://news.blizzard.com/en-us/article/24077223/)

### Inferences
- **Keep independent personal rolls.** Corrupted Raids' model is the one WoW adopted to remove dependence on other people's goodwill, and it suits strangers in a Twitch chat who have no guild trust. WoW's own case for going back is about guild logistics, not about strangers.
- **The overlay is where the lost social benefit is recovered.** Announcing who found a rare item is the shared moment, and it needs no shared pool.
- **Consolation sizes in shipped games are about 1/8 to 1/4 of value.** A `lootRecycleRate` of 0.1 is slightly under the Hearthstone common rate (12.5%). Raising it to 0.15-0.25 for rare and above would match shipped practice; the same curve-by-rarity shape is Hearthstone's.
- **An alternative consolation is Overwatch's "progress toward the next box".** For Corrupted Raids that maps naturally onto a pity counter that also ticks on casualty and defeat runs: "you died, but your next chest is luckier". It rewards participation without inflating the item count, which suits a "less is more" premise.
- **Role fairness.** A tank or healer who dies protecting the party rolls at 8.5% against a surviving DPS at 42.5%. A participation floor (every member of a win rolls the same, with survival adding a small bonus) is one option. This is not sourced, and the code's survived > died-in-win > lost ordering is asserted by `npm run simulate`, so any change must keep it.

### Gaps
- No source was found that measures the retention effect of consolation or participation rewards, or of their size.
- No primary source was found for Twitch-native reward games (Marbles on Stream, Stream Raiders) drop rates.
- The 2018 developer Q&A transcript on removing master loot was not retrieved; icy-veins returned 403.
