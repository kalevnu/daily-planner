// Normalises Markdown produced by the note editor so stored notes stay easy
// to read: no blank lines between list items and plain newlines instead of
// "\" hard breaks (the editor parses newlines as line breaks).
const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s/;

export function tidyMarkdown(md: string): string {
  const lines = md.replace(/\\\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const blankBetweenItems = lines[i] === "" && LIST_ITEM.test(out[out.length - 1] ?? "") && LIST_ITEM.test(lines[i + 1] ?? "");
    if (!blankBetweenItems) out.push(lines[i]);
  }
  return out.join("\n").replace(/\n+$/, "");
}
