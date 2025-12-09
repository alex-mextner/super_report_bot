import type { BotContext } from "./context";
import type { BotEvent } from "./events";

// Action object definitions for XState assign()
// These are passed to assign() in machine.ts

// Clear all pending data and return to idle
export const clearContext = {
  pendingSub: () => null as BotContext["pendingSub"],
  clarification: () => null as BotContext["clarification"],
  ratingExamples: () => null as BotContext["ratingExamples"],
  draftKeywords: () => null as BotContext["draftKeywords"],
  selectedGroups: () => [] as BotContext["selectedGroups"],
  pendingGroups: () => [] as BotContext["pendingGroups"],
  currentPendingGroup: () => null as BotContext["currentPendingGroup"],
  editingSubscriptionId: () => null as BotContext["editingSubscriptionId"],
  pendingAiEdit: () => null as BotContext["pendingAiEdit"],
  pendingAiCorrection: () => null as BotContext["pendingAiCorrection"],
};

// === Clarification ===

export const startClarification = {
  clarification: ({ event }: { event: BotEvent }) => {
    if (event.type === "START_CLARIFICATION") return event.data;
    return null;
  },
};

export const assignAnswer = {
  clarification: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.clarification || event.type !== "ANSWER") return context.clarification;
    return {
      ...context.clarification,
      answers: [...context.clarification.answers, event.text],
      currentIndex: context.clarification.currentIndex + 1,
    };
  },
};

export const skipQuestion = {
  clarification: ({ context }: { context: BotContext }) => {
    if (!context.clarification) return context.clarification;
    return {
      ...context.clarification,
      answers: [...context.clarification.answers, ""],
      currentIndex: context.clarification.currentIndex + 1,
    };
  },
};

// === Rating examples ===

export const startRating = {
  ratingExamples: ({ event }: { event: BotEvent }) => {
    if (event.type === "START_RATING") return event.examples;
    return null;
  },
};

export const assignRating = {
  ratingExamples: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.ratingExamples || event.type !== "RATE") return context.ratingExamples;
    const example = context.ratingExamples.messages[context.ratingExamples.currentIndex];
    return {
      ...context.ratingExamples,
      ratings: [
        ...context.ratingExamples.ratings,
        { messageId: event.messageId, text: example?.text ?? "", rating: event.rating },
      ],
      currentIndex: context.ratingExamples.currentIndex + 1,
    };
  },
};

// === Pending subscription ===

export const setKeywordsGenerated = {
  pendingSub: ({ event }: { event: BotEvent }) => {
    if (event.type === "KEYWORDS_GENERATED") return event.pendingSub;
    return null;
  },
  ratingExamples: () => null as BotContext["ratingExamples"],
  clarification: () => null as BotContext["clarification"],
};

export const setPendingSub = {
  pendingSub: ({ event }: { event: BotEvent }) => {
    if (event.type === "SET_PENDING_SUB") return event.pendingSub;
    return null;
  },
};

export const updateDraftKeywords = {
  draftKeywords: ({ event }: { event: BotEvent }) => {
    if (event.type === "UPDATE_DRAFT_KEYWORDS") return event.keywords;
    return null;
  },
};

// === Keyword editing ===

export const addPositiveKeywords = {
  pendingSub: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingSub || event.type !== "TEXT_KEYWORDS") return context.pendingSub;
    return {
      ...context.pendingSub,
      positiveKeywords: [...context.pendingSub.positiveKeywords, ...event.keywords],
    };
  },
};

export const addNegativeKeywords = {
  pendingSub: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingSub || event.type !== "TEXT_KEYWORDS") return context.pendingSub;
    return {
      ...context.pendingSub,
      negativeKeywords: [...context.pendingSub.negativeKeywords, ...event.keywords],
    };
  },
};

export const removePositiveKeyword = {
  pendingSub: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingSub || event.type !== "REMOVE_KEYWORD") return context.pendingSub;
    return {
      ...context.pendingSub,
      positiveKeywords: context.pendingSub.positiveKeywords.filter((_: string, i: number) => i !== event.index),
    };
  },
};

export const removeNegativeKeyword = {
  pendingSub: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingSub || event.type !== "REMOVE_KEYWORD") return context.pendingSub;
    return {
      ...context.pendingSub,
      negativeKeywords: context.pendingSub.negativeKeywords.filter((_: string, i: number) => i !== event.index),
    };
  },
};

// === Group selection ===

export const startGroupSelection = {
  availableGroups: ({ event }: { event: BotEvent }) => {
    if (event.type === "START_GROUP_SELECTION") return event.available;
    return [];
  },
  selectedGroups: ({ event }: { event: BotEvent }) => {
    if (event.type === "START_GROUP_SELECTION") return event.available;
    return [];
  },
};

