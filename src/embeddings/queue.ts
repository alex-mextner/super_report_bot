/**
 * Background embedding queue for message indexing
 *
 * Batches messages for efficient BGE-M3 embedding generation.
 * Processes asynchronously to avoid blocking message handling.
 */
import { getEmbeddings, checkBgeHealth } from "../llm/embeddings.ts";
import { queries, isSqliteVecAvailable } from "../db/index.ts";
import { listenerLog } from "../logger.ts";

interface QueueItem {
  id: number;
  text: string;
}

// Queue state
const queue: QueueItem[] = [];
let isProcessing = false;
let retryTimeout: Timer | null = null;

// BGE-M3 batch size
const BATCH_SIZE = 32;
// Retry delay when BGE is unavailable (ms)
const RETRY_DELAY = 5000;
// Max queue size before dropping old items
const MAX_QUEUE_SIZE = 10000;

/**
 * Add a message to the embedding queue
 */
export function queueForEmbedding(messageId: number, text: string): void {
  // Skip if sqlite-vec not available
  if (!isSqliteVecAvailable()) {
    listenerLog.debug("Embedding queue: sqlite-vec not available, skipping");
    return;
  }

  // Skip if already has embedding
  try {
    if (queries.hasEmbedding(messageId)) {
      return;
    }
  } catch (e) {
    // Table might not exist yet
    listenerLog.warn({ err: e }, "Embedding queue: hasEmbedding check failed");
    return;
  }

  // Prevent queue overflow
  if (queue.length >= MAX_QUEUE_SIZE) {
    listenerLog.warn({ queueSize: queue.length }, "Embedding queue overflow, dropping oldest items");
    queue.splice(0, BATCH_SIZE); // Drop oldest batch
  }

  queue.push({ id: messageId, text });
  listenerLog.debug({ messageId, queueSize: queue.length }, "Message queued for embedding");

  // Start processing if not already running
  if (!isProcessing && !retryTimeout) {
    processQueue();
  }
}

/**
 * Process the embedding queue in batches
 */
async function processQueue(): Promise<void> {
  if (isProcessing || queue.length === 0) return;

  isProcessing = true;
  listenerLog.debug({ queueSize: queue.length }, "Starting embedding queue processing");

  while (queue.length > 0) {
    // Check BGE health before processing
    const healthy = await checkBgeHealth();
    if (!healthy) {
      listenerLog.warn("BGE server unavailable, scheduling retry");
      scheduleRetry();
      break;
    }

    // Take a batch
    const batch = queue.splice(0, BATCH_SIZE);

    try {
      const texts = batch.map((m) => m.text);
      const embeddings = await getEmbeddings(texts);

      // Save embeddings to database
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const embedding = embeddings[i];
        if (item && embedding) {
          queries.saveMessageEmbedding(item.id, embedding);
        }
      }

      listenerLog.debug({ batchSize: batch.length, remaining: queue.length }, "Processed embedding batch");
    } catch (error) {
      listenerLog.error({ err: error, batchSize: batch.length }, "Failed to process embedding batch");

      // Return batch to queue for retry
      queue.unshift(...batch);
      scheduleRetry();
      break;
    }
  }

  isProcessing = false;
}

/**
 * Schedule a retry after delay
 */
function scheduleRetry(): void {
  isProcessing = false;

  if (retryTimeout) return; // Already scheduled

  retryTimeout = setTimeout(() => {
    retryTimeout = null;
    processQueue();
  }, RETRY_DELAY);
}

/**
 * Get current queue status
 */
export function getQueueStatus(): { size: number; isProcessing: boolean } {
  return {
    size: queue.length,
    isProcessing,
  };
}

/**
 * Force process the queue (for testing/admin)
 */
export async function forceProcessQueue(): Promise<void> {
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
  await processQueue();
}
