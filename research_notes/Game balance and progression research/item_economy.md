# Item economies: faucets and sinks, recycling, merging and auction houses (for Corrupted Raids). Verification pass

> **Method note (2026-10-29).** This rewrites the earlier snippet-based version. Each primary source below was opened in full and checked against the claim it supports. WebFetch's own resolver still failed for these hosts, but `curl` through the session proxy reached most of them, so pages were downloaded and read as text. Hosts that stayed **blocked by proxy policy**: icy-veins.com, diablo.fandom.com, clashroyale.fandom.com, royaleapi.com, wowhead.com, wowpedia.fandom.com, gamespot.com, d2r.org, mitpress.mit.edu, poewiki.net, gdcvault.com. Claims that rest only on those hosts are marked **[UNVERIFIED]**.
>
> Tags: **[VERIFIED]** means checked against the primary text or an authoritative wiki. **[CORRECTED]** means the earlier version was wrong and is fixed here. **[OPINION]** means a practitioner or author view, not data. **Inferences** sections are this researcher's design reasoning, not findings.
>
> Game numbers come from the brief and from the repo: `content/balance.json` economy block (`recycleRate: 1`, `lootRecycleRate: 0.1`, `startingGold: 60`, `valueByRarity` common 20 / uncommon 45 / rare 110 / epic 260 / legendary 600), `content/shop.json`, and `src/engine/shopPricing.ts`.
>
> **Main corrections to the earlier version:**
> 1. OSRS: the tax exemption is for items under 50 coins, not 50 or under. The "keep old content relevant" wording comes from the Grand Exchange page, not the Sink page.
> 2. Diablo II: rune upgrades El through Ort take no gem, and the 2:1 ratio starts at Pul→Um, not "about Um".
> 3. Jay Wilson's "gold AH did more damage" claim is now traced to Engadget/Joystiq and Game Informer.
> 4. The Hight quote is now verified on Blizzard's own post.
> 5. The UO "luxury sink" did **not** work, according to the primary paper.
> 6. The "hard vs soft sinks" attribution to the Game Developer handbook is not in that article, so it is removed.
> 7. The Engadget "top-5 sinks remove 31% of bounties" figure is dropped as unverifiable and replaced with CCP's August 2026 numbers.
> 8. In the repo, "shop items refund 100%" means 100% of the item's `value`, **not** of its shelf price. For the 2,574g staff that is a 600g refund (23%).

## Q1. What do the primary faucet/sink texts actually say?

### Takeaway
The faucet/sink model goes back to Ultima Online's postmortem (Simpson, 1999). UO began as a *closed* resource loop and was forced into open faucets and drains because players hoarded. Lehdonvirta & Castronova (2014) give the most usable framework: rate every faucet and sink on efficacy, adjustability and user acceptance. They name **NPC buy-back as a goods sink but a currency faucet**, and **recycling N items into fewer items** as a goods sink that works best when the odds are random. Dormans' Machinations warns that two converters feeding each other form a positive-feedback "engine" that needs friction. That is exactly the shape of a recycle + merge + shop loop.

