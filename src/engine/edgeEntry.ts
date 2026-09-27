/**
 * Everything the loadout's Edge Function needs from the engine, in one export.
 *
 * A single entry point so the function can be bundled to one file. That is not
 * tidiness: the engine's sources import each other with `.js` specifiers (the
 * TypeScript ESM convention), and Deno resolves those literally — it would go
 * looking for `.js` files that only exist after a compile. Bundling side-steps
 * the whole question and makes the deployed function self-contained, which is
 * also what makes it start fast.
 */
export { GameEngine } from "./state/gameEngine.js";
export { ContentRegistry } from "./content/loader.js";
export type { GameCommand } from "./commands/types.js";
export { memberPower } from "./partyStrength.js";
export type { Character, Role } from "./types.js";

/*
 * The content validators, for the operator function.
 *
 * Content is edited from a hosted page now, so a malformed gear definition can
 * arrive over HTTP rather than being typed into a file by somebody who then
 * restarts the server and sees it fail. Validating at the WRITE means a bad
 * edit is refused while its author is still looking at it, instead of taking
 * the game down at the next boot with nobody around who remembers changing
 * anything.
 *
 * The same functions the disk loader uses - not a second set that agrees with
 * them today.
 */
export {
  validateGearDefinition,
  validateConsumableDefinition,
  validateShopStock,
  validateDungeonDefinition,
  validateRaidDefinition,
} from "./content/schemas.js";

/*
 * The difficulty simulator, for the operator function.
 *
 * DIFFICULTY IS MEASURED, NEVER DERIVED (AGENTS.md section 6) - the only way
 * to know how hard a fight is, is to resolve it a few dozen times and count.
 * That was the game server's job because the admin panel was local, and when
 * the panel moved to the open web the meter stayed pointed at a server that is
 * not there: /ratings 404d and /difficulty 405d, so the panel sat on
 * "measuring..." forever while blaming a missing admin key.
 *
 * So the simulator ships to the edge. It is the SAME code the server runs, not
 * an approximation that agrees with it today - a second opinion about
 * difficulty is the exact thing section 6 exists to forbid.
 *
 * Measured before it was moved: 37-120ms for one band of 60 samples, ~530ms
 * for all six. That fits an edge request with room to spare, which is why this
 * is a move rather than a rewrite into something cheaper.
 */
export { estimateDifficulty, referencePartyStrength } from "./difficulty.js";
export { expandFight, bandFor, BAND_SAMPLE_PARTY } from "./squad.js";
export { ratePoints } from "./partyStrength.js";
export { PARTY_BANDS } from "./types.js";
export type { FightDefinition, PartyBand } from "./types.js";
