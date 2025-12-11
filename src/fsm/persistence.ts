import { createActor, type SnapshotFrom } from "xstate";
import { userMachine, type UserMachine } from "./machine";
import { createInitialContext, type BotContext } from "./context";
import { queries } from "../db";
import type { UserMode } from "../types";

export type UserActor = ReturnType<typeof createActor<UserMachine>>;
export type UserSnapshot = SnapshotFrom<typeof userMachine>;

// Load user's persisted snapshot from database
export function loadUserSnapshot(telegramId: number): UserSnapshot | null {
  const snapshotJson = queries.getUserStateSnapshot(telegramId);
  if (!snapshotJson) return null;

  try {
    return JSON.parse(snapshotJson) as UserSnapshot;
  } catch {
    console.error(`Failed to parse user state for ${telegramId}`);
    return null;
  }
}

// Save user's snapshot to database
export function saveUserSnapshot(telegramId: number, actor: UserActor): void {
  const snapshot = actor.getPersistedSnapshot();
  queries.saveUserStateSnapshot(telegramId, JSON.stringify(snapshot));
}

// Create or restore actor for user
export function createUserActor(telegramId: number, userMode: UserMode = "normal"): UserActor {
  const persisted = loadUserSnapshot(telegramId);

  // If we have persisted state, restore it
  if (persisted) {
    const actor = createActor(userMachine, {
      snapshot: persisted,
    });

    // Subscribe to state changes and persist
    actor.subscribe(() => {
      saveUserSnapshot(telegramId, actor);
    });

    actor.start();
    return actor;
  }

  // Create new actor with initial context
  const initialContext = createInitialContext(telegramId, userMode);
  const actor = createActor(userMachine, {
    input: initialContext,
  });

  // Subscribe to state changes and persist
  actor.subscribe(() => {
    saveUserSnapshot(telegramId, actor);
  });

  actor.start();

  // Save initial state
  saveUserSnapshot(telegramId, actor);

  return actor;
}

// Reset user to idle state
export function resetUserState(telegramId: number, userMode: UserMode = "normal"): UserActor {
  queries.deleteUserState(telegramId);
  return createUserActor(telegramId, userMode);
}

// Get current state value (e.g., "idle", "ratingExamples")
export function getStateValue(actor: UserActor): string {
  const snapshot = actor.getSnapshot();
  return snapshot.value as string;
}

// All possible state values
export type StateValue =
  | "idle"
  | "clarifyingQuery"
  | "ratingExamples"
  | "awaitingConfirmation"
  | "correctingPendingAi"
  | "addingPositive"
  | "addingNegative"
  | "removingPositive"
  | "removingNegative"
  | "selectingGroups"
  | "addingGroup"
  | "awaitingInviteLink"
  | "collectingGroupMetadata"
  | "editingSubPositive"
  | "editingSubNegative"
  | "editingSubDescription"
  | "editingSubAi"
  | "collectingFeedbackOutcome"
  | "awaitingFeedbackReview";

// Check if actor is in specific state
export function isInState(actor: UserActor, state: StateValue): boolean {
  return actor.getSnapshot().matches(state);
}

// Get context from actor
export function getContext(actor: UserActor): BotContext {
  return actor.getSnapshot().context;
}