### Cited Findings
- **[VERIFIED] Lehdonvirta & Castronova, *Virtual Economies: Design and Analysis* (MIT Press, 2014), ch. 11 "Constructing the pipes: Faucets and sinks":**
  - The UO origin story: "Some of their users started hoarding goods... driving the system toward standstill. As a result, Ultima Online was switched to the model that most virtual economies today use: having faucets that add new stuff into circulation and sinks that remove it."
  - Three ways to evaluate a faucet or sink: "efficacy", "adjustability", and "user acceptance... The most effective and adjustable sinks are often the least acceptable to users. A really good sink, though, can be not only acceptable but even fun."
  - "In our consulting engagements, probably the most common advice we give to virtual economy designers is to consider adding more sinks... The challenge is to come up with sinks that users don't get up in arms about."
  - On relying on one sink: "the problem with relying on the publisher-to-user market as the sole money sink is that it is also simultaneously a faucet for items."
  - On NPC buy-back: "When users sell virtual goods back to the publisher to obtain virtual currency... this acts as a sink for goods and as a faucet for currency." And: "NPC traders often buy low-value items from players in order to make their activities feel more meaningful. This is obviously highly acceptable to users, but it creates a new money faucet."
  - On transaction taxes: "it is natural to charge taxes and fees on transactions conducted through exchange mechanisms that involve an institutional intermediary, like an auction house. Charging taxes and fees on direct one-to-one transactions might meet with less acceptance." The book's examples (2014-era): WoW auction houses take "a 5 or 15 percent cut", EVE "1.5 percent sales tax" plus a broker fee "under 1 percent", Habbo Marketplace "1 percent sales tax as well as a fixed listing fee".
  - On recyclers: "Users have the option of giving up a number of old items in exchange for a smaller number of new items... the new items must obviously be something desirable that cannot otherwise be easily obtained." There are three types: transparent, mystery and **Monte Carlo** ("the better the output item is, the lower the probability is of getting it"). "Publishers with experience in the matter suggest that suitably adjusted Monte Carlo recyclers are the most efficient in getting users to dispose of their items." **[OPINION, as the authors relay it]**
  - Box 11.2, Habbo's Ecotron: from 2009 it took **5 items in for 1 random item out**, with published odds of Uncommon 1 in 5, Arcane 1 in 40, Phenomenal 1 in 200 and Urban Legend 1 in 2,000. "The quality of the inputs has no bearing on the output." Before that it was transparent, with 10/20/30/40/50 items in for a chosen reward.
  - — [book text (dokumen.pub mirror)](https://dokumen.pub/virtual-economies-design-and-analysis-information-policy-reprintnbsped-9780262535069-0262535068-0262027259-9780262027250.html)
- **[VERIFIED] Zachary Booth Simpson, "The In-game Economics of Ultima Online"** (dated 7 Apr 1999; presented at CGDC, San Jose, Mar 2000):
  - UO's closed loop failed: "What the designers had not counted on was the deflationary effects of hoarding." Pumping in more resources did not help: "no matter how much they added, the resources always flowed into inventory and just sat there." The fix was "to disconnect the output from the input... new resources are created out of thin air (the 'faucet')".
  - On drains: "players are (understandably) extremely resistant to rule changes which take things away from them." **Consumables** are "by far the most politically feasible drain because the players feel they are getting something for their cost – i.e. it isn't a tax."
  - On selling to NPC shopkeepers: "This item drain is not a true sink of goods because it involves printing gold to pay for the goods... it is really a conversion from non-gold resources to gold." Proposed "recycle bins... will inflate the gold economy."
  - **[CORRECTED]** The earlier note said UO's luxury items worked as a sink, relying on Wikipedia. Simpson says the scheme to sell high-priced NPC goods "did not work. First, it was very difficult to come up with things that players wanted for which they were willing to pay very high prices. Second... player outcry as unfair competition." The example is blue plate armour, at which crafters were "outraged".
  - — [Simpson paper (gwern.net archive of mine-control.com)](https://gwern.net/doc/economics/1999-04-07-simpson-theingameconomicsofultimaonline.html). Wikipedia's summary of the same paper, which reports the luxury sink without the "did not work" verdict: [Wikipedia: Gold sink](https://en.wikipedia.org/wiki/Gold_sink)
- **[VERIFIED] Raph Koster (UO lead designer) on UO's economy:** "NPC shops are a subsidy, obviously, as they buy stuff for which there is zero real market... They're just a gold spigot." — [raphkoster.com, "The evolution of UO's economy"](https://www.raphkoster.com/?p=16263)
- **[VERIFIED: table of contents only] Schreiber & Romero, *Game Balance* (CRC Press, 2021), ch. 6 "Economic Systems".** Sections include Supply and Demand, Market Price (Fixed Economies; Player-Dynamic Economies; F2P Economies; Prestige Economies, p. 120), and **Inflation** (p. 121). Inflation is broken into "Supply-Side Inflation", "Demand-Side Inflation", "Adding Negative-Sum Elements to the Economy", "Removing Positive-Sum Mechanics from the Economy" and "Economic Resets", followed by "Open and Closed Economies" and "Player Trades in Open Economies". The body text of ch. 6 is not in the publisher preview. — [publisher preview PDF](https://api.pageplace.de/preview/DT0400.9781498799584_A38640931/preview-9781498799584_A38640931.pdf)
- **[VERIFIED] Dormans, *Engineering Emergence* (PhD thesis, 2012), ch. 4 "Machinations":**
  - Following Adams & Rollings: "Sources create resources, drains destroy resources. Converters replace one type of resource for another, while traders allow the exchange of resources between players." "Converters act exactly as a drain that triggers a source."
  - The "Converter Engine" pattern: "Two converters set up in a loop create a surplus of resources... As with dynamic engines, a positive feedback loop drives a converter engine, in most cases this feedback loop needs to be balanced by applying some sort of friction."
  - — [thesis PDF, ILLC](https://eprints.illc.uva.nl/id/eprint/2118/1/DS-2012-12.text.pdf); [record](https://eprints.illc.uva.nl/id/eprint/2118/)
- **[OPINION] Game Developer economy handbook** (Alex Wiserax, 15 Nov 2024): "Too many resources from sources—and the balance overflows, leading to inflation. Too few—and players lose interest." It also says that in Diablo 2 "gold became so devalued by the end of the game that players stopped using it, instead trading items like the Stone of Jordan." **[CORRECTED]** The earlier note attributed a "hard vs soft sinks" framing to this article. It is not in the text. — [Game Developer](https://www.gamedeveloper.com/production/i-designed-economies-for-150m-games-here-s-my-ultimate-handbook)

### Inferences
- Applied to Corrupted Raids, using Lehdonvirta's and Simpson's categories:
  - **Fight gold, `startingGold` and loot recycling are all faucets.** Loot recycle is an *item* sink but a *gold* faucet, exactly as Simpson describes NPC buy-back.
  - **The shop is the only gold sink, and it is also an item faucet**, which is the arrangement Lehdonvirta & Castronova warn against.
  - A planned merge (#15) would be the game's first pure item sink. A merge gold fee would be its first gold sink that is not tied to an item faucet.
- Dormans' converter engine is the right lens for #15. It applies once merge (items to item), recycle (item to gold) and shop (gold to item) all exist. If any cycle through those three returns more than it costs, it is a gold or item printer. "Friction" here means a recycle rate and merge cost that make every loop lossy.
- Simpson's consumables point has the strongest record of player acceptance. It argues for the existing consumables (4 in content) being the main recurring sink, ahead of anything that feels like a tax.

### Gaps
- Schreiber & Romero's chapter body (what "negative-sum elements" they recommend) was not accessible. Only the section titles are verified.
- Adams & Dormans' *Game Mechanics* book was not opened. The thesis was used instead.

## Q2. What do live economies' published numbers say about sinks and taxes? (EVE, OSRS, WoW)

### Takeaway
Primary data from CCP and Jagex shows that market transaction taxes are the **single largest money sink** in EVE: 29.6T ISK in August 2026, about 25% of all sinks. Even so, EVE's sinks remove only about 58% of what faucets add, and money supply roughly tripled between 2017 and 2026. OSRS deletes most of its 2% sale tax and uses part of it to buy and destroy specific items. Proportional, seller-side, deleted taxes are the documented norm. A single expensive vanity item is a status object, not inflation control.

### Cited Findings
- **[VERIFIED] EVE 2021 tax restructure** (CCP, "Restructuring Taxes After Relief", 19 Oct 2021): "Sales Tax: 2.5% -> 8.0% (Previously 5.0%)", "Brokers Fee: 2.5% -> 3.0% (Previously 5.0%)", "Total Taxes: 5.0% -> 11.0% (Previously 10.0%)". Minimums with skills and standings: sales tax 3.6%, broker fee 1.0%, total 4.6%. The rationale: "shifts a higher percentage of the tax division toward the sales tax instead of on the order placement, permanently reducing the cost-pressure associated with listing orders by moving the cost into the sales tax taken out upon purchase by another player." — [CCP](https://www.eveonline.com/news/view/restructuring-taxes-after-relief)
- **[VERIFIED] EVE tax history since then** (EVE University wiki, citing patch notes):
  - Aug 2019: sales tax 2% to 5%, NPC broker fee 3% to 5%.
  - Jul 2024: "Marketplace taxes reduced to 4.5%. Down from 8%".
  - Mar 2025 (v22.02): "Sales Tax has been increased from 4% to 7.5%".
  - Current base sales tax is **7.5%**, cut by "11% per level in Accounting (3.37% at max skills)". Broker Relations cuts the broker fee "by 0.3 percentage points per level... from 3% to 1.5%".
  - The wiki's 2024 entry (4.5%) and 2025 entry ("from 4%") disagree slightly. The CCP patch notes themselves were not opened.
  - — [EVE University wiki: Trading](https://wiki.eveuniversity.org/Trading)
  - **[CORRECTED]** The earlier note's "8% sales tax" is the 2021 figure, not the current one.
- **[VERIFIED] EVE Monthly Economic Report, August 2026** (CCP, published 9 Sep 2026). The "ISK Sinks & Faucets" chart reads:
  - Faucets **203.2T**, sinks **−117.2T**, so sinks equal about 58% of faucets.
  - Money supply 2,785.9T at the start of the month to 2,954.2T at the end.
  - Largest faucets: Bounty Prizes 57.8T, Commodity [Market] 53.9T, ESS Main Bank 31.3T.
  - Largest sinks: **Transaction Tax −29.6T**, LP Store −18.5T, Skill Purchase −12.2T, Manufacturing −11.6T, **Brokers Fee −10.1T**.
  - The "Money Supply" chart shows total active ISK rising from about 1,000T (Jan 2017) to 2,954T (Aug 2026).
  - — [MER Aug 2026](https://www.eveonline.com/news/view/monthly-economic-report-august-2026) (figures read from the report's chart images [sinks & faucets](https://images.ctfassets.net/7lhcm73ukv5p/EVEOnline_MER_202608-14_sinks_and_faucets/6c451c29e8e9e745e057b2b3031b3ee8/14_sinks_and_faucets.png) and [money supply](https://images.ctfassets.net/7lhcm73ukv5p/EVEOnline_MER_202608-18_money_supply/2ffa396b984182608b7e6aa344236c64/18_money_supply.png))
- **[VERIFIED] CCP's definitions** (EVE Vegas 2015 economy blog): faucets are "where ISK is added to the economy by game systems CCP puts in place". Sinks are "where ISK is removed from the economy by game systems CCP puts in place". CCP also noted ISK velocity was "just under 0.5" and falling, meaning "players are sitting on more isk these days that they don't use". — [CCP, EVE Vegas 2015 report](https://www.eveonline.com/news/view/eve-economy-update-eve-vegas-2015-report)
- **[VERIFIED] OSRS Grand Exchange tax:**
  - "Most transactions on the Grand Exchange are subject to a 2% tax... capped at a maximum of 5 million coins per item... most is removed from the game, while a small amount is used to purchase select items from other players and delete them."
  - "The tax was implemented on 9 December 2021... initially set at 1%, and increased to 2% on 29 May 2025."
  - **[CORRECTED]** It "rounds down... so items sold for below 50 coins have... no tax obligation". The cutoff is under 50, not "50 or less". A list of specific items is also exempt.
  - Item sink: items "are then deleted from the game to better control market supply, keep old content relevant, and prevent item devaluation... deleting a static, Jagex-specified number of that item from the market every week".
  - Mod Ash (29 May 2025): "Probably well over half the taxed coins are drained in that way rather than being re-injected by sinking items." His sample of items sunk since launch totals about 4.33 trillion coins of value, including 38k Bandos godswords and 204k tentacles.
  - **[CORRECTED]** The earlier note quoted the "keep old content relevant" wording from the Sink (economy) page. It is on the Grand Exchange page.
  - — [OSRS Wiki: Grand Exchange](https://oldschool.runescape.wiki/w/Grand_Exchange); [OSRS Wiki: Sink (economy)](https://oldschool.runescape.wiki/w/Sink_(economy))
- **[VERIFIED] WoW auction house fees** (current, per warcraft.wiki.gg):
  - "the house will take 5% of the winning bid as its cut".
  - The deposit is 15% / 30% / 60% of the item's vendor sell price for 12 / 24 / 48 hour listings. It is refunded on a sale and lost if the item fails to sell or the auction is cancelled.
  - Guidance on the same page: "don't try to sell an item on the auction house for less than vendor sell price".
  - — [warcraft.wiki.gg: Auction House](https://warcraft.wiki.gg/wiki/Auction_House)
- **[VERIFIED] WoW's Mighty Caravan Brutosaur:** "Before patch 9.0.1, this item could be purchased for 5,000,000" gold. Patch 9.0.1 (2020-10-13) "Removed from vendors and added to the Black Market Auction House", where it starts at a 5,000,000 bid and "usually ends up selling for the gold cap of 9,999,999". The same wiki's Money page lists other mount sinks: the Mekgineer's Chopper and Mechano-Hog "require over 12,000 gold to craft", and the Traveler's Tundra Mammoth costs at minimum 14,000 gold. It describes them as "popular gold sinks to date, due to their high visibility". — [warcraft.wiki.gg: Brutosaur](https://warcraft.wiki.gg/wiki/Reins_of_the_Mighty_Caravan_Brutosaur); [warcraft.wiki.gg: Money](https://warcraft.wiki.gg/wiki/Money)
- **[VERIFIED, secondary] Alter Aeon (MUD) feedback-controlled sink:** it tracks total money and adjusts drop rates and shop prices dynamically. Players holding over 1 million are taxed 2% of the excess, and peaks in total currency reportedly vary under 10% over 2 years. — [Wikipedia: Gold sink](https://en.wikipedia.org/wiki/Gold_sink) (single-source article, flagged by Wikipedia itself)

### Inferences
- EVE's own data says the transaction tax is its biggest single sink. A seller-paid, deleted sale tax on #16 is therefore the most evidence-backed sink available, and it scales with use automatically.
- EVE also shows that a large economy with many sinks still inflates steadily. For a small alpha economy the aim is not zero inflation. It is that gold keeps buying something worth wanting.
- "Most of the tax is deleted, a little buys and deletes specific items" (OSRS) could apply directly to an AH: a tax on found gear partly funds removing that gear's supply.

### Gaps
- CCP's patch notes for the 2024 and 2025 tax changes were not opened directly (relied on EVE University).
- No primary Blizzard data on WoW gold inflation was found.
- Albion Online's gear destruction and its market tax rates remain **[UNVERIFIED]**. Only community guides were seen in the earlier pass, and they were not re-checked.

## Q3. Auction houses: what is verified about Diablo III, Path of Exile, and what a minimal #16 should look like?

### Takeaway
The D3 record is now verified from primary or near-primary sources:
- Wilson (GDC 2013) said both AHs "really hurt the game", and that the gold AH did "much more damage".
- Over 50% of players used them regularly.
- Blizzard's own post (John Hight, 17 Sep 2013) said the AH "ultimately undermines Diablo's core game play: kill monsters to get cool loot". Both AHs closed 18 March 2014.
- The gold AH took a **flat 15%** of the sale price.

GGG's Trade Manifesto (Chris Wilson, 2 Nov 2017) is verified. It argues that easy trade compresses progression and widens the gap between players, and that the remaining friction is deliberate.

### Cited Findings
- **[VERIFIED] Jay Wilson at GDC 2013**, as reported 28 Mar 2013:
  - Blizzard's pre-launch assumptions were that the AHs "would help reduce fraud, that they'd provide a wanted service to players, that only a small percentage of players would use it and that the price of items would limit how many were listed and sold". Blizzard "was completely wrong about those last two points".
  - "over 50 percent of players used it regularly" (about 1M daily and 3M monthly players).
  - It "made money a much higher motivator than the game's original motivation to simply kill Diablo, and 'damaged item rewards'".
  - "**gold does much more damage than the other one does**," because "more players use it and prices fluctuate much more" (the reason is Engadget's paraphrase).
  - "I think we would turn it off if we could"... "not as easy as that", because Blizzard "has no idea" how many players like the system.
  - — [Engadget (Joystiq)](https://www.engadget.com/2013-03-28-diablo-3-director-jay-wilson-auction-houses-really-hurt-game.html)
  - Game Informer confirms: "Wilson pointed to the gold auction house as more damaging to the game's health than the real-money one, simply because far more people use the in-game currency version." — [Game Informer](https://www.gameinformer.com/b/news/archive/2013/03/28/diablo-iii-director-admits-auction-house-mistakes.aspx)
  - PC Gamer quotes Blizzard designer Travis Day on the aim to "refocus players away from farming the auction house and onto farming monsters." — [PC Gamer](https://www.pcgamer.com/diablo-3-auction-house-jay-wilson/)
  - Also covered by [MCV/DEVELOP](https://mcvuk.com/development-news/gdc-13-diablo-iii-auction-houses-hurt-game-admits-director/) and [PCGamesN](https://www.pcgamesn.com/diablo/diablo-3-director-jay-wilson-auction-house-would-turn-it-if-we-could).
  - **[CORRECTED]** The earlier note had "completely wrong" right but implied the 50% figure came from MCV. It comes from the talk as reported by Engadget, PC Gamer and MCV. Game Informer alone says "nearly half". The GDC Vault recording was blocked, so all quotes are as reported.
- **[VERIFIED] Blizzard's removal post**, "Diablo III Auction House Update", by John Hight:
  - "When we initially designed and implemented the auction houses, the driving goal was to provide a convenient and secure system for trades. But... it ultimately undermines Diablo's core game play: kill monsters to get cool loot... we've decided to remove the gold and real-money auction house system."
  - "this move along with the Loot 2.0 system... will result in a much more rewarding game experience". "the shutdown will occur on March 18, 2014."
  - — [Blizzard News](https://news.blizzard.com/en-us/article/10974978/diablo-iii-auction-house-update)
  - Dated 17 Sep 2013 by [Game Developer](https://gamedeveloper.com/business/blizzard-to-shut-down-i-diablo-3-i-auction-house) and [Game Informer](https://www.gameinformer.com/b/news/archive/2013/09/17/blizzard-pulling-plug-on-diablo-iii-auction-houses.aspx), which names "game director Josh Mosquiera and production director John Hight".
  - Wikipedia agrees: "On September 17, 2013, Blizzard stated that both the gold and real-money auction houses would be shut down on March 18, 2014", and "Players had until June 24, 2014, to claim gold and items". — [Wikipedia: Diablo III](https://en.wikipedia.org/wiki/Diablo_III)
- **[VERIFIED, gap filled] D3 AH fee rates:**
  - "In the gold-based auction house, a flat fee of 15 percent was taken from the final sale price of an auction."
  - Real-money AH: "US$1, €1 or £1 (or equivalent) for equipment... a 15 percent fee for commodity auctions... an additional 15 percent 'cashing-out' fee".
  - The RMAH opened 12 June 2012 (15 June in the Americas).
  - — [Wikipedia: Diablo III](https://en.wikipedia.org/wiki/Diablo_III), citing Blizzard's "Diablo III Auction House General Information" page
- **[VERIFIED] Why removal was slow:** Wilson at Portland Retro Gaming Expo 2022 said the RMAH's purpose was "security... the biggest problem with Diablo 2 was item duping and duping hacks and all the gold sellers". "The trading market's in the game: we control it, so the hackers don't." Wikipedia reports he said the delay was legal, because the feature was "advertised on the retail packaging". — [PC Gamer, 24 Oct 2022](https://www.pcgamer.com/diablo-3-took-so-long-to-get-rid-of-its-auction-house-because-it-was-on-the-box/); [Wikipedia: Diablo III](https://en.wikipedia.org/wiki/Diablo_III)
- **[VERIFIED] GGG Trade Manifesto** (Chris Wilson, official forum, posted 2 Nov 2017):
  - Design pillar: "items matter... The acquisition of items is why people play Action RPGs."
  - "People who are heavily engaged in trade perform fewer item upgrades to achieve their final build... We believe that it is more fun to slowly and iteratively upgrade a character over time... Knowing that a monster could drop something that improves your character is a great motivator for playing one more level!"
  - The two-games argument: easy trade means "you have a much higher acquisition rate of useful items... the second game either receives reduced drop rates relative to the first, or ends up being a whole lot easier".
  - Inequality: "Most players who play Path of Exile never trade... While a regular player would be lucky to accumulate a small handful of Exalted Orbs in a league, a trader might reach hundreds in the same timeframe."
  - Bots: "If they have the ability to search out and buy items without having to talk to another player, then there would be some very large-scale economic consequences that would not be good for regular players."
  - Friction is deliberate: "we had to be careful not to make it too easy. We had seen what happened in other Action RPGs when characters could be upgraded trivially." The remaining frustration "is the only thing standing in the way of trades being basically instant... we are very concerned regarding what will happen if that does eventuate."
  - China/Xbox "Trade Market": "intentionally makes the search process harder and the trade process easier... We're not planning to bring it to the international PC version."
  - — [pathofexile.com forum](https://www.pathofexile.com/forum/view-thread/2025870)
  - **[CORRECTED]** The earlier note said the "wants friction" framing was player paraphrase only. The manifesto itself says trade must not be "too easy".
- **[UNVERIFIED]** PoE later added asynchronous instant-buyout trade (Merchant's Tabs). Only third-party guides were seen, and the GGG patch notes were not opened. — [expcarry guide](https://expcarry.com/poe-1-trading-guide-price-buy-sell-items)

### Inferences
- D3 shows that the damage came from **volume and centrality**: the gold AH, used by most players, was worse than the real-money one. The size of the fee was not the problem. D3's gold AH charged a flat 15%, higher than OSRS (2%) or WoW (5%), and still "hurt the game". **A tax alone does not prevent the D3 failure. Limiting what the AH can do does.**
- GGG's two-games argument applies directly. A buyout AH raises every player's "useful item acquisition rate", so the designers must either cut drops or accept faster progression. Corrupted Raids has just cut drops to about one item per viewer per night (AGENTS.md §4). An AH would partly undo that unless it is narrow.
- A minimal #16 consistent with the evidence (design proposal):
  1. **Found gear only.** Already planned.
  2. **Buyout only, listings expire at the end of the stream night.**
  3. **Seller-paid sale tax, deleted.** EVE's 2021 rationale supports charging on the sale rather than the listing, so the listing fee should be zero or token.
  4. **Floor at recycle value.** This matches WoW's "don't sell below vendor price" norm.
  5. **Cap listings per viewer.** This is PoE-style friction that reads clearly on stream.
  6. **Keep the attribute gates.** `requires` on allocated points means a bought item cannot jump a build past its points, a brake D3 lacked.

### Gaps
- The GDC 2013 talk recording (GDC Vault) was blocked. All Wilson quotes are as reported by press.
- No verified figure was found for what share of D3 gear came from the AH versus drops.

## Q4. Merge and upgrade systems: verified ratios, and is there evidence on how ratios affect perceived value?

### Takeaway
Verified ratios:
- **Diablo II:** gems 3:1 at every tier; runes 3:1 (no gem) from El to Ort, 3:1 plus a gem from Thul to Lem, and **2:1 plus a gem from Pul upward**.
- **Clash Royale:** copies needed roughly double or more per level, and the gold per step also rises steeply. Supercell's Nov 2025 rework *removed* two extra currencies because they confused players.
- **Habbo:** 5:1 random.
- **Merge Dragons:** 3→1, or 5→2 framed officially as "a bonus object".

No controlled study of how merge ratios affect *perceived* value was found. The closest evidence is Lehdonvirta & Castronova's practitioner claim that random-output ("Monte Carlo") recyclers dispose of items most efficiently, and Merge Dragons framing the 5-merge as a bonus.

### Cited Findings
- **[VERIFIED, CORRECTED] Diablo II (D2R) Horadric Cube** (Maxroll's recipe table):
  - Gems and skulls: "Requires 3 of the same quality and same Gem to upgrade".
  - Runes: El, Eld, Tir, Nef, Eth, Ith, Tal, Ral and Ort each go **3x → next with no gem**. Thul through Lem go **3x + a chipped or flawed gem**.
  - From **Pul→Um onward it is 2x + a gem**: Pul+Flawed Diamond=Um, Um+Topaz=Mal, ... Jah+Flawless Ruby=Cham, Cham+Flawless Emerald=Zod.
  - The earlier note's "El through Thul use 3 runes + 1 gem" and "from about Um upward" were wrong.
  - — [Maxroll: Horadric Cube Recipes](https://maxroll.gg/d2/resources/horadric-cube-recipes)
- **[VERIFIED] Diablo III Kanai's Cube recipes** (Maxroll):
  - Extracting a power (Archive of Tal Rasha) costs one of each of five bounty materials plus 5 Death's Breath plus the item. "You are limited to 3 powers in total: one... weapon or an off-hand item, one from armor, and one from jewelry" (a fourth slot was added in Season 22).
  - Upgrading a rare to a legendary (Hope of Cain) costs 50 Reusable Parts, 50 Arcane Dust, 50 Veiled Crystal and 25 Death's Breath plus a level-70 rare.
  - Material conversion runs "at 1:1 ratio for a small Death's Breath fee".
  - — [Maxroll: Kanai's Cube](https://maxroll.gg/d3/resources/kanais-cube)
  - **[UNVERIFIED]** That extraction *destroys* the item (Icy Veins was blocked). Maxroll lists the item as an ingredient but does not use the word. Kadala's Blood Shard prices (25/75/100) also remain unverified, because the fandom and maxroll pages were blocked or 404.
- **[VERIFIED, gap filled] Clash Royale upgrade tables** (Supercell, "Coming in the next update", 10 Nov 2025):
  - New **copies required** per level, Common column: L2 2, L3 4, L4 10, L5 20, L6 50, L7 100, L8 200, L9 400, L10 800, L11 1,000, L12 1,500, L13 2,500, L14 3,500, L15 5,500, L16 7,500.
  - Rare: L4 2, L5 4, ... L16 1,400. Epic: L16 180. Legendary: L16 20. Champion: L16 15.
  - New **gold** per step: L2 5, L3 20, L4 50, L5 150, L6 400, L7 1,000, L8 2,000, L9 4,000, L10 8,000, L11 15,000. From L12 every rarity pays 25,000, then 40,000, 60,000, 90,000 and 120,000 (L16).
  - Supercell's reasons for the rework:
    - Elite Wild Cards "felt a bit confusing and less satisfying than directly collecting and upgrading cards", so they were removed.
    - With Books, "players were spending more energy managing their inventory than having fun with the card collection system", so Books were converted.
    - Overflow copies of maxed cards now convert into "Crystals", a cosmetics currency.
  - — [Supercell](https://supercell.com/en/games/clashroyale/blog/news/coming-in-the-next-update)
  - A secondary guide (an account-reseller site, so treat with care) sums this to 23,087 copies and 365,625 gold to take one Common from L1 to L16. — [alviran.net](https://alviran.net/blog/clash-royale-upgrade-costs-gold-cards-level-16-2026/)
- **[VERIFIED] Merge Dragons** (official site): "Tip #1: Matching 5 is better than 3... You get a bonus object! Recap: If you only match 3 at a time, it gives you a single object." Third-party guides spell out the rule as 5 → 2. — [mergedragons.com tips](https://www.mergedragons.com/en/tips-and-tricks); [BlueStacks guide](https://www.bluestacks.com/blog/game-guides/merge-dragons/mds-efficiency-guide-en.html)
- **[VERIFIED] Habbo Ecotron**: 5 items in → 1 random item, odds published from 1 in 5 to 1 in 2,000, input quality irrelevant. See Q1. — [Lehdonvirta & Castronova, Box 11.2](https://dokumen.pub/virtual-economies-design-and-analysis-information-policy-reprintnbsped-9780262535069-0262535068-0262027259-9780262027250.html)
- **Perceived value: no direct study found.** The nearest academic work is on the endowment effect with virtual goods, for example a RuneScape-based field experiment (Munro & Ferreira De Sousa, MPRA working paper 8977), which "report[s] that individuals with more trading experience are less likely to exhibit status quo behaviour in trade". This was seen only in search results and not opened. **[UNVERIFIED]** — [MPRA 8977](https://mpra.ub.uni-muenchen.de/8977/1/MPRA_paper_8977.pdf)

### Inferences
- Corrupted Raids' value ladder steps up about 2.25-2.44x per rarity (20 / 45 / 110 / 260 / 600).
  - At **3:1**, every merge loses about 23-25% of nominal `value` (e.g. 3×20=60 → 45; 3×260=780 → 600). It is a real item sink and reads as "a set". This matches D2's gem rule and its low and mid runes.
  - **2:1** gains value (40 → 45; 520 → 600). D2 uses 2:1 only for scarce high runes *and* adds a consumed gem.
  - A Merge-Dragons-style **5 → 2** bonus would be a legible "match more, get more" rule, but it returns 2×45=90 for 100, close to break-even, so it sinks less.
- Clash Royale's lesson for "less is more" is direct. Supercell spent its Nov 2025 update **removing** secondary currencies (Elite Wild Cards, Books, Magic Coins) because they confused players and turned play into inventory management. A merge-only "dust" currency for Corrupted Raids should face the same test.
- Lehdonvirta's three recycler types map onto #15:
  - **Transparent**: 3 commons → 1 uncommon of your choice.
  - **Monte Carlo**: 3 → 1 random item of the next rarity, perhaps with a small chance of skipping a tier.
  - The practitioner claim is that Monte Carlo disposes of the most items, and a reveal is good stream content. That is still opinion, not measured.
- Converter-engine check for #15: merge output must be tagged `source: "loot"` (10% recycle). Shop-sourced inputs should be disallowed. Then no merge → recycle → shop cycle returns more than it costs.

### Gaps
- No player study measuring how a 3:1 vs 5:1 vs random recycler changes perceived drop value or engagement.
- Kanai's Cube "destroys the item" and Kadala shard costs remain unverified because those hosts were blocked.

## Q5. Sell-back and recycle fractions: what do shipped games use, and what does Corrupted Raids actually do?

### Takeaway
I found no authoritative "correct" sell-back fraction. The best-attested shipped convention is WoW's vendor buying at **about one quarter** of what it charges. That is a secondary wiki claim, not Blizzard documentation. The primary-source position (Simpson, Lehdonvirta, Koster) is structural: any NPC buy-back prints currency, so it must be lossy and balanced by sinks. In this repo, `recycleRate: 1` refunds 100% of an item's **`value`**, not its shelf price. So the 2,574g staff refunds 600g (23%), and shop refunds are already lossy wherever a price override sits above `value`.

### Cited Findings
- **[SECONDARY, not Blizzard-confirmed] WoW vendor ratio:** the Allakhazam WoW wiki says "A vendor sells items for four times what they will buy them for" (e.g. bought for 20 silver, sold back for 5). A 2006 forum post guesses 10% ("I think"). The Allakhazam page itself returned no content to curl, so this rests on search-result text. **[UNVERIFIED]** — [Allakhazam: Vendor (WoW)](https://wow.allakhazam.com/wiki/Vendor_(WoW)); [WoWInterface forum](https://wowinterface.com/forums/showthread.php?p=29512)
- **[VERIFIED] WoW buyback** is a full-price undo window: "you can buy it back for the same price at which it was sold... up to 12 items". It clears on logout or zoning. — [warcraft.wiki.gg: Vendor](https://warcraft.wiki.gg/wiki/Vendor)
- **[VERIFIED]** Simpson: selling to NPCs "is not a true sink of goods because it involves printing gold". Koster: NPC shops are "just a gold spigot". Lehdonvirta & Castronova: buy-back is "highly acceptable to users, but it creates a new money faucet". (Sources in Q1.)
- **[VERIFIED]** D3's response to "drops feel worthless" was to remove the AH alongside Loot 2.0, not to raise sell prices (Hight post, Q3). PoE's manifesto ties item value to "items matter" and slow upgrades (Q3).
- **[VERIFIED, repo]** `boughtRecycleOf` = `floor(gearValueOf(def) × recycleRate)`, where `gearValueOf` is the item's `value` or its rarity default (`src/engine/shopPricing.ts`). `content/shop.json` prices `shardspire-staff` at **2,574**. `content/gear/shardspire-staff.json` is legendary with no `value` (so 600) and **`"requires": {}`**, meaning no attribute gate, with `atk 10, spd 3, skill 12`.
- Retail analogue (weak, not games): hobby shops pay about 40-60% cash and 65-75% store credit. — [Keystone Games](https://www.keystonegames.net/blogs/keystone-games-community-news-1/the-two-sides-of-the-counter-understanding-card-trade-in-values) (not re-checked this pass)

### Inferences
- The brief's "shop-bought items refund 100%" is only true for items **without** a shelf-price override. With the staff priced at 2,574 against a 600 `value`, buying and recycling it removes 1,974g. It already works as a hard sink.
- Alpha numbers:
  - 69% of 22.4k spend is about 15.5k gold, or roughly **six** staff purchases.
  - Total spend is about 61% of the 36.7k earned.
  - Found-item recycling paid about 9.4g per item (536 / 57), consistent with 10% of mostly uncommon and rare `value`.
- The staff is also **ungated** (`requires: {}`). A legendary anyone can wear from day one, sold on the shelf, is the "shortest path to power is buying" pattern Wilson and GGG describe, on a small scale. It is worth checking whether the concentration of spend reflects aspiration (good) or an ungated power shortcut (the D3 problem).
- **10% loot recycle** is defensible *as a floor* only once merging gives found items a better outlet. The primary sources agree that NPC buy-back is a currency faucet, so a low rate is correct economically. Whether it feels bad depends on other uses existing, which is the D3 and PoE argument.

### Gaps
- No Blizzard-published WoW vendor ratio and no D3/D4 salvage yield table were retrieved (maxroll's D3 materials page returned 404).
- No designer guideline or player study on the "right" sell-back fraction was found.

## Q6. Small economies and chat/stream games: what is known?

### Takeaway
Almost nothing citable. No published design analysis of a Twitch chat game's currency economy (Stream Raiders, Marbles and the like) was found. The only sourced guidance is generic: balance how fast points are earned against what rewards cost. The transferable evidence is from the sources above: consumables are the most accepted sink, sale taxes are the largest, and visible status items (WoW mounts) work as aspiration rather than inflation control.

### Cited Findings
- Stream Raiders (Captain.tv) is described as a free-to-play, streamer-led game in which the audience places units, with cosmetic purchases and revenue share to streamers. No currency or sink documentation was found. — [GamesBeat](https://gamesbeat.com/?p=203980)
- Twitch channel-point guides advise balancing earn rate against reward cost so that the point economy stays meaningful. **[OPINION, low quality]** — [streamchatai guide](https://docs.streamchatai.com/guides/twitch-channel-point-guide/)
- WoW calls its expensive mounts "popular gold sinks to date, due to their high visibility". — [warcraft.wiki.gg: Money](https://warcraft.wiki.gg/wiki/Money)

### Inferences
- Income check (unchanged from the earlier version, still a design estimate): about 5-34g per fight × 5-20 fights is roughly 25-680g per night. Against that, a 110g rare is under one night and a 600g legendary is a few nights.
- Alpha data shows players *will* save for one large, visible item (the staff), which supports "one aspirational purchase". The Simpson and WoW evidence says such an item drains gold only while players still want it, so it cannot be the only sink.
- An order of sinks consistent with the evidence:
  1. Consumables (most accepted).
  2. Merge fee (#15; a sink at the moment of excitement).
  3. Seller-paid, deleted AH tax (#16; EVE's largest sink type).
  4. One or two visible status purchases.
- Measuring this is already possible. `economy` events (`buy_gear`, `recycle_gear` with source and payout, `open_chest`) feed `npm run report:balance`. That is a small-scale version of CCP's faucet/sink chart.

### Gaps
- No published study or postmortem of a chat/stream game economy was found.
- No sourced benchmark for how many sessions an item should take to save for. The "common = one fight ... legendary = a week" ladder from the earlier version remains a proposal.
