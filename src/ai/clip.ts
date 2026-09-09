/**
 * Length limits protect the layout, but cutting on the character makes the
 * model look broken ("GPU-інстанси £20", "При рі"). Cut back to a word or
 * sentence boundary and mark the cut instead.
 */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence >= max * 0.6) return head.slice(0, sentence + 1);
  const word = head.lastIndexOf(" ");
  return (word >= max * 0.6 ? head.slice(0, word) : head).trimEnd() + "…";
}
