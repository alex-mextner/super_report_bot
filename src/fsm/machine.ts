import { setup, assign } from "xstate";
import type { BotContext } from "./context";
import type { BotEvent } from "./events";
import * as guards from "./guards";
import * as actions from "./actions";

export const userMachine = setup({
  types: {
    context: {} as BotContext,
    events: {} as BotEvent,
  },
  guards: {
    isAdvancedMode: guards.isAdvancedMode,
    hasAvailableGroups: guards.hasAvailableGroups,
    allExamplesRated: guards.allExamplesRated,
    allQuestionsAnswered: guards.allQuestionsAnswered,
    needsInviteLink: guards.needsInviteLink,
    hasPendingSub: guards.hasPendingSub,
    hasPositiveKeywords: guards.hasPositiveKeywords,
    hasNegativeKeywords: guards.hasNegativeKeywords,
    hasProposedAiEdit: guards.hasProposedAiEdit,
    hasProposedAiCorrection: guards.hasProposedAiCorrection,
    hasSelectedGroups: guards.hasSelectedGroups,
  },
  actions: {
    clearContext: assign(actions.clearContext),
    // Clarification
    startClarification: assign(actions.startClarification),
    assignAnswer: assign(actions.assignAnswer),
    skipQuestion: assign(actions.skipQuestion),
    // Rating
    startRating: assign(actions.startRating),
    assignRating: assign(actions.assignRating),
    // Pending subscription
    setKeywordsGenerated: assign(actions.setKeywordsGenerated),
    setPendingSub: assign(actions.setPendingSub),
    updateDraftKeywords: assign(actions.updateDraftKeywords),
    // Keyword editing
    addPositiveKeywords: assign(actions.addPositiveKeywords),
    addNegativeKeywords: assign(actions.addNegativeKeywords),
    removePositiveKeyword: assign(actions.removePositiveKeyword),
    removeNegativeKeyword: assign(actions.removeNegativeKeyword),
    // Group selection
    startGroupSelection: assign(actions.startGroupSelection),
    toggleGroup: assign(actions.toggleGroup),
    selectAllGroups: assign(actions.selectAllGroups),
    deselectAllGroups: assign(actions.deselectAllGroups),
    // Adding groups
    setChatShared: assign(actions.setChatShared),
    setInviteLink: assign(actions.setInviteLink),
    addJoinedGroup: assign(actions.addJoinedGroup),
    skipInvite: assign(actions.skipInvite),
    clearAddingGroups: assign(actions.clearAddingGroups),
    // Editing subscription
    setEditingPositive: assign(actions.setEditingPositive),
    setEditingNegative: assign(actions.setEditingNegative),
    setEditingDescription: assign(actions.setEditingDescription),
    setAiEdit: assign(actions.setAiEdit),
    updateAiConversation: assign(actions.updateAiConversation),
    setAiProposed: assign(actions.setAiProposed),
    clearEditing: assign(actions.clearEditing),
    // AI correction
    startAiCorrection: assign(actions.startAiCorrection),
    updateAiCorrectionConversation: assign(actions.updateAiCorrectionConversation),
    setAiCorrectionProposed: assign(actions.setAiCorrectionProposed),
    applyAiCorrection: assign(actions.applyAiCorrection),
    // User mode
    setUserMode: assign(actions.setUserMode),
  },
}).createMachine({
  id: "userBot",
  initial: "idle",
  context: ({ input }) => input as BotContext,
  states: {
    // ============================================================
    // IDLE - waiting for user input
    // ============================================================
    idle: {
      on: {
        // New subscription: text query
        TEXT_QUERY: [
          { target: "clarifyingQuery", guard: "isAdvancedMode" },
          { target: "ratingExamples" },
        ],
        // Start rating flow directly (called from handler after finding examples)
        START_RATING: {
          target: "ratingExamples",
          actions: "startRating",
        },
        // Start clarification flow (advanced mode)
        START_CLARIFICATION: {
          target: "clarifyingQuery",
          actions: "startClarification",
        },
        // Keywords already generated, go to confirmation
        KEYWORDS_GENERATED: {
          target: "awaitingConfirmation",
          actions: "setKeywordsGenerated",
        },
        // Add groups command
        ADDGROUP: { target: "addingGroup" },
        // Edit existing subscription
        EDIT_SUB_POSITIVE: {
          target: "editingSubPositive",
          actions: "setEditingPositive",
        },
        EDIT_SUB_NEGATIVE: {
          target: "editingSubNegative",
          actions: "setEditingNegative",
        },
        EDIT_SUB_DESCRIPTION: {
          target: "editingSubDescription",
          actions: "setEditingDescription",
        },
        EDIT_SUB_AI: {
          target: "editingSubAi",
          actions: "setAiEdit",
        },
        // Update user mode (doesn't change state)
        SET_USER_MODE: {
          actions: "setUserMode",
        },
      },
    },

    // ============================================================
    // CLARIFYING_QUERY - asking clarification questions (advanced mode)
    // ============================================================
    clarifyingQuery: {
      on: {
        ANSWER: [
          {
            target: "ratingExamples",
            guard: "allQuestionsAnswered",
            actions: "assignAnswer",
          },
          {
            target: "clarifyingQuery",
            actions: "assignAnswer",
          },
        ],
        SKIP_QUESTION: [
          {
            target: "ratingExamples",
            guard: "allQuestionsAnswered",
            actions: "skipQuestion",
          },
          {
            target: "clarifyingQuery",
            actions: "skipQuestion",
          },
        ],
        CANCEL: {
          target: "idle",
          actions: "clearContext",
        },
      },
    },

    // ============================================================
    // RATING_EXAMPLES - user rates similar messages
    // ============================================================
    ratingExamples: {
      on: {
        RATE: [
          {
            target: "awaitingConfirmation",
            guard: "allExamplesRated",
            actions: "assignRating",
          },
          {
            target: "ratingExamples",
            actions: "assignRating",
          },
        ],
        SKIP_RATING: {
          target: "awaitingConfirmation",
        },
        // Keywords generated while rating (async)
        KEYWORDS_GENERATED: {
          target: "awaitingConfirmation",
          actions: "setKeywordsGenerated",
        },
        CANCEL: {
          target: "idle",
          actions: "clearContext",
        },
      },
    },

    // ============================================================
    // AWAITING_CONFIRMATION - user reviews generated keywords
    // ============================================================
    awaitingConfirmation: {
      on: {
        CONFIRM: [
          {
            target: "selectingGroups",
            guard: "hasAvailableGroups",
          },
          {
            target: "idle",
            // Subscription saved by handler
          },
        ],
        CANCEL: {
          target: "idle",
          actions: "clearContext",
        },
        REGENERATE: {
          target: "awaitingConfirmation",
          // Handler regenerates keywords
        },
        // Edit keywords
        ADD_POSITIVE: { target: "addingPositive" },
        ADD_NEGATIVE: { target: "addingNegative" },
        REMOVE_POSITIVE: { target: "removingPositive" },
        REMOVE_NEGATIVE: { target: "removingNegative" },
        // AI correction for pending subscription
        START_AI_CORRECTION: {
          target: "correctingPendingAi",
          actions: "startAiCorrection",
        },
        // Update pending sub (after regenerate)
        SET_PENDING_SUB: {
          actions: "setPendingSub",
        },
        // Start group selection
        START_GROUP_SELECTION: {
          target: "selectingGroups",
          actions: "startGroupSelection",
        },
      },
    },

    // ============================================================
    // CORRECTING_PENDING_AI - AI correction during subscription creation
    // ============================================================
    correctingPendingAi: {
      on: {
        TEXT_AI_COMMAND: {
          target: "correctingPendingAi",
          actions: "updateAiCorrectionConversation",
        },
        AI_CORRECTION_PROPOSED: {
          target: "correctingPendingAi",
          actions: "setAiCorrectionProposed",
        },
        APPLY_AI_CORRECTION: {
          target: "awaitingConfirmation",
          actions: "applyAiCorrection",
        },
        CANCEL: {
          target: "awaitingConfirmation",
        },
      },
    },

    // ============================================================
    // ADDING_POSITIVE - adding positive keywords to pending sub
    // ============================================================
    addingPositive: {
      on: {
        TEXT_KEYWORDS: {
          target: "awaitingConfirmation",
          actions: "addPositiveKeywords",
        },
        BACK_TO_CONFIRM: { target: "awaitingConfirmation" },
        CANCEL: { target: "awaitingConfirmation" },
      },
    },

    // ============================================================
    // ADDING_NEGATIVE - adding negative keywords to pending sub
    // ============================================================
    addingNegative: {
      on: {
        TEXT_KEYWORDS: {
          target: "awaitingConfirmation",
          actions: "addNegativeKeywords",
        },
        BACK_TO_CONFIRM: { target: "awaitingConfirmation" },
        CANCEL: { target: "awaitingConfirmation" },
      },
    },

    // ============================================================
    // REMOVING_POSITIVE - removing positive keywords
    // ============================================================
    removingPositive: {
      on: {
        REMOVE_KEYWORD: {
          target: "removingPositive",
          actions: "removePositiveKeyword",
        },
        BACK_TO_CONFIRM: { target: "awaitingConfirmation" },
        CANCEL: { target: "awaitingConfirmation" },
      },
    },

    // ============================================================
    // REMOVING_NEGATIVE - removing negative keywords
    // ============================================================
    removingNegative: {
      on: {
        REMOVE_KEYWORD: {
          target: "removingNegative",
          actions: "removeNegativeKeyword",
        },
        BACK_TO_CONFIRM: { target: "awaitingConfirmation" },
        CANCEL: { target: "awaitingConfirmation" },
      },
    },

    // ============================================================
    // SELECTING_GROUPS - user selects groups for subscription
    // ============================================================
    selectingGroups: {
      on: {
        TOGGLE_GROUP: {
          target: "selectingGroups",
          actions: "toggleGroup",
        },
        SELECT_ALL: {
          target: "selectingGroups",
          actions: "selectAllGroups",
        },
        DESELECT_ALL: {
          target: "selectingGroups",
          actions: "deselectAllGroups",
        },
        CONFIRM_GROUPS: {
          target: "idle",
          // Subscription saved by handler
        },
        SKIP_GROUPS: {
          target: "idle",
          // Subscription saved by handler with empty groups
        },
        CANCEL: {
          target: "idle",
          actions: "clearContext",
        },
      },
    },

    // ============================================================
    // ADDING_GROUP - /addgroup flow
    // ============================================================
    addingGroup: {
      on: {
        CHAT_SHARED: [
          {
            target: "awaitingInviteLink",
            guard: "needsInviteLink",
            actions: "setChatShared",
          },
          {
            target: "addingGroup",
            actions: "setChatShared",
          },
        ],
        GROUP_JOINED: {
          target: "addingGroup",
          actions: "addJoinedGroup",
        },
        DONE_ADDING_GROUPS: {
          target: "idle",
          actions: "clearAddingGroups",
        },
        CANCEL: {
          target: "idle",
          actions: "clearAddingGroups",
        },
      },
    },

    // ============================================================
    // AWAITING_INVITE_LINK - waiting for private group invite link
    // ============================================================
    awaitingInviteLink: {
      on: {
        INVITE_LINK: {
          target: "addingGroup",
          actions: "setInviteLink",
        },
        SKIP_INVITE: {
          target: "addingGroup",
          actions: "skipInvite",
        },
        CANCEL: {
          target: "idle",
          actions: "clearAddingGroups",
        },
      },
    },

    // ============================================================
    // EDITING_SUB_POSITIVE - editing existing subscription positive keywords
    // ============================================================
    editingSubPositive: {
      on: {
        TEXT_KEYWORDS: {
          target: "idle",
          actions: "clearEditing",
          // Handler updates DB
        },
        CANCEL: {
          target: "idle",
          actions: "clearEditing",
        },
      },
    },

    // ============================================================
    // EDITING_SUB_NEGATIVE - editing existing subscription negative keywords
    // ============================================================
    editingSubNegative: {
      on: {
        TEXT_KEYWORDS: {
          target: "idle",
          actions: "clearEditing",
          // Handler updates DB
        },
        CANCEL: {
          target: "idle",
          actions: "clearEditing",
        },
      },
    },

    // ============================================================
    // EDITING_SUB_DESCRIPTION - editing existing subscription description
    // ============================================================
    editingSubDescription: {
      on: {
        TEXT_DESCRIPTION: {
          target: "idle",
          actions: "clearEditing",
          // Handler updates DB
        },
        CANCEL: {
          target: "idle",
          actions: "clearEditing",
        },
      },
    },

    // ============================================================
    // EDITING_SUB_AI - AI-assisted editing of existing subscription
    // ============================================================
    editingSubAi: {
      on: {
        TEXT_AI_COMMAND: {
          target: "editingSubAi",
          actions: "updateAiConversation",
        },
        AI_PROPOSED: {
          target: "editingSubAi",
          actions: "setAiProposed",
        },
        APPLY_AI_EDIT: {
          target: "idle",
          actions: "clearEditing",
          // Handler applies changes to DB
        },
        CANCEL: {
          target: "idle",
          actions: "clearEditing",
        },
      },
    },
  },
});

export type UserMachine = typeof userMachine;
export type UserMachineSnapshot = ReturnType<typeof userMachine.getInitialSnapshot>;
