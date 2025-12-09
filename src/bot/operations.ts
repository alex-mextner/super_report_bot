/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *                     OPERATION RECOVERY WRAPPER
 *
 *     Tracks long-running operations for auto-recovery after bot restart
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Problem: When the bot restarts during an LLM call, the user sees
 * "Generating keywords..." forever, with no way to recover.
 *
 * Solution: Before starting a long operation, we save a marker in the FSM context.
 * On restart, we find users with pending operations and retry them.
 *
 * Usage:
 *   const keywords = await runWithRecovery(
 *     userId,
 *     "GENERATE_KEYWORDS",
 *     progressMessageId,
 *     () => generateKeywords(query)
 *   );
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { send } from "../fsm/adapter";
import type { PendingOperationType } from "../fsm/context";
import { botLog } from "../logger";

/**
 * Run an async operation with recovery support.
 *
 * 1. Sets pendingOperation in FSM context (persisted to DB)
 * 2. Runs the operation
 * 3. Clears pendingOperation when done (success or failure)
 *
 * If bot restarts mid-operation, recovery.ts will find this user
 * and retry the operation.
 *
 * @param userId - Telegram user ID
 * @param operationType - Type of operation (for recovery routing)
 * @param messageId - ID of "progress" message to edit on recovery
 * @param operation - The async function to run
 */
export async function runWithRecovery<T>(
  userId: number,
  operationType: PendingOperationType,
  messageId: number | undefined,
  operation: () => Promise<T>
): Promise<T> {
  // Mark operation as started
  botLog.info({ userId, operationType, messageId }, "Starting operation with recovery tracking");

  send(userId, {
    type: "START_OPERATION",
    operation: {
      type: operationType,
      startedAt: Date.now(),
      messageId,
    },
  });

  try {
    const result = await operation();
    // Clear operation marker on success
    send(userId, { type: "CLEAR_OPERATION" });
    botLog.info({ userId, operationType }, "Operation completed successfully");
    return result;
  } catch (error) {
    // Clear operation marker on failure too
    send(userId, { type: "CLEAR_OPERATION" });
    botLog.error({ userId, operationType, err: error }, "Operation failed");
    throw error;
  }
}
