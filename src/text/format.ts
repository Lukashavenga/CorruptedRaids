/**
 * Tiny `{placeholder}` interpolator — deliberately not a full i18n library
 * (no plurals, no ICU message format). If the project ever needs more than
 * "swap {name} and {amount} into a string", reach for a real library then;
 * until this, one dependency-free function is enough and keeps the
 * "zero runtime dependencies" promise in the root README intact.
 */
export function format(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (!(key in vars)) return match; // leave unknown placeholders visible rather than silently dropping them
    return String(vars[key]);
  });
}
