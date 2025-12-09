// FSM exports
export { userMachine, type UserMachine, type UserMachineSnapshot } from "./machine";
export {
  createUserActor,
  loadUserSnapshot,
  saveUserSnapshot,
  resetUserState,
  getStateValue,
  isInState,
  getContext,
  type UserActor,
  type UserSnapshot,
  type StateValue,
} from "./persistence";
export {
  type BotContext,
  type PendingSubscription,
  type ClarificationData,
  type RatingExamplesData,
  type AiEditData,
  type AiCorrectionData,
  type GroupData,
  createInitialContext,
} from "./context";
export type { BotEvent } from "./events";

// Adapter for gradual migration
export {
  getActor,
  send,
  getCurrentState,
  checkState,
  getFsmContext,
  getState,
  setState,
  clearActor,
  getActiveActorsCount,
} from "./adapter";
