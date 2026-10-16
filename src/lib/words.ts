/**
 * Words as grounding compares them: lower case, letters and digits of any script, one
 * space between words. Shared by every check that asks whether something was said.
 */
export function normaliseWords(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Whether a phrase appears in any of the texts as whole words ("Sam", never "Samir"). */
export function saidIn(phrase: string, texts: ReadonlyArray<string>): boolean {
  const needle = normaliseWords(phrase);
  return (
    needle.length > 0 && texts.some((text) => ` ${normaliseWords(text)} `.includes(` ${needle} `))
  );
}
