/**
 * Human-readable rejection reason texts for forward analysis
 */

import type { FoundPostAnalysis, AnalysisResult } from "../types.ts";

/**
 * Format rejection reason for display to user
 */
export function formatRejectionReason(post: FoundPostAnalysis): string {
  switch (post.result) {
    case "rejected_negative":
      return `Содержит исключающее слово "${post.rejection_keyword}"`;

    case "rejected_ngram": {
      const score = Math.round((post.ngram_score ?? 0) * 100);
      return `Текст далёк от запроса (сходство ${score}%)`;
    }

    case "rejected_semantic": {
      const sem = Math.round((post.semantic_score ?? 0) * 100);
      if (post.rejection_keyword) {
        return `Заблокировано семантическим фильтром: "${post.rejection_keyword}"`;
      }
      return `Семантика не совпала (${sem}%)`;
    }

    case "rejected_llm": {
      if (post.llm_reasoning) {
        // Truncate long reasoning
        const reason = post.llm_reasoning.length > 200
          ? post.llm_reasoning.slice(0, 200) + "..."
          : post.llm_reasoning;
        return `ИИ отклонил: ${reason}`;
      }
      const conf = post.llm_confidence
        ? ` (уверенность ${Math.round(post.llm_confidence * 100)}%)`
        : "";
      return `ИИ не подтвердил соответствие${conf}`;
    }

    case "matched":
      return "Сообщение соответствует критериям";

    default:
      return "Причина не определена";
  }
}

/**
 * Get short status text for analysis result
 */
export function getStatusText(result: AnalysisResult): string {
  switch (result) {
    case "matched":
      return "Совпадение";
    case "rejected_negative":
      return "Исключено";
    case "rejected_ngram":
      return "Не совпало";
    case "rejected_semantic":
      return "Семантика";
    case "rejected_llm":
      return "ИИ отклонил";
    default:
      return "Неизвестно";
  }
}

/**
 * Format unix timestamp as human-readable date
 */
export function formatDate(timestamp: number | null): string {
  if (!timestamp) return "неизвестно";

  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    // Today - show time
    return `сегодня в ${date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  } else if (diffDays === 1) {
    return "вчера";
  } else if (diffDays < 7) {
    return `${diffDays} дней назад`;
  } else {
    return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  }
}

/**
 * Format detailed analysis info for advanced users
 */
export function formatDetailedAnalysis(post: FoundPostAnalysis): string {
  const lines: string[] = [];

  if (post.ngram_score !== null) {
    lines.push(`N-gram: ${Math.round(post.ngram_score * 100)}%`);
  }

  if (post.semantic_score !== null) {
    lines.push(`Семантика: ${Math.round(post.semantic_score * 100)}%`);
  }

  if (post.llm_confidence !== null) {
    lines.push(`LLM: ${Math.round(post.llm_confidence * 100)}%`);
  }

  if (lines.length === 0) {
    return "";
  }

  return `Скоры: ${lines.join(" | ")}`;
}
