import plural from "plural-ru";

/**
 * Russian pluralization helpers using plural-ru
 * Usage: messages(5) => "5 сообщений"
 */

export const messages = (n: number) =>
  plural(n, "%d сообщение", "%d сообщения", "%d сообщений");

export const groups = (n: number) =>
  plural(n, "%d группа", "%d группы", "%d групп");

export const items = (n: number) =>
  plural(n, "%d товар", "%d товара", "%d товаров");

// Generic function for custom word forms
export const pluralize = plural;
