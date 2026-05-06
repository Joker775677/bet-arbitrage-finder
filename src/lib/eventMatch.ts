// Fuzzy matching of events across bookmakers.
// Bookmakers spell teams differently ("АБС" vs "АБС Натал", "Александр Мищенко" vs "Мищенко А",
// "Усам Нимес" vs "Ним"), so we cluster events by token overlap rather than exact key.

const STOP_TOKENS = new Set([
  "fc", "fk", "фк", "club", "клуб",
  "юнайтед", "united", "city", "сити", "town",
  "мол", "мол.", "молодежь", "молодёжь", "молодёж", "молодеж",
  "u15", "u16", "u17", "u18", "u19", "u20", "u21", "u23",
  "ii", "iii", "jr", "jr.", "junior", "юниоры", "юниор",
  "wom", "wom.", "women", "женщины", "ж", "ж.",
  "мужчины", "м", "м.",
  "и", "ii", "iv",
  "ва", "ив",
]);

const PUNCT_RE = /[().,/\\[\]:;'"`«»“”„‟‹›]/g;
const DASH_RE = /[—–\-]/g;

export function tokenize(name: string): string[] {
  if (!name) return [];
  const cleaned = name.toLowerCase().replace(PUNCT_RE, " ").replace(DASH_RE, " ");
  const out: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    const t = raw.trim();
    if (!t) continue;
    if (t.length < 3) continue;
    if (STOP_TOKENS.has(t)) continue;
    out.push(t);
  }
  return out;
}

// Two single tokens match if equal, one is a prefix of the other (>=3 chars),
// or they share a 4-char prefix (helps "нимес" vs "ним").
function tokensEqualish(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3) {
    if (a.startsWith(b) || b.startsWith(a)) return true;
  }
  if (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4)) return true;
  return false;
}

// Two team token-sets match if they share at least one equalish token.
export function teamMatch(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  for (const x of a) for (const y of b) {
    if (tokensEqualish(x, y)) return true;
  }
  return false;
}

// Pair matches in either orientation.
export function pairMatch(
  a1: string[], a2: string[],
  b1: string[], b2: string[],
): boolean {
  if (teamMatch(a1, b1) && teamMatch(a2, b2)) return true;
  if (teamMatch(a1, b2) && teamMatch(a2, b1)) return true;
  return false;
}
