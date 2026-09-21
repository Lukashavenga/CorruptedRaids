import { SPRITE_INDEX } from "../admin/spriteIndex.js";

/**
 * Hair, as a STYLE and a COLOUR, for the picker only.
 *
 * The art ships as forty finished drawings named `s04-brown`, and
 * CharacterAppearance keeps exactly that one id — see the note on `hair` in
 * src/engine/types.ts for why the model does not split it. This module is the
 * UI's view of the same thing, and nothing more: it takes those ids apart so
 * ten styles can be offered beside four colours, and puts them back together
 * before anything is saved.
 *
 * A grid of forty is the thing being replaced. Forty cells is not ten styles
 * offered four times, it is forty items to scan where the player is choosing
 * along two axes at once, and every style appears four times to no purpose.
 *
 * DERIVED FROM THE FILES, NOT DECLARED. The styles and colours below come out
 * of SPRITE_INDEX, so a hairstyle added to art/sprites/hair shows up here
 * without anyone remembering to list it, and one removed stops being offered
 * rather than rendering a broken image.
 */

export interface HairParts {
  /** e.g. "s04" */
  style: string;
  /** e.g. "brown" */
  colour: string;
}

/** Splits `s04-brown` into its two halves. Null for an id that is not shaped that way. */
export function parseHair(id: string | null | undefined): HairParts | null {
  if (!id) return null;
  const at = id.indexOf("-");
  if (at <= 0 || at === id.length - 1) return null;
  return { style: id.slice(0, at), colour: id.slice(at + 1) };
}

/** Puts them back: `s04` + `brown` becomes `s04-brown`. */
export function hairId(style: string, colour: string): string {
  return `${style}-${colour}`;
}

const ALL: string[] = SPRITE_INDEX.hair ?? [];

/** Every style, in file order, deduplicated. */
export const HAIR_STYLES: string[] = [...new Set(ALL.map((id) => parseHair(id)?.style).filter(Boolean) as string[])];

/** Every colour, in file order, deduplicated. */
export const HAIR_COLOURS: string[] = [...new Set(ALL.map((id) => parseHair(id)?.colour).filter(Boolean) as string[])];

/**
 * Swatch colours, SAMPLED FROM THE ART rather than picked by eye.
 *
 * Each is the most common colour among the brightest third of that variant's
 * opaque pixels, across several styles. The brightest third specifically: the
 * single most common colour overall is a shadow tone, and a swatch painted
 * with a shadow makes blonde look like dark leather.
 *
 * A colour with no entry falls back to a mid grey, so a new hair colour added
 * to the art is offered immediately and merely looks unlabelled until someone
 * samples it.
 */
const SWATCH: Record<string, string> = {
  blonde: "#c68956",
  brown: "#51251b",
  red: "#af2723",
  violet: "#512347",
};

export function hairSwatch(colour: string): string {
  return SWATCH[colour] ?? "#6b6b6b";
}

/** "blonde" -> "Blonde". The ids are already the words. */
export function hairColourName(colour: string): string {
  return colour.charAt(0).toUpperCase() + colour.slice(1);
}

/**
 * The colour to show a style in, and the style to show a colour in.
 *
 * Both grids have to draw SOMETHING, and drawing every style in a fixed colour
 * would make the colour picker look like it does nothing. So the style grid
 * renders in whatever colour is currently chosen, which means picking a colour
 * repaints all ten styles at once and the connection is immediate.
 *
 * Falls back to the first available when the current choice is bald or
 * unrecognised, so the grid is never empty.
 */
export function styleInColour(style: string, colour: string | null): string {
  const use = colour && HAIR_COLOURS.includes(colour) ? colour : (HAIR_COLOURS[0] ?? "brown");
  return hairId(style, use);
}
