import type { BotContext } from "./context";

// Guard: user is in advanced mode
export function isAdvancedMode({ context }: { context: BotContext }): boolean {
  return context.userMode === "advanced";
}

// Guard: user has available groups for selection
export function hasAvailableGroups({ context }: { context: BotContext }): boolean {
  return context.availableGroups.length > 0;
}

// Guard: all rating examples have been rated
export function allExamplesRated({ context }: { context: BotContext }): boolean {
  if (!context.ratingExamples) return true;
  return context.ratingExamples.currentIndex >= context.ratingExamples.messages.length;
}

// Guard: all clarification questions answered
export function allQuestionsAnswered({ context }: { context: BotContext }): boolean {
  if (!context.clarification) return true;
  return context.clarification.currentIndex >= context.clarification.questions.length;
}

// Guard: pending group needs invite link (private group not yet joined)
export function needsInviteLink({ context }: { context: BotContext }): boolean {
  return context.currentPendingGroup?.needsInviteLink ?? false;
}

// Guard: has pending subscription data
export function hasPendingSub({ context }: { context: BotContext }): boolean {
  return context.pendingSub !== null;
}

// Guard: has positive keywords to remove
export function hasPositiveKeywords({ context }: { context: BotContext }): boolean {
  return (context.pendingSub?.positiveKeywords.length ?? 0) > 0;
}

// Guard: has negative keywords to remove
export function hasNegativeKeywords({ context }: { context: BotContext }): boolean {
  return (context.pendingSub?.negativeKeywords.length ?? 0) > 0;
}

// Guard: AI edit has proposed changes
export function hasProposedAiEdit({ context }: { context: BotContext }): boolean {
  return context.pendingAiEdit?.proposed !== undefined;
}

// Guard: AI correction has proposed changes
export function hasProposedAiCorrection({ context }: { context: BotContext }): boolean {
  return context.pendingAiCorrection?.proposed !== undefined;
}

// Guard: has selected groups
export function hasSelectedGroups({ context }: { context: BotContext }): boolean {
  return context.selectedGroups.length > 0;
}