export const toggleGroup = {
  selectedGroups: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (event.type !== "TOGGLE_GROUP") return context.selectedGroups;
    const exists = context.selectedGroups.some((g) => g.id === event.groupId);
    if (exists) {
      return context.selectedGroups.filter((g) => g.id !== event.groupId);
    }
    const group = context.availableGroups.find((g) => g.id === event.groupId);
    return group ? [...context.selectedGroups, group] : context.selectedGroups;
  },
};

export const selectAllGroups = {
  selectedGroups: ({ context }: { context: BotContext }) => [...context.availableGroups],
};

export const deselectAllGroups = {
  selectedGroups: () => [] as BotContext["selectedGroups"],
};

// === Adding groups ===

export const setChatShared = {
  currentPendingGroup: ({ event }: { event: BotEvent }) => {
    if (event.type === "CHAT_SHARED" && event.group.needsInviteLink) return event.group;
    return null;
  },
  pendingGroups: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (event.type === "CHAT_SHARED" && !event.group.needsInviteLink) {
      return [...context.pendingGroups, event.group];
    }
    return context.pendingGroups;
  },
};

export const setInviteLink = {
  currentPendingGroup: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.currentPendingGroup || event.type !== "INVITE_LINK") return context.currentPendingGroup;
    return { ...context.currentPendingGroup, inviteLink: event.link };
  },
};

export const addJoinedGroup = {
  pendingGroups: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (event.type === "GROUP_JOINED") return [...context.pendingGroups, event.group];
    return context.pendingGroups;
  },
  currentPendingGroup: () => null as BotContext["currentPendingGroup"],
};

export const skipInvite = {
  currentPendingGroup: () => null as BotContext["currentPendingGroup"],
};

export const clearAddingGroups = {
  pendingGroups: () => [] as BotContext["pendingGroups"],
  currentPendingGroup: () => null as BotContext["currentPendingGroup"],
};

// === Editing existing subscription ===

export const setEditingPositive = {
  editingSubscriptionId: ({ event }: { event: BotEvent }) => {
    if (event.type === "EDIT_SUB_POSITIVE") return event.subscriptionId;
    return null;
  },
};

export const setEditingNegative = {
  editingSubscriptionId: ({ event }: { event: BotEvent }) => {
    if (event.type === "EDIT_SUB_NEGATIVE") return event.subscriptionId;
    return null;
  },
};

export const setEditingDescription = {
  editingSubscriptionId: ({ event }: { event: BotEvent }) => {
    if (event.type === "EDIT_SUB_DESCRIPTION") return event.subscriptionId;
    return null;
  },
};

export const setAiEdit = {
  pendingAiEdit: ({ event }: { event: BotEvent }) => {
    if (event.type === "EDIT_SUB_AI") return event.data;
    return null;
  },
};

export const updateAiConversation = {
  pendingAiEdit: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingAiEdit || event.type !== "TEXT_AI_COMMAND") return context.pendingAiEdit;
    return {
      ...context.pendingAiEdit,
      conversation: [...context.pendingAiEdit.conversation, { role: "user" as const, content: event.text }],
    };
  },
};

export const setAiProposed = {
  pendingAiEdit: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingAiEdit || event.type !== "AI_PROPOSED") return context.pendingAiEdit;
    return { ...context.pendingAiEdit, proposed: event.proposed };
  },
};

export const clearEditing = {
  editingSubscriptionId: () => null as BotContext["editingSubscriptionId"],
  pendingAiEdit: () => null as BotContext["pendingAiEdit"],
};

// === AI correction for pending subscription ===

export const startAiCorrection = {
  pendingAiCorrection: ({ event }: { event: BotEvent }) => {
    if (event.type === "START_AI_CORRECTION") return event.data;
    return null;
  },
};

export const updateAiCorrectionConversation = {
  pendingAiCorrection: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingAiCorrection || event.type !== "TEXT_AI_COMMAND") return context.pendingAiCorrection;
    return {
      ...context.pendingAiCorrection,
      conversation: [...context.pendingAiCorrection.conversation, { role: "user" as const, content: event.text }],
    };
  },
};

export const setAiCorrectionProposed = {
  pendingAiCorrection: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingAiCorrection || event.type !== "AI_CORRECTION_PROPOSED") return context.pendingAiCorrection;
    return { ...context.pendingAiCorrection, proposed: event.proposed };
  },
};

export const applyAiCorrection = {
  pendingSub: ({ context }: { context: BotContext }) => {
    if (!context.pendingAiCorrection?.proposed || !context.pendingSub) return context.pendingSub;
    return {
      ...context.pendingSub,
      positiveKeywords: context.pendingAiCorrection.proposed.positiveKeywords,
      negativeKeywords: context.pendingAiCorrection.proposed.negativeKeywords,
      llmDescription: context.pendingAiCorrection.proposed.llmDescription,
    };
  },
  pendingAiCorrection: () => null as BotContext["pendingAiCorrection"],
};

// === User mode ===

export const setUserMode = {
  userMode: ({ event }: { event: BotEvent }) => {
    if (event.type === "SET_USER_MODE") return event.mode;
    return "normal" as const;
  },
};
