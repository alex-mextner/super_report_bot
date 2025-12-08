import { describe, test, expect } from "bun:test";
import { normalizeText, tokenize, generateNgrams, generateWordShingles } from "./normalize.ts";

describe("normalizeText", () => {
  test("converts to lowercase", () => {
    expect(normalizeText("HELLO WORLD")).toBe("hello world");
    expect(normalizeText("iPhone 15 Pro MAX")).toBe("iphone 15 pro max");
  });

  test("removes emojis", () => {
    expect(normalizeText("hello 😀 world 🎉")).toBe("hello world");
    expect(normalizeText("🔥🔥🔥 hot deal")).toBe("hot deal");
    expect(normalizeText("iPhone 📱 продажа")).toBe("iphone продажа");
  });

  test("removes special characters", () => {
    expect(normalizeText("hello, world!")).toBe("hello world");
    expect(normalizeText("price: $100")).toBe("price 100");
    expect(normalizeText("email@test.com")).toBe("email test com");
    expect(normalizeText("foo-bar_baz")).toBe("foo bar baz");
  });

  test("collapses multiple spaces", () => {
    expect(normalizeText("hello    world")).toBe("hello world");
    expect(normalizeText("  leading and trailing  ")).toBe("leading and trailing");
  });

  test("handles mixed content", () => {
    expect(normalizeText("Продаю iPhone 15 Pro 🔥 за 80000₽!")).toBe(
      "продаю iphone 15 pro за 80000"
    );
  });

  test("preserves cyrillic characters", () => {
    expect(normalizeText("Привет МИР")).toBe("привет мир");
    expect(normalizeText("Москва")).toBe("москва");
  });

  test("handles empty input", () => {
    expect(normalizeText("")).toBe("");
    expect(normalizeText("   ")).toBe("");
  });

  test("handles unicode letters from different languages", () => {
    expect(normalizeText("日本語テスト")).toBe("日本語テスト");
    expect(normalizeText("Ελληνικά")).toBe("ελληνικά");
  });
});

describe("tokenize", () => {
  test("splits into words", () => {
    expect(tokenize("hello world")).toEqual(["hello", "world"]);
    expect(tokenize("one two three")).toEqual(["one", "two", "three"]);
  });

  test("normalizes before tokenizing", () => {
    expect(tokenize("HELLO World!")).toEqual(["hello", "world"]);
    expect(tokenize("iPhone 15 Pro")).toEqual(["iphone", "15", "pro"]);
  });

  test("filters empty tokens", () => {
    expect(tokenize("hello  world")).toEqual(["hello", "world"]);
    expect(tokenize("  hello  ")).toEqual(["hello"]);
  });

  test("handles empty input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });

  test("handles special characters only", () => {
    expect(tokenize("!@#$%")).toEqual([]);
    expect(tokenize("😀😀😀")).toEqual([]);
  });

  test("handles cyrillic text", () => {
    expect(tokenize("Продаю машину")).toEqual(["продаю", "машину"]);
  });
});

describe("generateNgrams", () => {
  test("generates character trigrams by default", () => {
    const ngrams = generateNgrams("hello");
    expect(ngrams).toEqual(new Set(["hel", "ell", "llo"]));
  });

  test("generates custom n-grams", () => {
    const bigrams = generateNgrams("hello", 2);
    expect(bigrams).toEqual(new Set(["he", "el", "ll", "lo"]));

    const quadgrams = generateNgrams("hello", 4);
    expect(quadgrams).toEqual(new Set(["hell", "ello"]));
  });

  test("handles text shorter than n", () => {
    const ngrams = generateNgrams("hi", 3);
    expect(ngrams).toEqual(new Set(["hi"]));
  });

  test("handles text equal to n", () => {
    const ngrams = generateNgrams("abc", 3);
    expect(ngrams).toEqual(new Set(["abc"]));
  });

  test("normalizes input", () => {
    const ngrams = generateNgrams("HELLO");
    expect(ngrams.has("hel")).toBe(true);
    expect(ngrams.has("HEL")).toBe(false);
  });

  test("handles multi-word text", () => {
    const ngrams = generateNgrams("hi there");
    // Normalized: "hi there" -> includes space in ngrams
    expect(ngrams.has("hi ")).toBe(true);
    expect(ngrams.has("i t")).toBe(true);
    expect(ngrams.has("the")).toBe(true);
  });

  test("handles empty input", () => {
    const ngrams = generateNgrams("");
    expect(ngrams).toEqual(new Set([""]));
  });

  test("handles cyrillic", () => {
    const ngrams = generateNgrams("привет");
    expect(ngrams.has("при")).toBe(true);
    expect(ngrams.has("рив")).toBe(true);
  });
});

describe("generateWordShingles", () => {
  test("generates word bigrams by default", () => {
    const shingles = generateWordShingles("one two three");
    expect(shingles).toEqual(new Set(["one two", "two three"]));
  });

  test("generates custom word n-grams", () => {
    const trigrams = generateWordShingles("a b c d", 3);
    expect(trigrams).toEqual(new Set(["a b c", "b c d"]));
  });

  test("handles fewer words than n", () => {
    const shingles = generateWordShingles("hello", 2);
    expect(shingles).toEqual(new Set(["hello"]));
  });

  test("handles words equal to n", () => {
    const shingles = generateWordShingles("hello world", 2);
    expect(shingles).toEqual(new Set(["hello world"]));
  });

  test("normalizes input", () => {
    const shingles = generateWordShingles("HELLO WORLD");
    expect(shingles.has("hello world")).toBe(true);
    expect(shingles.has("HELLO WORLD")).toBe(false);
  });

  test("handles empty input", () => {
    const shingles = generateWordShingles("");
    expect(shingles).toEqual(new Set([""]));
  });

  test("handles single word", () => {
    const shingles = generateWordShingles("hello", 2);
    expect(shingles).toEqual(new Set(["hello"]));
  });

  test("handles cyrillic text", () => {
    const shingles = generateWordShingles("продаю iphone новый");
    expect(shingles.has("продаю iphone")).toBe(true);
    expect(shingles.has("iphone новый")).toBe(true);
  });
});
