import { en } from "./en.js";

/**
 * The active language's string tree. Deliberately exported as a plain
 * object (`text.combatLog.attack`), not a stringly-typed `t("combatLog.
 * attack")` lookup — direct property access keeps every call site type-
 * checked and renameable by the compiler. Swapping languages means
 * swapping this one export, not changing any call site.
 */
export const text = en;

export { format } from "./format.js";
export type { TextTree } from "./en.js";
