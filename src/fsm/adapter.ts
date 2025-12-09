/**
 * FSM Adapter - manages user actors with SQLite persistence.
 *
 * Usage:
 * - send(userId, event) - dispatch FSM event
 * - getFsmContext(userId) - get current FSM context
 * - getCurrentState(userId) - get current state name
 */

import {
  createUserActor,
  getContext,
  getStateValue,
  isInState,
  type UserActor,
  type StateValue,
} from "./index";
import type { BotContext } from "./context";
import type { BotEvent } from "./events";
import { queries } from "../db";

// In-memory cache of actors (state is persisted to DB)
const actors = new Map<number, UserActor>();

/**
 * Get or create actor for user
 */
export function getActor(telegramId: number): UserActor {
  let actor = actors.get(telegramId);
  if (!actor) {
    // Ensure user exists in DB first
    queries.getOrCreateUser(telegramId);
    const mode = queries.getUserMode(telegramId);
    actor = createUserActor(telegramId, mode);
    actors.set(telegramId, actor);
  }
  return actor;
}

/**
 * Send event to user's FSM
 */
export function send(telegramId: number, event: BotEvent): void {
  const actor = getActor(telegramId);
  actor.send(event);
}

/**
 * Get current state value
 */
export function getCurrentState(telegramId: number): StateValue {
  const actor = getActor(telegramId);
  return getStateValue(actor) as StateValue;
}

/**
 * Check if user is in specific state
 */
export function checkState(telegramId: number, state: StateValue): boolean {
  const actor = getActor(telegramId);
  return isInState(actor, state);
}

/**
 * Get FSM context
 */
export function getFsmContext(telegramId: number): BotContext {
  const actor = getActor(telegramId);
  return getContext(actor);
}

/**
 * Clear actor from cache (for cleanup)
 */
export function clearActor(telegramId: number): void {
  const actor = actors.get(telegramId);
  if (actor) {
    actor.stop();
    actors.delete(telegramId);
  }
}

/**
 * Get all active actors count (for monitoring)
 */
export function getActiveActorsCount(): number {
  return actors.size;
}
