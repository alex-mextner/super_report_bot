/**
 * Publication Worker
 *
 * Processes publication queue and sends messages to groups
 * with anti-spam delays (3-5 minutes between posts).
 */

import { queries } from "../db/index.ts";
import { sendTextAsUser, getClientForUser } from "./index.ts";
import { botLog } from "../logger.ts";

// Delay between posts (3-5 minutes in milliseconds)
const MIN_DELAY_MS = 3 * 60 * 1000; // 3 minutes
const MAX_DELAY_MS = 5 * 60 * 1000; // 5 minutes

// Worker state
let isRunning = false;
let workerId: ReturnType<typeof setTimeout> | null = null;

/**
 * Random delay between min and max
 */
function getRandomDelay(): number {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

/**
 * Process a single publication post
 */
async function processPost(
  post: ReturnType<typeof queries.getPendingPublicationPosts>[number],
  publication: NonNullable<ReturnType<typeof queries.getPublication>>
): Promise<boolean> {
  botLog.info(
    { postId: post.id, groupId: post.group_id, publicationId: publication.id },
    "Processing publication post"
  );

  // Send message via MTProto
  const result = await sendTextAsUser(
    publication.telegram_id,
    post.group_id,
    publication.text
  );

  if ("error" in result) {
    botLog.error(
      { postId: post.id, groupId: post.group_id, error: result.error },
      "Failed to send publication post"
    );
    queries.updatePublicationPostStatus(post.id, "failed", undefined, result.error);
    return false;
  }

  // Success!
  botLog.info(
    { postId: post.id, groupId: post.group_id, messageId: result.messageId },
    "Publication post sent successfully"
  );
  queries.updatePublicationPostStatus(post.id, "sent", result.messageId);
  queries.incrementPublicationProgress(publication.id, true);

  return true;
}

/**
 * Process pending publications
 */
async function processPendingPublications(): Promise<void> {
  // Get all pending posts (ordered by publication_id, created_at)
  const pendingPosts = queries.getPendingPublicationPosts();

  if (pendingPosts.length === 0) {
    return;
  }

  botLog.info({ count: pendingPosts.length }, "Found pending publication posts");

  // Group by publication_id
  const postsByPublication = new Map<number, typeof pendingPosts>();
  for (const post of pendingPosts) {
    const existing = postsByPublication.get(post.publication_id) || [];
    existing.push(post);
    postsByPublication.set(post.publication_id, existing);
  }

  // Process one post per publication (round-robin to spread load)
  for (const [publicationId, posts] of postsByPublication) {
    const publication = queries.getPublication(publicationId);
    if (!publication) {
      botLog.warn({ publicationId }, "Publication not found, skipping posts");
      continue;
    }

    // Check if user has active session
    const client = await getClientForUser(publication.telegram_id);
    if (!client) {
      botLog.warn(
        { publicationId, userId: publication.telegram_id },
        "No active session for user, failing publication"
      );
      queries.updatePublicationStatus(publicationId, "failed", "No active session");
      for (const post of posts) {
        queries.updatePublicationPostStatus(post.id, "failed", undefined, "No active session");
      }
      continue;
    }

    // Mark publication as processing
    if (publication.status === "pending") {
      queries.updatePublicationStatus(publicationId, "processing");
    }

    // Process first pending post
    const post = posts[0];
    if (post) {
      const success = await processPost(post, publication);

      // If success and more posts remain, schedule next iteration with delay
      if (success && posts.length > 1) {
        const delay = getRandomDelay();
        botLog.info(
          { publicationId, remainingPosts: posts.length - 1, delayMs: delay },
          "Scheduling next post with delay"
        );
      }
    }

    // Check if publication is complete
    const updatedPublication = queries.getPublication(publicationId);
    if (updatedPublication) {
      const remainingPosts = posts.length - 1;
      if (remainingPosts === 0) {
        // All posts processed - check if any failed
        const finalStatus = updatedPublication.published_groups < updatedPublication.total_groups
          ? "completed" // Some failed but we're done
          : "completed";
        queries.updatePublicationStatus(publicationId, finalStatus);
        botLog.info(
          {
            publicationId,
            published: updatedPublication.published_groups,
            total: updatedPublication.total_groups,
          },
          "Publication completed"
        );
      }
    }
  }
}

/**
 * Worker tick - runs periodically
 */
async function workerTick(): Promise<void> {
  if (!isRunning) return;

  try {
    await processPendingPublications();
  } catch (error) {
    botLog.error({ error }, "Publication worker error");
  }

  // Schedule next tick with random delay (to spread posts over time)
  if (isRunning) {
    const delay = getRandomDelay();
    workerId = setTimeout(workerTick, delay);
  }
}

/**
 * Start the publication worker
 */
export function startPublicationWorker(): void {
  if (isRunning) {
    botLog.warn("Publication worker already running");
    return;
  }

  isRunning = true;
  botLog.info("Starting publication worker");

  // Initial tick after short delay
  workerId = setTimeout(workerTick, 5000);
}

/**
 * Stop the publication worker
 */
export function stopPublicationWorker(): void {
  if (!isRunning) return;

  isRunning = false;
  if (workerId) {
    clearTimeout(workerId);
    workerId = null;
  }

  botLog.info("Publication worker stopped");
}

/**
 * Trigger immediate processing (after payment success)
 */
export function triggerPublicationProcessing(): void {
  if (!isRunning) {
    botLog.warn("Publication worker not running, cannot trigger");
    return;
  }

  // Clear current scheduled tick and run immediately
  if (workerId) {
    clearTimeout(workerId);
  }

  // Run immediately
  workerTick().catch((err) => {
    botLog.error({ error: err }, "Error in triggered publication processing");
  });
}

/**
 * Start a specific publication (after payment)
 */
export async function startPublication(publicationId: number): Promise<void> {
  const publication = queries.getPublication(publicationId);
  if (!publication) {
    botLog.error({ publicationId }, "Publication not found");
    return;
  }

  // Get preset groups
  const presetGroups = queries.getPresetGroups(publication.preset_id);
  if (presetGroups.length === 0) {
    botLog.error({ publicationId, presetId: publication.preset_id }, "No groups in preset");
    queries.updatePublicationStatus(publicationId, "failed", "No groups in preset");
    return;
  }

  // Set total groups count
  queries.setPublicationTotalGroups(publicationId, presetGroups.length);

  // Create posts for each group
  const groupIds = presetGroups.map((g) => g.group_id);
  queries.createPublicationPosts(publicationId, groupIds);

  botLog.info(
    { publicationId, groupCount: groupIds.length },
    "Publication posts created, ready for processing"
  );

  // Trigger immediate processing
  triggerPublicationProcessing();
}
