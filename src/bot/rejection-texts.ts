/**
 * Human-readable rejection reason texts for forward analysis
 */

import type { FoundPostAnalysis, AnalysisResult } from "../types.ts";
import { getTranslator, getTranslatorForLocale, getUserLocale } from "../i18n/index.ts";

/**
 * Format rejection reason for display to user
 */
export function formatRejectionReason(post: FoundPostAnalysis, userId?: number): string {
  const tr = userId ? getTranslator(userId) : getTranslatorForLocale("ru");

  switch (post.result) {
    case "rejected_negative":
      return tr("reject_negative_kw", { keyword: post.rejection_keyword || "" });

    case "rejected_ngram": {
      const score = Math.round((post.ngram_score ?? 0) * 100);
      return tr("reject_ngram", { score });
    }

    case "rejected_semantic": {
      const sem = Math.round((post.semantic_score ?? 0) * 100);
      if (post.rejection_keyword) {
        return tr("reject_semantic_kw", { keyword: post.rejection_keyword });
      }
      return tr("reject_semantic", { score: sem });
    }

    case "rejected_llm": {
      if (post.llm_reasoning) {
        // Truncate long reasoning
        const reason = post.llm_reasoning.length > 200
          ? post.llm_reasoning.slice(0, 200) + "..."
          : post.llm_reasoning;
        return tr("reject_llm_reason", { reason });
      }
      if (post.llm_confidence) {
        const score = Math.round(post.llm_confidence * 100);
        return tr("reject_llm_confidence", { score });
      }
      return tr("reject_llm");
    }

    case "matched":
      return tr("reject_matched");

    default:
      return tr("reject_unknown");
  }
}

/**
 * Get short status text for analysis result
 */
export function getStatusText(result: AnalysisResult, userId?: number): string {
  const tr = userId ? getTranslator(userId) : getTranslatorForLocale("ru");

  switch (result) {
    case "matched":
      return tr("status_matched");
    case "rejected_negative":
      return tr("status_excluded");
    case "rejected_ngram":
      return tr("status_ngram");
    case "rejected_semantic":
      return tr("status_semantic");
    case "rejected_llm":
      return tr("status_llm");
    default:
      return tr("status_unknown");
  }
}

/**
 * Format unix timestamp as human-readable date
 */
export function formatDate(timestamp: number | null, userId?: number): string {
  const tr = userId ? getTranslator(userId) : getTranslatorForLocale("ru");
  const locale = userId ? getUserLocale(userId) : "ru";

  if (!timestamp) return tr("date_unknown");

  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    // Today - show time
    const localeCode = locale === "rs" ? "sr" : locale;
    const time = date.toLocaleTimeString(localeCode, { hour: "2-digit", minute: "2-digit" });
    return tr("date_today", { time });
  } else if (diffDays === 1) {
    return tr("date_yesterday");
  } else if (diffDays < 7) {
    return tr("date_days_ago", { days: diffDays });
  } else {
    const localeCode = locale === "rs" ? "sr" : locale;
    return date.toLocaleDateString(localeCode, { day: "numeric", month: "short" });
  }
}

/**
 * Format detailed analysis info for advanced users
 */
export function formatDetailedAnalysis(post: FoundPostAnalysis, userId?: number): string {
  const tr = userId ? getTranslator(userId) : getTranslatorForLocale("ru");
  const lines: string[] = [];

  if (post.ngram_score !== null) {
    lines.push(`N-gram: ${Math.round(post.ngram_score * 100)}%`);
  }

  if (post.semantic_score !== null) {
    lines.push(tr("analysis_semantic", { score: Math.round(post.semantic_score * 100) }));
  }

  if (post.llm_confidence !== null) {
    lines.push(`LLM: ${Math.round(post.llm_confidence * 100)}%`);
  }

  if (lines.length === 0) {
    return "";
  }

  return tr("analysis_scores", { scores: lines.join(" | ") });
}
