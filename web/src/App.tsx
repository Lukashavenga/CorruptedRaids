import { useMemo, type ComponentType } from "react";
import { useGameConnection } from "./hooks/useGameConnection.js";
import { useContentCatalog } from "./hooks/useContentCatalog.js";
import { useScenePreload } from "./hooks/useScenePreload.js";
import { useCombatPlayback } from "./hooks/useCombatPlayback.js";
import { useGameAudio } from "./hooks/useGameAudio.js";
import { useCountdown } from "./hooks/useCountdown.js";
import { useStageScale } from "./hooks/useStageScale.js";
import { CombatantFigure } from "./components/CombatantFigure.js";
import { CombatLog } from "./components/CombatLog.js";
import { PartyRoster } from "./components/PartyRoster.js";
import { EnemyHealth } from "./components/EnemyHealth.js";
import { RaidDoors } from "./components/RaidDoors.js";
import { StateBanner } from "./components/StateBanner.js";
import { RoleRoster, type RoleCount } from "./components/RoleRoster.js";
import { RoomReveal } from "./components/RoomReveal.js";
import { SimControls } from "./components/SimControls.js";
import { ROLES, type GearSlot, type Role } from "../../src/engine/types.js";
import type { Motion } from "../../src/character/layers.js";
import type { PartyMemberView } from "../../src/engine/state/gameEngine.js";
import { layoutLineup } from "./lineup.js";
import { usePlacements } from "./hooks/usePlacements.js";
import { backgroundUrl, foregroundUrl, spriteForGear } from "./sprites.js";
import { SIDE_WIDTH, STAGE_H, STAGE_W } from "./stage.js";
import { byFormation } from "./formation.js";
import { castIndexOf, encounterIdOf, enemySpriteFor } from "./enemyArt.js";
import { squadFor } from "../../src/engine/squad.js";
import type { ArenaProps, ArenaUnit } from "./arena3d/types.js";
import { text, format } from "../../src/text/index.js";

/** Sim controls are on by default and hidden with ?sim=0 on the OBS browser-source URL. */
const SIM_ENABLED = new URLSearchParams(window.location.search).get("sim") !== "0";

/**
 * How many of the party the 3D floor will stand.
 *
 * The flat rank caps itself by width (lineup.ts) and the floor has depth to
 * spend, so it holds more - but not everyone. Past about forty a side the
 * bodies stop being people and become a texture, and each one is a 512px
 * canvas composited and uploaded.
 */
const ARENA_PARTY_CAP = 40;

export interface AppProps {
  /**
   * Draws the fight, in place of the two flat ranks and the backdrop behind
   * them.
   *
   * Passed in by the entry point rather than imported here, and that is the
   * whole reason it is a prop: arena3d.html hands over a three.js scene, and
   * an import of it in this file would put the renderer in the flat overlay's
   * bundle too. Absent, the stage is exactly what it was.
   */
  Arena?: ComponentType<ArenaProps>;
}

