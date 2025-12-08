// Text normalization for matching

// Remove emoji and special characters
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
const SPECIAL_CHARS_REGEX = /[^\p{L}\p{N}\s]/gu;

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(EMOJI_REGEX, " ")
    .replace(SPECIAL_CHARS_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Tokenize text into words
export function tokenize(text: string): string[] {
  return normalizeText(text).split(" ").filter(Boolean);
}

// Generate n-grams from text
export function generateNgrams(text: string, n: number = 3): Set<string> {
  const normalized = normalizeText(text);
  const ngrams = new Set<string>();

  if (normalized.length < n) {
    ngrams.add(normalized);
    return ngrams;
  }

  for (let i = 0; i <= normalized.length - n; i++) {
    ngrams.add(normalized.slice(i, i + n));
  }

  return ngrams;
}

// Generate word n-grams (shingles)
export function generateWordShingles(text: string, n: number = 2): Set<string> {
  const words = tokenize(text);
  const shingles = new Set<string>();

  if (words.length < n) {
    shingles.add(words.join(" "));
    return shingles;
  }

  for (let i = 0; i <= words.length - n; i++) {
    shingles.add(words.slice(i, i + n).join(" "));
  }

  return shingles;
}
