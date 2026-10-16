/** Joins class names, skipping falsy ones. Small enough not to need a dependency. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
