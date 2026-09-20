/**
 * How an encounter's art is chosen.
 *
 * There used to be a third way — `visual`, a cell index into a shared sprite
 * sheet — left over from the goblin placeholder set. No encounter has used it
 * since the hand-drawn sheets landed, and the sheet itself is gone, so the
 * indirection went with it. What remains is the cast: complete figures, picked
 * per copy.
 */

/**
 * The encounter an enemy combatant belongs to.
 *
 * Enemy ids are "<encounterId>#<n>", so the name is the part before the hash.
 */
export function encounterIdOf(combatantId: string): string {
  return combatantId.split("#")[0] ?? combatantId;
}

/**
 * Which member of an encounter's cast this combatant is, or null.
 *
 * Enemy combatants are numbered per encounter — "bailiff#1", "bailiff#2" — so
 * the number in the id is already the answer, and no extra state has to be
 * threaded from the engine to the renderer to say who is who. Returns null for
 * an id without one (the pre-fight roster builds its list differently), letting
 * the caller fall back to position on screen.
 */
export function castIndexOf(combatantId: string): number | null {
  const n = Number(combatantId.split("#")[1]);
  return Number.isInteger(n) && n >= 1 ? n - 1 : null;
}

/**
 * The sprite one copy of an encounter should draw.
 *
 * Cycles the cast so a mob of eight built from three drawings still reads as a
 * crowd rather than as one person duplicated. Falls back to the single
 * `enemySprite` when no cast is set.
 */
export function enemySpriteFor(
  def: { enemySprite?: string; enemySprites?: string[] } | undefined,
  index: number,
): string | undefined {
  if (!def) return undefined;
  const cast = def.enemySprites?.length ? def.enemySprites : undefined;
  if (!cast) return def.enemySprite;
  return cast[index % cast.length] ?? def.enemySprite;
}