export function App({ Arena }: AppProps = {}): JSX.Element {
  const { connected, snapshot, lastResult, updateSeq } = useGameConnection();

  // Sound cues, derived from snapshot transitions. Must run before the early
  // return below, or hook order changes when the connection drops.
  useGameAudio(snapshot);
  const catalog = useContentCatalog();
  // Warms every scene the moment the catalogue lands, so a run that opens and
  // starts inside a second does not draw its first combat frames on black.
  useScenePreload(catalog);
  const playback = useCombatPlayback(lastResult, updateSeq);
  const joinSecondsLeft = useCountdown(snapshot?.joinDeadline ?? null);
  const voteSecondsLeft = useCountdown(snapshot?.choiceDeadline ?? null);
  const stageScale = useStageScale();
  const { placements } = usePlacements();

  /**
   * Sprite ids per slot. Resolved here because picking the art needs the gear
   * catalogue and the body type — worn gear is cut to fit — and a figure
   * component should stay a renderer.
   */
  const layersFor = useMemo(() => {
    return (member: PartyMemberView): Partial<Record<GearSlot, string>> => {
      const out: Partial<Record<GearSlot, string>> = {};
      for (const [slot, equipped] of Object.entries(member.equipment)) {
        if (!equipped) continue;
        const sprite = spriteForGear(catalog.gearById.get(equipped.gearId), member.appearance.bodyType);
        if (sprite) out[slot as GearSlot] = sprite;
      }
      return out;
    };
  }, [catalog.gearById]);

  // The stage is a fixed 450x250 surface (stage.ts) centred in whatever it is
  // rendered into, scaled by a whole number. In OBS that scale is 1.
  // Sim controls render OUTSIDE the stage, below it. They are a testing
  // harness, not part of the overlay, and inside the stage they ate half the
  // 250px budget and squashed the fight down to unreadable — making the thing
  // being tested look worse than what actually ships.
  const frame = (children: JSX.Element, controls?: JSX.Element) => (
    <div className="stage-frame">
      {/*
        The scaler reserves the SCALED size in layout.

        A CSS transform scales what you see but not the box the page reserves,
        so the stage still occupied 450x250 in flow while rendering at twice
        that - and anything after it, the sim controls included, was laid out
        underneath the visible figures. The wrapper carries the real dimensions
        and the stage scales from its top-left corner inside it.
      */}
      <div
        className="stage-scaler"
        style={{ width: STAGE_W * stageScale, height: STAGE_H * stageScale }}
      >
        <div
          className="stage"
          style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${stageScale})` }}
        >
          {children}
        </div>
      </div>
      {controls}
    </div>
  );

  if (!connected || !snapshot) {
    return frame(<div className="connecting">{text.app.disconnected}</div>);
  }

  const { run, party, raid } = snapshot.engine;

  // During a replay the combatant list comes from the fight itself (it has
  // both sides and their opening HP); outside one it comes from the live
  // snapshot, so the join window shows people arriving in real time.
  const replaying = playback.isReplaying || playback.combatants.length > 0;
  const showFight = replaying && (snapshot.state === "combat" || snapshot.state === "results");

  const partyCards = showFight
    ? playback.combatants
        .filter((c) => c.side === "party")
        .map((c) => {
          const member = party.find((m) => m.id === c.id);
          return {
            id: c.id,
            name: c.name,
            role: c.role,
            level: c.level,
            maxHp: c.maxHp,
            hp: playback.hp[c.id] ?? c.maxHp,
            bodyType: c.appearance?.bodyType ?? "male",
            skinTone: c.appearance?.skinTone ?? "sand",
            layers: member ? layersFor(member) : {},
            hair: c.appearance?.hair ?? null,
          };
        })
    : party.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        level: m.level,
        maxHp: m.stats.hp,
        hp: m.stats.hp,
        bodyType: m.appearance.bodyType,
        skinTone: m.appearance.skinTone,
        layers: layersFor(m),
        hair: m.appearance.hair ?? null,
      }));

  /**
   * An enemy's appearance, with its gear resolved to sprite ids.
   *
   * Read off the UNIT now rather than off a shared archetype — a fight owns
   * its bodies, so the one that is drawn as a dressed person says so itself.
   */
  const enemyCharacterFor = (combatantId: string, index: number) => {
    const def = unitFor(combatantId, index)?.character;
    if (!def) return undefined;
    const layers: Partial<Record<GearSlot, string>> = {};
    for (const [slot, gearId] of Object.entries(def.equipment ?? {})) {
      const sprite = spriteForGear(catalog.gearById.get(gearId as string), def.bodyType);
      if (sprite) layers[slot as GearSlot] = sprite;
    }
    return { bodyType: def.bodyType, skinTone: def.skinTone, layers };
  };

  const enemyCards = showFight
    ? playback.combatants
        .filter((c) => c.side === "enemy")
        .map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind ?? "mob",
          maxHp: c.maxHp,
          hp: playback.hp[c.id] ?? c.maxHp,
        }))
    : // Outside a fight the bodies come from whatever is being LOOKED at: a
      // dungeon's roster during its join window, or the room a raid door has
      // just opened onto. Same shape, same rendering — the reveal shows the
      // fight's real occupants rather than an illustration of them.
      (raid?.revealed?.enemies ?? run?.enemies ?? []).map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        maxHp: e.maxHp,
        hp: e.maxHp,
      }));

  /**
   * A room is being shown. The doors stand down for it — they are the question
   * and this is the answer, and both at 450x250 is neither.
   */
  const revealed = snapshot.state === "reveal" ? (raid?.revealed ?? null) : null;

  // The doors own the stage during a choice, so the ranks stand down: showing
  // both at 450x250 leaves neither readable. A reveal is the opposite: the
  // ranks are the point, so the doors go instead.
  const choosing = (snapshot.state === "choosing" || snapshot.state === "reveal") && !revealed;
  /**
   * Framing drawn in front of the characters, only while gathering. Same
   * resolution rule as the background.
   */
  const foregroundId =
    enemyCards.map((c) => catalog.fightsById.get(encounterIdOf(c.id))?.foreground).find(Boolean) ?? null;

  const showArena = snapshot.state !== "idle" && !choosing;

  /** Names for the roster grid — every viewer in the party, not just the
      figures that fit on the stage. */
  const rosterEntries = partyCards.map((c) => ({
    id: c.id,
    name: c.name,
    hp: c.hp,
    maxHp: c.maxHp,
    downed: showFight ? (playback.downed[c.id] ?? false) : false,
  }));

  /**
   * What to say about the door that was just opened.
   *
   * Named for the beat rather than the door: an empty corridor and a boon are
   * both "nothing to fight", but only one of them is worth announcing.
   */
  const revealTextFor = (
    door: { kind?: string },
    current: typeof raid,
  ): string | null => {
    if (door.kind === "buff") {
      const latest = current?.buffs[current.buffs.length - 1];
      return latest ? latest.name : null;
    }
    if (door.kind === "clear") return text.raid.clear;
    return null;
  };

  /**
   * The scene this fight happens in.
   *
   * A run may name one; otherwise it comes from the enemies themselves. That
   * fallback is what lets a raid's door fights each be a different place —
   * the raid has no single location to speak for them.
   */
  const backgroundId =
    run?.background ??
    // A revealed room names its own scene, and it wins over anything derived
    // from the bodies in it — the room is the place, they are just standing in
    // it.
    revealed?.background ??
    enemyCards.map((c) => catalog.fightsById.get(encounterIdOf(c.id))?.background).find(Boolean) ??
    null;

  /**
   * Floats grouped by whose head they come off.
   *
   * Built once per render rather than filtered inside each figure: the list is
   * short but the figure list is not, and a filter per figure is O(figures x
   * floats) on every frame of a replay.
   */
  const floatsById = new Map<string, { id: number; text: string; kind: "damage" | "crit" | "heal" }[]>();
  for (const f of playback.floats) {
    const list = floatsById.get(f.combatantId);
    if (list) list.push(f);
    else floatsById.set(f.combatantId, [f]);
  }

  const enemyUnits = enemyCards.map((c) => ({
    id: c.id,
    hp: c.hp,
    maxHp: c.maxHp,
    downed: showFight ? (playback.downed[c.id] ?? false) : false,
  }));

  // Party size is uncapped by design, so both line-ups overlap their figures
  // and cap how many actually render — see lineup.ts. The roster standing
  // beside them takes width out of both, and the packing has to know: it is
  // computed in px against the column it is given.
  const showRoster = !revealed && rosterEntries.length > 0;
  const partyLayout = layoutLineup(partyCards.length, SIDE_WIDTH);
  const enemyLayout = layoutLineup(enemyCards.length, SIDE_WIDTH);

  /**
   * Where an enemy stands, when its encounter lays out a squad.
   *
   * Authored positions beat the automatic line-up: somebody placed these
   * against this background at this stage size, so the overlay's job is to put
   * them back rather than to re-pack them into a rank. Encounters with no
   * formation fall through to the line-up exactly as before.
   */
  const unitFor = (combatantId: string, index: number) => {
    const entry = catalog.fightsById.get(encounterIdOf(combatantId));
    if (!entry) return undefined;
    // The party's STRENGTH, which is what picked the squad. This passed the
    // headcount, which is `weak` for any party there will ever be - so a
    // level-4 fight of eight was drawn with the three sprites and three
    // positions of the level-1 layout, stacked. See StateSnapshot.partyStrength.
    const squad = squadFor(entry.fight, snapshot.engine.partyStrength);
    return squad[(castIndexOf(combatantId) ?? index) % Math.max(1, squad.length)];
  };
  const placed = enemyCards.length > 0 && Boolean(unitFor(enemyCards[0]!.id, 0));

  // Trim to what fits FIRST, then arrange by role. Doing it the other way
  // round would make the overflow cap drop whole roles off the end — a party
  // of 25 would render as fourteen healers and no tanks.
  const visibleParty = byFormation(partyCards.slice(0, partyLayout.visible));

  // Composition counts cover the WHOLE party, not just the figures that fit
  // on screen — "all the tanks are down" has to be true of the party, not of
  // the visible slice.
  const roleCounts = ROLES.reduce(
    (acc, role) => {
      const members = partyCards.filter((c) => c.role === role);
      acc[role] = {
        total: members.length,
        down: members.filter((c) => (showFight ? (playback.downed[c.id] ?? false) : false)).length,
      };
      return acc;
    },
    {} as Record<Role, RoleCount>,
  );

  /**
   * Everybody on the floor, for an arena that draws them itself.
   *
   * Built from the same cards the flat ranks are, so the two renderers cannot
   * disagree about who is in the fight, what they are wearing or who is down.
   * Empty when the flat arena would be hidden: the doors own the stage during
   * a choice, and a floor full of people behind them is neither.
   */
  const arenaUnits: ArenaUnit[] =
    Arena && showArena
      ? [
          ...partyCards.slice(0, ARENA_PARTY_CAP).map((c): ArenaUnit => {
            const downed = showFight ? (playback.downed[c.id] ?? false) : false;
            return {
              id: c.id,
              side: "party",
              role: c.role,
              character: { bodyType: c.bodyType, skinTone: c.skinTone, hair: c.hair, layers: c.layers },
              boss: false,
              downed,
              pose: showFight ? ((playback.poses[c.id] ?? "idle") as Motion) : "idle",
            };
          }),
          ...enemyCards.map((c, i): ArenaUnit => {
            const unit = unitFor(c.id, i);
            const character = enemyCharacterFor(c.id, i);
            return {
              id: c.id,
              side: "enemy",
              role: unit?.role,
              sprite: unit?.sprite,
              character: character ? { ...character, hair: null } : undefined,
              boss: c.kind === "boss",
              placed: unit ? { x: unit.x, y: unit.y, scale: unit.scale ?? 1 } : undefined,
              downed: showFight ? (playback.downed[c.id] ?? false) : false,
              pose: "idle",
            };
          }),
        ]
      : [];

  // The server flips to `results` the instant it resolves the fight, but the
  // overlay is still replaying it — showing the results banner then would
  // announce the winner before the audience has watched it happen. Hold the
  // combat banner until the replay reaches its own outcome event.
  const displayState =
    snapshot.state === "results" && playback.isReplaying && playback.outcome === null ? "combat" : snapshot.state;

  return frame(
    <>
      {/* The scene. Shown at full strength while the party gathers - that is
          the "here is where you are going" beat - and dimmed once the fight
          starts, so the characters read against it rather than competing with
          it. */}
      {Arena && snapshot.state !== "idle" && (
        <Arena
          units={arenaUnits}
          background={backgroundId}
          mood={snapshot.state === "gathering" || revealed ? "full" : "fight"}
          fighting={showFight}
          action={showFight ? playback.action : null}
          floats={showFight ? playback.floats : []}
          outcome={showFight ? playback.outcome : null}
          placements={placements}
          scale={stageScale}
        />
      )}
      {!Arena && backgroundId && snapshot.state !== "idle" && (
        <div
          className={`stage-backdrop ${snapshot.state === "gathering" || revealed ? "is-full" : ""}`}
          style={{ backgroundImage: `url(${backgroundUrl(backgroundId)})` }}
          aria-hidden="true"
        />
      )}

      {/* The party's names, in a band above the fight. */}
      {showRoster && <PartyRoster entries={rosterEntries} />}

      <StateBanner
        state={displayState}
        dungeonName={run?.name ?? null}
        partyCount={partyCards.length}
        enemyCount={enemyCards.length}
        lastOutcome={playback.outcome}
        joinSecondsLeft={joinSecondsLeft}
        encounterLevel={run?.encounterLevel ?? null}
        raidName={raid?.name ?? null}
        // While a room is open the headline IS the room. It used to fall
        // through to the raid's name for a fight door, so the one beat that
        // needed naming was the one beat that had no name on it.
        revealDetail={revealed ? revealed.name : lastResult?.door ? revealTextFor(lastResult.door, raid) : null}
      />

      {/* Action text at the very top, above the party's health.
          Gated on showFight so the previous fight's log does not hang around
          over the next run's join window. */}
      <CombatLog lines={showFight ? playback.logLines : []} />

      {/* The doors replace the arena while a choice is live - during a raid's
          choosing beat there is nothing to fight yet, and the decision is the
          thing to look at. Gated on `choosing`, which is already false once a
          room is being revealed: the doors and the arena share a grid cell, so
          leaving them up drew three doors straight over the room the party had
          just opened one of. */}
      {raid && choosing && (
        <RaidDoors
          round={raid.round}
          rounds={raid.rounds}
          doors={raid.doors}
          buffs={raid.buffs}
          bossPending={raid.bossPending}
          vote={snapshot.vote}
          secondsLeft={voteSecondsLeft}
        />
      )}

      {/* What the room holds, in the roster's row - the banner above has
          already named it and its occupants are standing below. */}
      {revealed && (
        <RoomReveal
          description={revealed.description}
          kind={revealed.kind}
          enemyCount={revealed.enemies.length}
          buff={revealed.buff}
          boss={revealed.boss}
        />
      )}

      {/* The 3D arena stands its own bodies, so the row holds only the role
          strip - and only while there is a join window for it to describe. */}
      {Arena && showArena && snapshot.state === "gathering" && (
        <div className="arena is-3d">
          <section className="side side-party">
            <RoleRoster counts={roleCounts} gathering />
          </section>
        </div>
      )}

      {!Arena && showArena && (
        <div className="arena">
          <section className="side side-party">
            {snapshot.state === "gathering" && (
              <RoleRoster counts={roleCounts} gathering />
            )}
            <div
              className={`lineup ${partyLayout.dense ? "is-dense" : ""}`}
              style={{
                ["--overlap" as string]: `-${partyLayout.overlap}px`,
                ["--bar-w" as string]: `${partyLayout.barWidth}px`,
                ["--name-w" as string]: `${partyLayout.nameWidth}px`,
              }}
            >
              {partyCards.length === 0 && <p className="side-empty">{text.dungeon.emptyParty}</p>}
              {visibleParty.map((c, i) => (
                <CombatantFigure
                  key={c.id}
                  id={c.id}
                  side="party"
                  name={c.name}
                  role={c.role}
                  level={c.level}
                  hp={c.hp}
                  maxHp={c.maxHp}
                  bodyType={c.bodyType}
                  skinTone={c.skinTone}
                  motion={showFight ? ((playback.poses[c.id] ?? "idle") as Motion) : "idle"}
                  pulse={showFight ? (playback.pulses[c.id] ?? null) : null}
                  floats={showFight ? floatsById.get(c.id) : undefined}
                  downed={showFight ? (playback.downed[c.id] ?? false) : false}
                  layers={c.layers}
                  hair={c.hair}
                  placements={placements}
                  dense={partyLayout.dense}
                  depth={i}
                />
              ))}
            </div>
          </section>

          <section className="side side-enemy">
            <div
              className={`lineup ${placed ? "is-placed" : ""} ${enemyLayout.dense && !placed ? "is-dense" : ""}`}
              style={{
                ["--overlap" as string]: `-${enemyLayout.overlap}px`,
                ["--bar-w" as string]: `${enemyLayout.barWidth}px`,
                ["--name-w" as string]: `${enemyLayout.nameWidth}px`,
              }}
            >
              {/* A placed squad renders in full - the person who laid it out
                  could see the stage while doing it, so the overflow cap that
                  protects an auto-packed rank would only throw away their
                  decisions. */}
              {(placed ? enemyCards : enemyCards.slice(0, enemyLayout.visible)).map((c, i) => {
                // A fight can mix a placed encounter with an unplaced one —
                // Tillage Hamlet fields farmhands and goodwives, and only one
                // of them may have a layout. Without a fallback the unplaced
                // ones all resolve to the same origin and stack into a single
                // smear, so they get spread along the back rank instead.
                const unit =
                  placed
                    ? (unitFor(c.id, i) ?? {
                        x: 0.12 + ((i * 0.19) % 0.8),
                        y: 0.55,
                        scale: 0.9,
                      })
                    : undefined;
                return (
                <div
                  key={c.id}
                  className={unit ? "placed-slot" : "contents"}
                  style={
                    unit
                      ? {
                          left: `${unit.x * 100}%`,
                          // Clamped to this figure's own height, its scale
                          // included — a slot is anchored by its FEET
                          // (translateY(-100%) about a bottom origin), so a
                          // unit authored standing back in the scene puts its
                          // head above the arena whenever the arena is shorter
                          // than the one it was laid out against, which it is
                          // the moment the roster appears. A cop at scale 1.1
                          // is 10% taller and overflowed by exactly that.
                          top: `max(${unit.y * 100}%, calc(var(${
                            c.kind === "boss" ? "--figure-h-boss" : "--figure-h"
                          }) * ${unit.scale ?? 1}))`,
                          transform: `translate(-50%, -100%) scale(${unit.scale ?? 1})`,
                          zIndex: Math.round(unit.y * 100),
                        }
                      : undefined
                  }
                >
                <CombatantFigure
                  key={c.id}
                  id={c.id}
                  side="enemy"
                  name={c.name}
                  hp={c.hp}
                  maxHp={c.maxHp}
                  pulse={showFight ? (playback.pulses[c.id] ?? null) : null}
                  floats={showFight ? floatsById.get(c.id) : undefined}
                  downed={showFight ? (playback.downed[c.id] ?? false) : false}
                  // Which face this copy wears. The id carries its number when
                  // the fight is running; before it starts, position on screen
                  // is the only ordering there is.
                  // The unit's own sprite. A fight lays out who stands where,
                  // so which face this copy wears is not a cast index into a
                  // shared list any more — it is simply that body's drawing.
                  enemySprite={unitFor(c.id, i)?.sprite}
                  enemyCharacter={enemyCharacterFor(c.id, i)}
                  placements={placements}
                  boss={c.kind === "boss"}
                  dense={enemyLayout.dense}
                  depth={enemyLayout.visible - i}
                />
                </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* Foreground framing, over the characters and only before the fight.
          Pointer-events off and aria-hidden: it is scenery, not content. */}
      {foregroundId && snapshot.state === "gathering" && (
        <div
          className="stage-foreground"
          style={{ backgroundImage: `url(${foregroundUrl(foregroundId)})` }}
          aria-hidden="true"
        />
      )}

      {/* The enemy's pooled health closes the stage, under the feet - the two
          sides' health now bracket the fight rather than stacking above it. */}
      {/* A raid has no dungeon, so the pooled bar takes the raid's name -
          without this it read as a nameless bar through the whole boss fight. */}
      {/* While a room is open the bar belongs to the ROOM - it is counting what
          is standing in that room, so naming the raid instead was naming the
          wrong place. */}
      {showArena && (
        <EnemyHealth units={enemyUnits} label={revealed?.name ?? run?.name ?? raid?.name ?? ""} />
      )}
    </>,
    SIM_ENABLED ? (
      <SimControls
        state={snapshot.state}
        partySize={party.length}
        dungeons={catalog.dungeons}
        raids={catalog.raids}
        choosing={choosing && !(raid?.bossPending ?? false)}
      />
    ) : undefined,
  );
}
