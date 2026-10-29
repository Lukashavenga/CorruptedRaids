# Audience-Participation Game Design and "Less Is More" Legible Systems (verification pass)

> **Method note for the report writer.** This is the second pass. The first pass rested only on search snippets. In this pass the main papers were opened and read in full, from the authors' own copies: Seering et al. 2017, Glickman et al. 2018, Striner et al. 2021, both Lessel papers, Aleta & Moreno 2019, Anderson et al. 2013, Jia et al. 2017, Cowan 2001 (abstract), Dai et al. 2014 (abstract) and Hoernle et al. 2020 (abstract). Official docs and developer posts were also read: the Marbles on Stream wiki, the Stream Raiders wiki FAQ, Crowd Control's developer docs and CEO interview, Riot's clarity post, and Rosewater's own podcast transcript.
>
> Some hosts could not be read: dl.acm.org, ScienceDirect (captcha), ResearchGate, GDC Vault (down for maintenance), VentureBeat (bot wall), LIRIAS (no response), and several fan sites behind Cloudflare. WebFetch also could not resolve api.semanticscholar.org, webpages.tuni.fi, researchprofiles.canberra.edu.au, dotesports.com and streamraiders.fandom.com, so those hosts would need allowing in the session's network settings. Two of them were still read another way: the tuni.fi and canberra.edu.au abstract pages through `curl`, and the Stream Raiders wiki text through its public API.
>
> Each finding carries a tag:
> - **[R-full]**: peer-reviewed, full text read.
> - **[R-abs]**: peer-reviewed, abstract only.
> - **[P]**: practitioner, meaning a developer post, interview or talk.
> - **[Doc]**: official game documentation.
> - **[Fan]**: fan wiki or guide, or a vendor blog.
> - **[UNVERIFIED]**: could not be checked against a primary source this pass.
>
> Corrections to the first pass are marked **CORRECTION**.

## Q1. What does the APG research actually say about audience roles, agency, latency and legibility?

### Takeaway
The three CMU-linked papers, read in full, agree. Audiences in APGs want to **see that their own input mattered**. Latency breaks that, and most of all when votes are counted in fixed cycles that viewers cannot see. The key design tension, in Glickman et al.'s words, is information-theoretic: more players giving more input means each player can make **less sense of the game**. A student-designed *idle, role-based* Twitch game (the closest analogue to Corrupted Raids) failed on exactly this: "players also had trouble understanding the impact of different roles... and the effects of game events."

