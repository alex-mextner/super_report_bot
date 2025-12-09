/**
 * EXAMPLES — генерация примеров сообщений для подписки
 *
 * Показываем пользователю примеры при просмотре/создании подписки.
 *
 * Стратегия (в порядке приоритета):
 * 1. Ищем релевантные сообщения в кэше групп подписки (isFromCache: true)
 * 2. Если не нашли — генерируем fallback из keywords (isFromCache: false)
 *
 * Fallback не использует AI, просто комбинирует keywords в шаблоны:
 *   "Продам {keyword1}. {keyword2}, {keyword3}"
 *
 * Длинные сообщения обрезаются до 200 символов.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { CachedMessage } from "../cache/messages.ts";

// Mock data
const mockMessages: CachedMessage[] = [];
const mockGroups: Array<{ group_id: number; group_title: string }> = [];

// Mock cache module
mock.module("../cache/messages.ts", () => ({
  getMessages: (groupId: number) => mockMessages.filter((m) => m.groupId === groupId),
}));

// Mock db queries
mock.module("../db/index.ts", () => ({
  queries: {
    getSubscriptionGroups: (_subscriptionId: number) => mockGroups,
  },
}));

import { getExamplesForSubscription, type ExampleMessage } from "./examples.ts";

describe("getExamplesForSubscription", () => {
  beforeEach(() => {
    mockMessages.length = 0;
    mockGroups.length = 0;
  });

  test("returns fallback examples when no messages in cache", () => {
    mockGroups.push({ group_id: -100123, group_title: "Test Group" });

    const examples = getExamplesForSubscription(
      1,
      ["iphone", "продаю"],
      [],
      2
    );

    expect(examples).toHaveLength(2);
    // All should be fallbacks (from cache = false)
    expect(examples.every((e) => e.isFromCache === false)).toBe(true);
  });

  test("returns cached messages when available and relevant", () => {
    mockGroups.push({ group_id: -100123, group_title: "Sales" });
    mockMessages.push({
      id: 1,
      text: "Продаю iPhone 15 Pro Max в отличном состоянии недорого",
      groupId: -100123,
      groupTitle: "Sales",
      date: Date.now(),
    });

    const examples = getExamplesForSubscription(
      1,
      ["iphone", "продаю"],
      [],
      2
    );

    expect(examples.length).toBeGreaterThanOrEqual(1);
    // At least one should be from cache
    const cachedExamples = examples.filter((e) => e.isFromCache);
    expect(cachedExamples.length).toBeGreaterThanOrEqual(1);
    expect(cachedExamples[0]!.text).toContain("iPhone");
  });

  test("filters out messages with negative keywords", () => {
    mockGroups.push({ group_id: -100123, group_title: "Sales" });
    mockMessages.push(
      {
        id: 1,
        text: "iPhone 15 на запчасти, разбитый экран продаю",
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      },
      {
        id: 2,
        text: "Продаю iPhone 15 Pro Max идеальное состояние",
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      }
    );

    const examples = getExamplesForSubscription(
      1,
      ["iphone", "продаю"],
      ["запчасти", "разбит"],
      2
    );

    // Should not include message with negative keywords
    const cached = examples.filter((e) => e.isFromCache);
    expect(cached.every((e) => !e.text.includes("запчасти"))).toBe(true);
  });

  test("skips very short messages", () => {
    mockGroups.push({ group_id: -100123, group_title: "Sales" });
    mockMessages.push(
      {
        id: 1,
        text: "iPhone", // Too short (< 20 chars)
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      },
      {
        id: 2,
        text: "Продаю iPhone 15 Pro Max в отличном состоянии",
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      }
    );

    const examples = getExamplesForSubscription(
      1,
      ["iphone"],
      [],
      2
    );

    // Only long message should be from cache
    const cached = examples.filter((e) => e.isFromCache);
    expect(cached.every((e) => e.text.length >= 20)).toBe(true);
  });

  test("truncates long messages to 200 chars", () => {
    mockGroups.push({ group_id: -100123, group_title: "Sales" });
    const longText = "Продаю iPhone 15 Pro Max " + "x".repeat(250);
    mockMessages.push({
      id: 1,
      text: longText,
      groupId: -100123,
      groupTitle: "Sales",
      date: Date.now(),
    });

    const examples = getExamplesForSubscription(
      1,
      ["iphone", "продаю"],
      [],
      1
    );

    const cached = examples.filter((e) => e.isFromCache);
    if (cached.length > 0) {
      expect(cached[0]!.text.length).toBeLessThanOrEqual(203); // 200 + "..."
      expect(cached[0]!.text).toContain("...");
    }
  });

  test("returns maxExamples number of results", () => {
    mockGroups.push({ group_id: -100123, group_title: "Sales" });
    // Add more messages than needed
    for (let i = 0; i < 10; i++) {
      mockMessages.push({
        id: i,
        text: `iPhone ${i} продаю в хорошем состоянии цена хорошая`,
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      });
    }

    const examples3 = getExamplesForSubscription(1, ["iphone"], [], 3);
    const examples5 = getExamplesForSubscription(1, ["iphone"], [], 5);

    expect(examples3).toHaveLength(3);
    expect(examples5).toHaveLength(5);
  });

  test("fallback example contains keywords", () => {
    // No groups, no cache — pure fallback
    const examples = getExamplesForSubscription(
      1,
      ["iphone", "продаю", "новый"],
      [],
      1
    );

    expect(examples).toHaveLength(1);
    expect(examples[0]!.isFromCache).toBe(false);
    // Fallback should contain at least one keyword
    const text = examples[0]!.text.toLowerCase();
    const hasKeyword = ["iphone", "продаю", "новый"].some((kw) =>
      text.includes(kw.toLowerCase())
    );
    expect(hasKeyword).toBe(true);
  });

  test("fallback with no keywords returns placeholder", () => {
    const examples = getExamplesForSubscription(1, [], [], 1);

    expect(examples).toHaveLength(1);
    expect(examples[0]!.isFromCache).toBe(false);
    expect(examples[0]!.text).toBe("(нет ключевых слов)");
  });
});
