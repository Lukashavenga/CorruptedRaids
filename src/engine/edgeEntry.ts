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