### Cited Findings
**Seering, Savage, Eagle, Churchin, Moeller, Bigham & Hammer, "Audience Participation Games: Blurring the Line Between Player and Spectator," DIS 2017, pp. 429-440, DOI 10.1145/3064663.3064732 [R-full]** — [author PDF](https://joseph.seering.org/papers/Seering_etal_2017_Audience_Participation_Games.pdf)
- Citation confirmed, so this *is* the intended paper. Method: two prototype games (an FPS and a racer), each with four variants (Gifting, Adversary, Combined, Oracle), so eight prototypes. They were played in four one-hour Twitch sessions with **35 audience members in total**, and one round took "between three and five minutes."
- **Taxonomy confirmed in the primary source.** "We identified five categories of audience participants: 'Helpers', 'Power-seekers', 'Collaborators', 'Solipsists', and 'Trolls'." The categories vary on two axes: "the desire to engage with game mechanics, and the desire to engage with other audience members." **CORRECTION:** the first pass labelled this taxonomy as a secondary attribution. It is Seering 2017's own finding.
- Trolls trolled **out of boredom**. One participant: "I kind of got sick of typing the same three things [to help the streamer]. I found it boring, so then i just wanted the game to end, so I switched to enemy mode."
- Player definition (exact): "A player in an APG serves as a coordinator, leader, or primary agent in gameplay, with a consistent and direct role... The audience in aggregate can impact the gameplay, but no single member of the audience is required for the game to progress."
- **Latency (exact):** "when the streamer responds to audience participants on stream, the response is seen between six and more than twenty seconds later." Votes in the racer "usually would not [be seen] counted on screen until at least ten seconds later. This made it difficult to know whether their vote was important." In the FPS, "votes were only totaled every thirty seconds. Due to variable delay, it was almost impossible for viewers to know whether their vote would count in the current thirty second cycle or the next one, directly reducing feelings of individual agency."
- The voting mechanic did not build social bonds. In theory it rewarded voting blocs, but participants "found it more advantageous to simply spam their vote instead." Outside the games, users sent "a total of 10 conversational messages", and during games "no participants ever conversed with each other."
- **Identity markers.** "Absent in Twitch chat are identity markers common in games, such as avatars, character level, and guild tag... a scaffold for strengthening bonds must come from game design rather than the platform itself." Chatbot point totals "and ranking users by points could help clarify social roles", and Choice Chamber "randomly selects a user from active audience participants to have extra powers."
- **Legibility (exact):** "To create a satisfying impact on gameplay, audience participants must be able to understand the game situation, how they might influence it, and how their actions affected the outcome." And: "Richer communication channels, if not paired with careful design for accessibility, may increase the complexity of player interactions while decreasing their sense of impact."
- "We suggest that mechanics that show clear evidence of an individual's contribution will be more likely to capture that individual's interest."
- Audiences self-balanced: in the Combined racer they "voted to help the streamer when he was behind... but voted to hinder him when he got ahead," playing "a role usually taken by game systems: balancing player performance."
- Scale caveat: playtests had "between five and fifteen audience participants." The authors ask, "is it possible to design an APG that is entertaining regardless of audience size?"

**Glickman, McKenzie, Seering, Moeller & Hammer, "Design Challenges for Livestreamed Audience Participation Games," CHI PLAY 2018, pp. 187-199, DOI 10.1145/3242671.3242708 [R-full]** — [author PDF](https://joseph.seering.org/papers/Glickman_etal_2018_Design_Challenges.pdf)
- Six challenges confirmed: "latency, screen sharing, attention management, player agency, audience-streamer relationships, and shifting schedules." Method: three teams over ten months, then four external playtests of 2-5 playtesters each, for twelve game experiences in total.
- **Latency numbers (exact):** "On Twitch, stream latency has been measured at 12 seconds for browsers and 21 seconds for the mobile client, while chat channels... have minimal latency." The source is Zhang & Liu, NOSSDAV 2015, so this is a 2015 measurement.
- **Latency fix in Gods of Socks and Spoons:** players "commit to actions that will play out in a future round... Because rounds are 90 seconds long, which is considerably longer than typical stream latency, audience participants' experience of the stream delay is subsumed in their experience of the round delay."
- **Mid-session joining (directly relevant to late joiners).** In GoSaS, "Audience members are able to join at launch or in mid-stream. Open participant character slots are automatically filled by simple AI-driven non-player characters (NPCs) when an audience member is absent, and are replaced when a new player joins the game." That is a fixed-size team in which joining replaces a bot instead of growing the fight. Caveat: "playtesters were also sensitive to the presence of NPCs... whose presence might also dilute their social or agentic contribution."
- In Pitcrew, "a new audience player can get started in just a few seconds." If someone leaves, "their choices are held constant until the beginning of the next game." Tutorials were moved off the shared stream to the personal interface "so that audience participants could engage with them without depending on the streamer."
- **Voting criticised:** "Existing solutions such as voting were criticized for aggregating player inputs, reducing the sense of agency for each individual audience participant."
- **Crowd size cuts both ways:** some playtesters felt "doing something together" (P10), while others feared "their voice would be lost in the crowd" (P9) or that their contributions "would not have an impact" (P4).
- **Attention:** when confused, players shifted attention. A UI bug produced looking away "an average of once per minute." Players "wanted to be able to predict where their attention should be," and those who "watched several rounds of gameplay before encountering the audience interface... did not report frustration."
- **Design rule for new players (exact):** "designers may need to be cautious about creating moments of high engagement with both the stream and the audience interface; while expert players may find those moments stimulating, new players may simply avoid engaging with the audience participation elements."
- **The core tradeoff (exact):** "As the number of players increases, and the frequency of meaningful input per player increases, the ability for players to make sense of the game as a system decreases. This model suggests design tradeoffs between number of players, meaningful input, and sense-making ability."
- **The "Counterstrike strategy" (exact):** "as characters die and players are eliminated from the match, they enter spectator mode... As the number of players dwindle... the entire game state more and more comprehensible... the sense of a shared group experience for the endgame ramps up." They also propose sports-style breaks for meaning-making, and overlays that summarise "high-level patterns of the game."
- **Validation (exact):** "Viewers competed for the limited attention of the streamer, which served as validation of their social status." This is a designers' framing reported in Glickman. **CORRECTION:** the first pass attributed this to Striner 2021. Striner cites it *from* Glickman ("Glickman [32] explains that... viewers compete for limited streamer attention, a form of validation for viewers").
- Their metaphor is the stream as a "distributed digital hearth... being together is important for its own sake."
- Future-work items that match planned features: "a persistent database to allow streamers to track audience participation across game sessions," and per-viewer customisation "by highlighting their own character."

**Striner, Webb, Hammer & Cook, "Mapping Design Spaces for Audience Participation in Game Live Streaming," CHI 2021, 329:1-15, DOI 10.1145/3411764.3445511 [R-full]** — [CWI open copy](https://ir.cwi.nl/pub/30827/30827.pdf)
- Confirmed: a theme map built on three "sensitizing concepts, Agency, Pacing, and Community," drawn from eight student projects in a Twitch course.
- **Kingdom Builders, the closest analogue to Corrupted Raids:** an "Idle game intended to be played passively by stream viewers. During the game, viewers select a role-based character, and passively help build a kingdom." Reported problem (exact): "Designers struggled to balance the passive nature of idle gaming with customization and player choice. Players also had trouble understanding the impact of different roles of the game, and the effects of game events."
- Pacing themes: "temporality, progression, attention, distraction, engagement, gametime/downtime, and stream schedule." Temporality includes "whether there is a time delay (latency)" and "how much time pressure exists."
- Twitch Meets project quote: "we didn't want to put too many degrees of control as it would give the streamer too much to think about." Its lottery winners "make public their own Twitch handle/presence to the rest of the community." This is a recognition-as-reward mechanic.

**Lessel et al. (Saarland/DFKI) [R-full]**
- "Let's Play My Way" (Lessel, Mauderer, Wolff & Krüger). Authors confirmed. TPP-like shared control, with the finding that "a wider range of techniques than the original TPP offered... can help the audience to organize itself in more nuanced ways." Caveat for the report: this was a LAN setup with **eight** German subjects, so the evidence is weak. — [preprint](https://umtl.cs.uni-saarland.de/paper_preprints/paper_lets_play_my_way_investigating_audience_influence_in_user_generated_gaming_livestreams.pdf)
- "Streamer's Hell" (Lessel, Altmeyer, Sahner & Krüger, CHI PLAY 2022). Confirmed: an online study (n=81) "showed that viewers have mixed feelings and that the context matters"; in a lab study, "six streamers... saw appeal... but also again highlighted that context matters and customization options are necessary." — [preprint](https://umtl.cs.uni-saarland.de/paper_preprints/Lessel-StreamersHell.pdf)

### Inferences
- **The 20s door vote is the Seering FPS problem in miniature.** The risk is not the length of the window. It is viewers not knowing whether their vote landed in this window. The phone page talks to the server with near-zero latency, unlike the video, which is exactly the channel Glickman's teams used. It can show "your vote: LEFT, counted" at once, plus a live countdown. The overlay should show the tally, and the result once it is decided.
- **The auto-resolved fight already uses the GoSaS fix.** Viewers commit before the fight and then watch it, so the stream delay is "subsumed" in the fight's own duration. This is a strong argument for keeping fights non-interactive.
- **The Kingdom Builders failure is the main warning for Corrupted Raids.** A passive, role-based character game becomes illegible if viewers cannot see what their *role* did. The overlay should make each role's effect visible and attributable: "TANK X took the hit," "HEALER Y saved Z."
- The roster ordering of "most recently hit first" fits Seering's "clear evidence of an individual's contribution." Glickman's Counterstrike strategy suggests a further step: when a character dies, its owner becomes a spectator of a shrinking, more legible endgame. Ordering the roster by recent activity naturally pushes the dead down.
- GoSaS's fixed slots, where bots fill empty places and joiners replace bots, are a published precedent for a fight whose **difficulty does not grow with headcount**. It is an alternative to Corrupted Raids' `partyScaling`, but playtesters disliked bots diluting their contribution.
- Seering's identity-marker point ("character level, and guild tag" are missing from chat) argues that names, levels and titles on the overlay are part of the game's job, not decoration.

### Gaps
- Each of the three APG papers has a small sample (35, at most 20, and 8 participants), and all are qualitative. None measures retention or engagement at Twitch scale.
- No APG paper measures how long a join or vote window should be, or tests "visible tally vs hidden tally."
- Twitch latency today is not covered by primary data. The 12s/21s figure is from a 2015 measurement. Twitch said in 2015 that it cut delay "by about a third" by moving from 4-second to 2-second video segments ([GamesBeat, 2015](https://gamesbeat.com/twitch-reduces-livestream-delays-by-about-a-third/)). Current low-latency-mode figures come only from third-party blogs that disagree with each other (about 2-15 s), so they are **[UNVERIFIED]**.

## Q2. What does research say about viewer motivation and social recognition on Twitch?

### Takeaway
The Hilvert-Bruce abstract confirms that social motives (interaction, community, meeting people) explain engagement. It also confirms that viewers of **small channels (<500)** are more socially motivated. The stronger first-pass claim, that community and interaction were "the only motivators that predicted all engagement types", could **not** be confirmed from the abstract or the summary page. No controlled study was found showing that saying a viewer's name strengthens parasocial bonds.

### Cited Findings
- **Hilvert-Bruce, Neill, Sjöblom & Hamari (2018), Computers in Human Behavior 84:58-67, DOI 10.1016/j.chb.2018.02.013 [R-abs].** Exact abstract: "This study trialled an eight-factor socio-motivational model... to explain four aspects of live-stream viewer engagement... (N = 2227). Multiple and ordinal linear regression analyses identified six motivations which helped to explain live-stream engagement: social interaction, sense of community, meeting new people, entertainment, information seeking, and a lack of external support in real life... live-stream viewers who preferred smaller channels (<500 viewers) were more motivated by social engagement than viewers who preferred larger channels." — [Univ. Canberra record](https://researchprofiles.canberra.edu.au/en/publications/social-motivations-of-live-streaming-viewer-engagement-on-twitch/); [Tampere Gamification Group page](https://webpages.tuni.fi/gamification/2018/09/14/social-motivations-of-live-streaming-viewer-engagement-on-twitch/)
  - **CORRECTION / UNVERIFIED:** the first pass's claim that "sense of community and social interaction were the only motivators that predicted all engagement types (emotional connectedness, watch time, subscription length, donations)" is **not in the abstract or on the Tampere page**, which reproduces only the abstract. The names of the four engagement measures are also unconfirmed. The full text is paywalled (ScienceDirect captcha).
- Glickman et al. 2018 [R-full]: "Socially engaged viewers seek to connect with the streamer and other audience members, and to acquire social status within the audience community." Also: "Streamers and audiences also interact with one another socially, such as when streamers acknowledge audience members who have donated money or subscribed." — [PDF](https://joseph.seering.org/papers/Glickman_etal_2018_Design_Challenges.pdf)
- Seering et al. 2017 [R-full]: Power Seekers "sought individual recognition, and felt that collaborating with others could diminish their individual impact on the game." — [PDF](https://joseph.seering.org/papers/Seering_etal_2017_Audience_Participation_Games.pdf)
- Striner et al. 2021 [R-full] cite Jia et al. 2016: "content creators often focus on their individual skills, whereas viewers appreciate team dynamics." — [PDF](https://ir.cwi.nl/pub/30827/30827.pdf)
- **By-name acknowledgement → parasocial bond: [UNVERIFIED].** A targeted search found only descriptive articles saying streamers address viewers by name, plus survey work linking parasocial relationships to enjoyment. No experiment was found. — [search: afkgaming.com](https://afkgaming.com/global/parasocial-relationships-in-gaming-the-emotional-bonds-between-streamers-and-their-audiences) (opinion-level)
- Hamilton, Garretson & Kerne, CHI 2014 (friendliness and the stream's unique social atmosphere) appears in both Striner's and Glickman's reference lists. That confirms the paper exists, but its findings were **not re-checked** this pass. — [Striner PDF refs](https://ir.cwi.nl/pub/30827/30827.pdf)

### Inferences
- The <500-viewer result matters for Corrupted Raids. A mid-sized streamer's chat is the most socially motivated audience there is. Putting names on stream (the roster, the title, "X took the hit") is cheap and aimed straight at that motive.
- Seering's Power Seekers want *individual* recognition, which group votes dilute. A "Dungeoneer of the day" title and per-hit name callouts give that motive an outlet that does not let one person steer the shared fight.

### Gaps
- The Hilvert-Bruce full text, needed for per-outcome regression results.
- No experiment isolates name-callouts as a variable.

## Q3. What do Twitch Plays Pokémon and its analysis actually show about crowd control, vote windows and delay?

### Takeaway
The first-pass numbers were partly wrong. Democracy mode's tally window was **5 seconds** at first, then **10 seconds** after the first relaunch, then **5 seconds** under the tug-of-war system, per Aleta & Moreno. Wikipedia says "usually 30 seconds." The supermajority thresholds were 75% to enter Democracy and 25% to leave, later 80% and 50%. Measured delay was **20-30 s**. The vote split the crowd into lasting factions.

### Cited Findings
- **Aleta & Moreno (2019), "The dynamics of collective social behavior in a crowd controlled game," EPJ Data Science [R-full].** — [EPJ Data Science](https://epjdatascience.springeropen.com/articles/10.1140/epjds/s13688-019-0200-1)
  - Delay (exact): "a delay of between 20 and 30 seconds between the stream and the chat window. That is, users had to send their commands based on where the player was up to 30 seconds ago." The delay "varied depending on the number of players, the load of Twitch servers... the particular lag at every moment is undetermined."
  - First voting attempt (exact): "commands were not executed right away. Instead, they were added up and every 5 seconds the most voted command was executed. However, the crowd did not like this system and started to protest by sending start9." When it came back, "votes would tally up over a period of 10 seconds."
  - Tug-of-war (exact): "if the fraction of users sending democracy... went over 0.75 (later modified to 0.80) the game would enter into democracy mode and commands would be tallied up for 5 seconds. Then, the meter had to go below 0.25 (later modified to 0.50) to enter into anarchy mode again."
  - Polarisation: "Out of nearly 400,000 players who participated in the tug-of-war... 54% were democrats, 28% anarchists and 18% voted at least once for both." Abstract: "the introduction of this system clearly polarized the community, splitting it in two."
  - Non-conformists (exact): "having a fraction of players who do not follow the crowd's average behavior is key to succeed in the game."
  - Participation was long-tailed: 46% of users in the analysed period sent 1-2 commands, and only 5% sent more than 25.
  - Democracy was accepted only at the hard puzzle: "Democracy was only 'allowed' by the crowd when they were right in front of the puzzle and they would go into anarchy mode quickly after finishing it."
- **Wikipedia, Twitch Plays Pokémon [secondary, cites Twitch blog].** — [Wikipedia](https://en.wikipedia.org/wiki/Twitch_Plays_Pok%C3%A9mon)
  - Democracy mode was introduced on 18 February 2014. "On introduction... all inputs received over a period of time (usually 30 seconds) were tallied." **This conflicts with Aleta & Moreno's 5s/10s.** Aleta & Moreno are the stronger source (data analysis), though the "30 seconds" may refer to a later phase.
  - Participation: "Twitch estimated that over 1.16 million people participated, with peak simultaneous participation at 121,000." Another passage gives "an estimated 658,000 had participated" alongside a "peak concurrent viewership of 120,000." **CORRECTION:** the first pass gave only 658,000. Sources conflict, and Aleta & Moreno say "nearly a million players."
  - In Crystal (season 2), "Democracy mode was automatically activated at the top of each hour."
- **CORRECTION:** the first pass cited "20-40 s" of lag from student reportage. The peer-reviewed figure is **20-30 s** (Aleta & Moreno).

### Inferences
- TPP's Democracy windows (5-10 s) were *shorter* than its 20-30 s delay, and the crowd still finished, by voting at what it saw up to 30 s earlier. Corrupted Raids' 20 s window for a decision that is independent of the delay (which door) is more forgiving than anything TPP ran.
- TPP shows the danger of a *meta-vote* (how to vote) more than a vote itself. The vote produced a lasting 54/28 identity split. Corrupted Raids' door votes are per-round and cannot create a lasting faction, which is good. A future "mode" vote should be avoided.
- The finding that non-conformists are "key to succeed" partly supports Corrupted Raids' random tie-break and random open-on-silence. The crowd should never be able to stall.

### Gaps
- The exact Democracy tally window per phase is still unresolved (5 s vs 10 s vs 30 s). Bulbapedia was blocked by Cloudflare.
- No primary source was found for the "1.16 million" figure beyond the dead Twitch blog link that Wikipedia cites.

## Q4. How do shipped audience games handle join windows, late joiners, participation vs. winning rewards, and caps?

### Takeaway
Shipped games all **close entry before resolution**:
- Marbles: `!play` only "when registration opens."
- Stream Raiders: a "placement period."
- Streamlabs heist: a "start delay," then it runs.
- Marbles Tilted: re-join "for every level."

Several **pay participation, not only wins**: Stream Raiders gives Loyalty "for a win or loss" and a salvage chest on a loss, Tilted pays "all survivors... equal points," and Pokémon Community Game pays for chat activity. Several **cap farming** with timers rather than daily energy. Marbles goes further: bigger lobbies *increase* rewards. No shipped game found scales *difficulty* up with late headcount.

### Cited Findings
**Marbles on Stream (Pixel by Pixel Studios) [Doc: official wiki]**
- Joining: "Type !play — Join when registration opens." "Race Mechanics: Streamers host races and control the camera. Viewers earn points based on placement." — [Racing wiki](https://wiki.pixelbypixel.studio/racing)
- **Lobby size raises rewards:** "Lobby Size Matters: More players in a race means more positions earn points — bigger lobbies reward more racers." **Gather time:** "The lobby timer affects points — don't rush too fast or wait too long." The point system is "intentionally complex — designed to reward multiple play styles and prevent any single dominant strategy." — [Racing wiki](https://wiki.pixelbypixel.studio/racing)
- **Anti-farming:** "When you join a season-enabled race, you get a 10-minute timer with that streamer... You can have up to 3 active timers at once... If you have 4 or more active timers, you're timed out and can't earn season points from ANY stream." Also, "Matches over 45 minutes have diminishing returns on XP." — [Racing wiki](https://wiki.pixelbypixel.studio/racing)
  - **CORRECTION:** the first pass cited a daily "energy" cap from a forum post about 1,500 days old. The current official wiki describes the 3-timer system and does not mention energy, so the energy claim should be treated as **outdated**.
- Lap races: "Only the top 3 finishers earn season points." Royale: "ONLY the winner earns points!" and "Bigger lobbies mean bigger rewards for the winner." Tilted: "Cooperative survival... All survivors earn equal points," and "You must type !play for every level of Tilted to participate." — [Racing](https://wiki.pixelbypixel.studio/racing); [Royale](https://wiki.pixelbypixel.studio/royale); [Seasons](https://wiki.pixelbypixel.studio/seasons); [Tilted](https://wiki.pixelbypixel.studio/tilted)
- Seasons: "6 weeks (42 days)," "1 day between seasons," "Global rankings reset each season," "Top Rewards: Exclusive seasonal marble skins." Etiquette tip: "When entering your first match of the day, say 'hey'." — [Seasons wiki](https://wiki.pixelbypixel.studio/seasons)
  - **CORRECTION / UNVERIFIED:** the first pass's prize ladder (1,000 Marble Money for 1st down to 30 Tournament Coins for places 4-100, and 10 Champion Points unlocking an emote slot) is **no longer on the Steam store page**. That page now says "Climb the leaderboards, earn Season XP, and make your marble the one chat recognizes" and mentions "Sub-only and account-only joining, session leaderboards." — [Steam](https://store.steampowered.com/app/1170970/Marbles_on_Stream/)
- Local leaderboards (official guidance, not research): "Even small recognition like shoutouts can make local leaderboards exciting," and "Weekly or monthly resets give new players a chance to compete." — [Local Leaderboards wiki](https://wiki.pixelbypixel.studio/local-leaderboards)

**Stream Raiders (Captain.tv / Sandbox Strategies)**
- [P] Designer Kevin Paskowski: viewers "can place units on a map while streamers are live streaming their main content. When a battle is ready to begin streams can switch to streaming Stream Raiders"; "players did not have control of their units after the battle started, but watched a simulation with their favorite streamer." **Legibility design (exact):** "Levels had to be designed so that interesting battle blobs formed on screen for streamers to call out and do play by play / color commentary. This meant splitting levels up into several main lanes." — [Paskowski portfolio](https://paskowski.com/stream_raiders.html)
- [Fan wiki] Placement "can be repeated once every 5 minutes. (max 6 units per battle)." "If you placed an unit you cannot leave until after the placement period is completed. The placement period duration can be found at the top right of a Captain's screen." **Participation pay:** "You earn Loyalty each time a captain completed a raid you've placed an unit in. A win or loss in Campaign mode reward 2 Loyalty." On a loss, "collect the Salvage Chest for some potions." — [Stream Raiders wiki FAQ](https://streamraiders.fandom.com/wiki/FAQ)
- [Fan wiki] "You earn gold by participating in battles, and you earn 1 scroll for a unit each time you place it in battle... higher difficulty battles have a greater chance of awarding higher rarity unit scrolls." — [Unit Leveling](https://streamraiders.fandom.com/wiki/Unit_Leveling)

**Crowd Control (Warp World)**
- [P, Twitch official blog, 2019]: "to keep the flow of incoming items manageable and fun for the streamer, viewers exchange Twitch Bits for Crowd Control Coins... Items which carry a stronger effect on the game require more Coins, which effectively limits over usage." — [Twitch blog](https://blog.twitch.tv/en/2019/02/15/the-evolution-of-speedrunning-crowd-control-caf6e259e848/)
- [P, CEO interview] **Why refunds exist:** "the main reason is that Bits were not able to be refunded. If an effect didn't happen, the user would be out their Bits, and that didn't sit well with us." **UX:** "when it first launched the UI/UX was horrible... We had to throw everything out the window... make it so that first-time users don't have to ask any questions." — [Game Rant](https://gamerant.com/crowd-control-2-interview-new-features/)
  - **CORRECTION:** the first pass paraphrased this as "rebuilt so that new users need no instructions." The exact wording is "first-time users don't have to ask any questions."
- [Doc] Developer docs define `FailTemporary` ("reinserted into the back of the effect queue and retried at a later time... the desired non-success state in most cases") and `FailPermanent` ("removed from the player's list of available effects"). **CORRECTION:** this docs page does **not** itself mention refunds. — [CC dev docs](https://developer.crowdcontrol.live/unity/tutorial/first-effect.html)
- [Fan/vendor, search summary only, UNVERIFIED] Warp World's blog reportedly says an effect left in the queue for about 5 minutes without triggering is refunded automatically, and that pooled coins go back if the effect does not trigger. The page renders with JavaScript and was not read. — [crowdcontrol.live blog](https://crowdcontrol.live/blog/how-crowd-control-coins-work)

**Pokémon Community Game (gap from the first pass, now partly filled) [Fan]**
- "During stream every 15 minutes a wild Pokémon appears in chat. You can use your pokeballs to attempt to catch it." — [wopi.tv streamer FAQ](https://wopi.tv/en/pcg/)
- Commands: `!Pokecatch [ball]`, `!Pokeshop`, `!Pokepass`. "You earn currency or 'Poke Dollars' from participating in the streams featuring the extension by typing at least once every 15 minutes." Daily: "Once per day (roughly once every 20 hours), you can type '!Pokedaily'" in the Discord. Ranked battles: "all pokemon scaling to level 50 during battle." Fan observation: "catching pokemon is quite limited." Community tournaments run "a few times a week... with all participants earning coins." — [Ace Game Guides (fan)](https://acegameguides.wordpress.com/2022/07/12/pokemon-community-game/)

**Generic chat minigames: Streamlabs Cloudbot Heist [Doc]**
- "Min. Entries: The minimum amount of people required to join the heist before it starts. If this value is not met everyone will be refunded... Start Delay: This is the number of seconds before the heist starts once initiated by the first user. Cooldown: ...the amount of time in seconds the heist will be unavailable after it has concluded." — [Streamlabs modules guide](https://streamlabs.com/content-hub/post/how-to-use-modules-in-streamlabs-desktop-cloudbot-101)
- [UNVERIFIED, search summary] A Streamer.bot "Bank Heist" community script uses `heistJoinTime` and a default `heistCooldown` of 300 s. — [Streamer.bot extensions](https://extensions.streamer.bot/t/minigame-bank-heist/3402)

**Carried over, not re-checked this pass [UNVERIFIED]:** Jackbox/Quiplash audience of 10,000 ([PlayStation Blog](https://blog.playstation.com/2015/06/30/quiplash-new-party-game-expands-audience-participation-to-10000/)); Choice Chamber's chat polls (Seering 2017 confirms that "Choice Chamber relies on a chatbot to broadcast polls to audience participants, mitigating issues associated with video feed delay").

### Inferences
- **Late joiners.** Marbles makes a bigger lobby pay *more*. Corrupted Raids' `partyScaling` makes every extra joiner tougher for everyone, the opposite signal. Published and shipped options:
  - **Freeze headcount at a visible cutoff.** This is the Streamlabs start delay and the Stream Raiders placement period. A late joiner rides along or waits for the next run.
  - **Fixed slots.** GoSaS: bots fill empty places and joiners replace them, so difficulty stays constant.
  - **Make the crowd bonus explicit.** Marbles: more bodies mean more rewards or more loot rolls, so a joiner is visibly a gain.
  - **Normalise power in the contest.** PCG scales everyone to level 50 in battles.
- **Minimum entries with refund** (Streamlabs) maps onto Corrupted Raids' `refund: true`. It is a cheap, legible rule for "not enough people turned up."
- **Participation pay is standard.** Stream Raiders gives Loyalty for a win or loss and a salvage chest on a loss, and Tilted pays all survivors equally. This validates Corrupted Raids paying casualties and defeats.
- **Frequent small rewards versus a level-up.** PCG's activity currency (every 15 min) and daily `!Pokedaily` show a split. Frequent, low-salience rewards sit in currency, and rare, high-salience events (a shiny, a legendary, a tournament win) carry the status. That argues for keeping levels rare and visible, and letting gold or XP tick quietly.
- **Caps.** Marbles' 3-timer and 45-minute diminishing-returns rules are precedents for capping how much one heavy viewer can farm, relevant to "Dungeoneer of the day."

### Gaps
- **No Marbles on Stream developer interview or postmortem was found.** Searches returned only the studio listing (Toronto). The wiki and Steam page are the only primary sources.
- No official Pokémon Community Game documentation was readable. The figures above come from fan sources.
- No shipped game was found that documents *difficulty* scaling with late headcount. This appears to be particular to Corrupted Raids.

## Q5. What does research say about leaderboards, badges, titles, daily resets and "player of the day"?

### Takeaway
- **Leaderboards motivate some people and demotivate others.** In a 286-person CHI study, extraverts liked them most. In a 125-learner preference study, leaderboards were picked "worst" more often than "best."
- **Badges steer, but mostly a minority.** Anderson et al. found users accelerate as they near a badge. Hoernle et al. found only **about 20%** of Stack Overflow users respond to badges; the first pass's "5-30%" is **corrected**.
- **No study of daily titles or "player of the day" exists** that was found. The closest research is the **fresh start effect**: temporal landmarks such as a new week or a new day plausibly motivate renewed effort.

### Cited Findings
- **Anderson, Huttenlocher, Kleinberg & Leskovec, "Steering User Behavior with Badges," WWW 2013 [R-full].** Exact predictions confirmed on Stack Overflow data: "(i) If a certain level of activity of a particular type is rewarded by a badge, users will increase their activity of this type as they approach the level needed for the badge... (iii) The extent of steering depends on how close the user is to the badge boundary—an 'acceleration' effect." — [PDF](https://archives.iw3c2.org/www2013/proceedings/p95.pdf)
- **Hoernle, Kehne, Procaccia & Gal, "The Phantom Steering Effect in Q&A Websites" (arXiv 2002.06160; IEEE ICDM 2020) [R-abs].** Exact: "the majority of users remain apathetic toward badges, while still providing a substantial number of contributions... a small population, approximately 20%, of users respond to the badge incentives." They urge research into "other aspects of reward systems such as Stack Overflow reputation points." — [arXiv](https://arxiv.org/abs/2002.06160)
  - **CORRECTION:** the first pass said "about 5-30%" and cited a 2021 KAIS paper. The version read here says **about 20%**. The KAIS page (Springer) did not load, so whether the journal version reports a range is **UNVERIFIED**.
- **Jia, Liu, Yu & Voida, "Designing Leaderboards for Gamification: Perceived Differences Based on User Ranking, Application Domain, and Personality Traits," CHI 2017 [R-full].**
  - Survey of **286 participants** with mock leaderboards placing the respondent at the top, middle or bottom: "a respondent's position on the leaderboard had important effects on their perception of the leaderboard and the surrounding app... More extraverted people reported more positive experiences with leaderboards despite their ranking or the application domain."
  - It reviews prior work: "leaderboards were only effective in motivating some users; for some other users, they could actually become a demotivating factor." It also notes Zichermann's "no-disincentive" leaderboard, which shows the user in the middle.
  - Its advice: "designers should not only design leaderboards as a way of showing rankings, but also emphasizing changes."
  - Caveat: it uses hypothetical mock-ups, not real effort.
  - [PDF](https://stephen.voida.com/uploads/Publications/Publications/jia-chi17.pdf)
- **Marquardt, Schulz, Koziolek & Happe (arXiv 2512.08551, Dec 2025, preprint under review) [R-full, not yet peer reviewed].** Best-worst scaling with **125 learners** across ten game elements. "Progress bar emerged as the most preferred," followed by achievements and feedback. Leaderboards were chosen best 137 times and worst 240 times. One participant: "Leaderboards can be both motivating and demotivating depending on how competiti[ve]." — [arXiv](https://arxiv.org/pdf/2512.08551)
  - **CORRECTION:** the first pass cited this preprint for the Leung 2019 and Chan et al. 2018 claims ("public displays of poor performance are demotivating", "can hurt self-esteem"). Those names were not found in its text. The two claims are **UNVERIFIED** as to source.
- **Dai, Milkman & Riis, "The Fresh Start Effect: Temporal Landmarks Motivate Aspirational Behavior," Management Science 2014 [R-abs].** Exact: "Google searches for the term 'diet' (Study 1), gym visits (Study 2), and commitments to pursue goals (Study 3) all increase following temporal landmarks (e.g., the outset of a new week, month, year, or semester; a birthday; a holiday)... these landmarks... relegate past imperfections to a previous period." — [Wharton PDF](https://faculty.wharton.upenn.edu/wp-content/uploads/2014/06/Dai_Fresh_Start_2014_Mgmt_Sci.pdf)
- Seering et al. 2017 [R-full]: "ranking users by points could help clarify social roles and encourage interaction." — [PDF](https://joseph.seering.org/papers/Seering_etal_2017_Audience_Participation_Games.pdf)
- **Carried over, not re-checked [UNVERIFIED]:** Amo et al. 2020 on competitiveness splitting the effect ([ICCE](https://library.apsce.net/index.php/ICCE/article/download/841/781/1523)); a WSU 2025 dissertation proposing tiered leaderboards ([WSU](https://rex.libraries.wsu.edu/view/pdfCoverPage?instCode=01ALLIANCE_WSU&filePid=13426047850001842&download=true)); the position-effect studies in Emerald/Internet Research and Augsburg ([Emerald](https://www.emerald.com/intr/article/33/7/1/178330/How-leaderboard-positions-shape-our-motivation-the); [Augsburg](https://opus.bibliothek.uni-augsburg.de/opus4/files/127063/127063.pdf)).
- Reset frequency: a targeted search found **no rigorous study comparing daily, weekly or monthly resets**. Only vendor blogs turned up (for example, a leaderboard vendor's self-reported "3.4x" competition on reset boards, which is not peer reviewed). — [Yu-kai Chou (opinion)](https://yukaichou.com/gamification-study/why-most-leaderboards-fail-and-how-to-fix-yours-in-5-steps/)

### Inferences
- **"Dungeoneer of the day" should be a title, not a ranked list.** Jia and Marquardt both show that ranked lists cut both ways. A single named holder, with nobody shown "last," avoids the bottom-rank harm. If any ranking is shown, Zichermann's middle-of-the-board view and Jia's "emphasise changes" ("Y climbed 3") are the softer forms.
- **The daily reset has indirect research support.** A new day is a minor temporal landmark (fresh start effect), and Marbles' official guidance says resets "give new players a chance to compete." There is no direct evidence that *daily* is the right period.
- **Expect the title to move about one viewer in five** (Hoernle). The other 80% need participation rewards, which Corrupted Raids already pays.
- **Levels too frequent.** Anderson's acceleration effect shows that people push hardest *near* a visible threshold. Frequent level-ups mean the bar is always nearly full and the push never builds. Fewer, larger thresholds, with the bar visible on the phone page, put more time in the "approaching the badge" zone where steering is strongest. Marquardt's finding that progress bars are the most preferred element supports making the bar itself the reward surface.
- **Volume risk.** A "most survived today" title rewards attendance. Marbles caps farming through its timers and 45-minute diminishing returns. A minimum-runs threshold plus survival *rate*, or several daily callouts (first clear, biggest hit taken), would spread recognition.

### Gaps
- No study of "player of the day" or daily-title mechanics, in games or on streams.
- No study of newcomer retention under a single named title versus a full leaderboard.
- Leaderboard research comes from education, fitness and productivity, often with mock-ups. Whether it transfers to Twitch chat is untested.

## Q6. What principles produce simple, legible systems, and is there research on spectator legibility and HUD density?

### Takeaway
The practitioner quotes check out, with one exception: Meier's "interesting once, not ten times" line was **not found** in the GDC 2012 writeup. Rosewater's "Restrictions breed creativity" is confirmed as lesson **#18** by Rosewater himself. Koster's "Fun is just another word for learning" and Cowan's "about four chunks" are confirmed. New this pass on spectator legibility:
- Glickman's information-theoretic tradeoff (Q1).
- Riot's published clarity rules: convey gameplay clearly, preserve hierarchy, keep noise minimal.
- An esports-dashboard study (Charleer et al., CHI PLAY 2018), read at abstract level only, which found spectators want interpretive help, though how much to show is a challenge.

### Cited Findings
- **Sid Meier, "Interesting Decisions," GDC 2012 [P, via Game Developer writeup by Leigh Alexander]** — [Game Developer](https://www.gamedeveloper.com/design/gdc-2012-sid-meier-on-how-to-see-games-as-sets-of-interesting-decisions)
  - "If a player always chooses the first from among a set of three choices, it's probably not an interesting choice; nor is a random selection."
  - "One common characteristic of interesting decisions is that they involve some kind of tradeoff — say, the opportunity to get a big sword costs 500 gold, or in a racing game the fastest car may have poorer handling."
  - "Good decisions are situational."
  - **Informed choices:** "It's almost worth erring on the side of providing the player with too much information, or at least enough that they're comfortable with understanding the choices."
  - **CORRECTION / UNVERIFIED:** the quote "Something that's interesting you do once doesn't mean it's something interesting to do ten times," and the cut secondary tech tree in Civilization, are **not in this writeup**. The VentureBeat source is behind a bot wall. Treat them as unverified.
- **Mark Rosewater, "Twenty Years, Twenty Lessons," GDC 2016 [P].** Rosewater's own podcast: "So I'm up to lesson number 18, Restrictions Breed Creativity. So a quick caveat, this is probably the lesson I'm most associated [with]." He describes the practice: "sometimes when you're stuck, take a restriction that's not necessary, but put it in anyway." This resolves the first pass's numbering conflict: it is **#18**. — [Drive to Work #529 transcript](https://podscripts.co/podcasts/magic-the-gathering-drive-to-work-podcast/529-20-lessons-creativity); [GDC Vault listing](https://www.gdcvault.com/play/1023186/) (members-only, and down for maintenance during this pass)
- **Raph Koster, *A Theory of Fun for Game Design* [P].** His own slides open: "'Fun is just another word for learning.'" — [Koster, "Theory of Fun 10 Years Later" (PDF)](https://www.raphkoster.com/wp-content/uploads/2026/07/Theory-of-Fun-10-Years-Later.pdf). Book quotes, community-sourced and not verified against the page: "The definition of a good game is therefore 'one that teaches everything it has to offer before the player stops playing.'"; "Boredom is the opposite of learning. When a game stops teaching us, we feel bored."; and, most relevant to legibility, "Noise is any pattern we don't understand." — [Goodreads quotes](https://www.goodreads.com/author/quotes/10980.Raph_Koster)
- **Cowan (2001), Behavioral and Brain Sciences 24:87-185 [R-abs].** Exact: "Others have since suggested that there is a more precise capacity limit, but that it is only three to five chunks... A single, central capacity limit averaging about four chunks is implicated." This holds only under boundary conditions, for example "when information overload limits chunks to individual stimulus items." — [Cambridge PDF](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/44023F1147D4A1D44BDC0AD226838496/S0140525X01003922a.pdf/the-magical-number-4-in-short-term-memory-a-reconsideration-of-mental-storage-capacity.pdf)
- **Riot Games, "Clarity in League" (dev post, 12 March 2021) [P].** "We see clarity as the ability to understand what's happening in League and respond to it." The three goals: "First and foremost, gameplay should be clearly conveyed... The second goal is to always preserve hierarchy. This is a fancy way of saying that the most important thing at any given moment (like a major ultimate or CC) should draw the most attention... Finally, noise should be kept minimal... visual noise adds up quickly... (Exception: Spells with big gameplay effects can and should be noisy, to a degree.)" On silhouettes: "Silhouettes are the single most important thing for champion recognition," and "larger champions with bulky armor are probably tanks." — [Riot Games](https://www.riotgames.com/en/news/dev-clarity-in-league)
- **Glickman et al. 2018 [R-full], on spectator density:** "games that are popular in the digital stadium (e.g. League of Legends) demand the audience's close attention... and require the audience to have significant skills to 'read' the game." This contrasts with the "hearth" model, which suits small, social streams. — [PDF](https://joseph.seering.org/papers/Glickman_etal_2018_Design_Challenges.pdf)
- **Charleer, Gerling, Gutiérrez, Cauwenbergh, Luycx & Verbert, "Real-Time Dashboards to Support eSports Spectating," CHI PLAY 2018, pp. 59-71 [R-abs, via search snippet; PDF did not load].** The authors designed dashboards from surveys (788 responses) and evaluated them with 18 experienced viewers of League of Legends and CS:GO. Spectators showed "a strong interest in the dashboard to support their interpretation of gameplay, but also revealed a number of challenges." A secondary summary says that balancing information density was a major challenge and that too much information raises cognitive load. — [LIRIAS](https://lirias.kuleuven.be/retrieve/515432)
- Paskowski on Stream Raiders [P]: levels were designed so "interesting battle blobs formed on screen for streamers to call out," using lanes "similar to League of Legends or DoTA maps." — [portfolio](https://paskowski.com/stream_raiders.html)
- Crowd Control's CEO [P]: the goal is that "first-time users don't have to ask any questions." — [Game Rant](https://gamerant.com/crowd-control-2-interview-new-features/)
- The "five or more elements" and "67% more errors" UX claim from the first pass remains an **unsourced rule of thumb**. — [uxuiprinciples.com](https://uxuiprinciples.com/en/principles/working-memory)

### Inferences
- **Overlay hierarchy (Riot plus Cowan).** About four chunks of attention, with one "most important thing" at any moment. For example: party health, enemy health, the single latest notable event (a big hit, a death, a heal save), and the level banner. The roster reads as one list-chunk. Riot's exception applies: a boss ability or a party wipe *should* be loud.
- **Stream Raiders' "battle blobs" and Riot's silhouettes are the same idea.** Readable clusters and a recognisable role per body let a streamer narrate. In Corrupted Raids, role art (tank bulk, healer staff) should carry the role at a glance, as Riot's silhouette rule does.
- **Meier's "err on too much information" and "less is more" do not conflict.** Meier is talking about information at the moment of a *choice*: the door vote and gear on the phone page. The overlay is for *watching*. The phone page can carry detail (Glickman: tutorials and personal information go there), and the overlay carries hierarchy.
- **Glickman's Counterstrike endgame is a concrete legibility lever.** As bodies fall, the fight should get *simpler* to read, with fewer bars and a bigger focus on survivors, rather than staying constant.
- **Koster's "Noise is any pattern we don't understand" restates the Kingdom Builders failure.** Role effects that viewers cannot see are noise. A level-up that changes only an invisible number is noise too. This supports fewer, more visible level-ups.
- **Rosewater #18 supports the settled cuts** (one shared fight, levels only, four stats) as deliberate restrictions.

### Gaps
- Charleer et al.'s full text and recommendations were not read (LIRIAS did not respond).
- There is still no peer-reviewed number for a maximum count of on-screen elements in a game HUD. "About four" is extrapolated from Cowan.
- Meier's "ten times" quote needs the GDC Vault video (37:00-44:37 covers "Making Decisions More Interesting," per a [course reader](https://computerscience.chemeketa.edu/cis125greader/Choice/BossBattle.html)), and the Vault was down during this pass.
- The Koster book quotes beyond the slide are community-sourced; page numbers were not checked.

## Q7. Verification ledger: which first-pass claims changed?

### Takeaway
Most first-pass claims survived. Eleven were corrected and several were downgraded to unverified. The corrections that matter most for design are TPP's real vote windows (5-10 s) and delay (20-30 s); badge steering at about 20% rather than 5-30%; Marbles' anti-farming now being a 3-timer system rather than energy; and the attention-as-validation line belonging to Glickman, not Striner.

### Cited Findings
- Seering's five-type taxonomy: **upgraded** from secondary to primary. — [Seering 2017](https://joseph.seering.org/papers/Seering_etal_2017_Audience_Participation_Games.pdf)
- "Viewers compete for limited streamer attention as validation": **re-attributed** to Glickman 2018 (Striner cites it). — [Glickman 2018](https://joseph.seering.org/papers/Glickman_etal_2018_Design_Challenges.pdf); [Striner 2021](https://ir.cwi.nl/pub/30827/30827.pdf)
- Hilvert-Bruce "only motivators that predicted all engagement types": **downgraded to unverified**. The abstract confirms the six motivations and the <500-channel finding only. — [Canberra record](https://researchprofiles.canberra.edu.au/en/publications/social-motivations-of-live-streaming-viewer-engagement-on-twitch/)
- TPP Democracy window "20s or 5s": **corrected** to 5 s, then 10 s, then 5 s under the tug-of-war (Aleta & Moreno), with Wikipedia's "usually 30 seconds" conflicting. Thresholds **corrected** to 0.75/0.25, later 0.80/0.50. Delay **corrected** to 20-30 s. Participant count **conflicting**: 658,000, about 1 million, or 1.16 million. — [Aleta & Moreno](https://epjdatascience.springeropen.com/articles/10.1140/epjds/s13688-019-0200-1); [Wikipedia](https://en.wikipedia.org/wiki/Twitch_Plays_Pok%C3%A9mon)
- Twitch delay: **new primary-cited figure** of 12 s (browser) and 21 s (mobile) from a 2015 measurement, and Seering's "six and more than twenty seconds." — [Glickman 2018](https://joseph.seering.org/papers/Glickman_etal_2018_Design_Challenges.pdf); [Seering 2017](https://joseph.seering.org/papers/Seering_etal_2017_Audience_Participation_Games.pdf)
- Marbles energy and daily-reset cap: **outdated**, replaced by 10-minute timers with a maximum of 3 and diminishing returns after 45 minutes. Season prize ladder: **no longer on the store page**. — [Marbles Racing wiki](https://wiki.pixelbypixel.studio/racing); [Steam](https://store.steampowered.com/app/1170970/Marbles_on_Stream/)
- Crowd Control refund: **re-sourced** to the CEO's interview. The dev-docs page itself does not mention refunds. The UX quote was **corrected** to its exact wording. — [Game Rant](https://gamerant.com/crowd-control-2-interview-new-features/); [CC docs](https://developer.crowdcontrol.live/unity/tutorial/first-effect.html)
- Phantom Steering: **corrected** to "approximately 20%" (arXiv/ICDM version). — [arXiv 2002.06160](https://arxiv.org/abs/2002.06160)
- Leung 2019 and Chan 2018 claims: **source not found** in the cited preprint, so unverified. — [arXiv 2512.08551](https://arxiv.org/pdf/2512.08551)
- Meier "ten times" quote: **unverified**, not in the Game Developer writeup. — [Game Developer](https://www.gamedeveloper.com/design/gdc-2012-sid-meier-on-how-to-see-games-as-sets-of-interesting-decisions)
- Rosewater numbering: **resolved** as #18. — [podcast transcript](https://podscripts.co/podcasts/magic-the-gathering-drive-to-work-podcast/529-20-lessons-creativity)
- Koster and Cowan: **confirmed**. — [Koster slides](https://www.raphkoster.com/wp-content/uploads/2026/07/Theory-of-Fun-10-Years-Later.pdf); [Cowan](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/44023F1147D4A1D44BDC0AD226838496/S0140525X01003922a.pdf/the-magical-number-4-in-short-term-memory-a-reconsideration-of-mental-storage-capacity.pdf)
- Lessel "Let's Play My Way": the finding is **confirmed**, but **sample size added** (eight subjects, LAN). — [preprint](https://umtl.cs.uni-saarland.de/paper_preprints/paper_lets_play_my_way_investigating_audience_influence_in_user_generated_gaming_livestreams.pdf)

### Inferences
- None of the corrections reverses a first-pass design recommendation. Several make them sharper:
  - The vote problem is visibility of *which window* a vote counted in, not window length.
  - Badge-style incentives move about a fifth of people.
  - Shipped games reward bigger lobbies rather than punishing them.

### Gaps
- Still unread in full: Hilvert-Bruce 2018, Charleer et al. 2018, the KAIS journal version of Phantom Steering, Jackbox and Choice Chamber developer sources, and any Marbles on Stream developer interview (none found).
