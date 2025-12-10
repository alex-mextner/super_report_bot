import { queries } from "../db/index.ts";
import { logger } from "../logger.ts";
import { computeAndSaveGroupAnalytics } from "./compute.ts";
import { generateInsights } from "./insights.ts";

const ANALYTICS_HOUR = 3; // 3:00 AM

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

export async function runAllGroupAnalytics(): Promise<void> {
  logger.info("Starting nightly analytics computation...");

  // Get all groups with messages
  const groups = queries.getDistinctMessageGroups();

  if (groups.length === 0) {
    logger.info("No groups found, skipping analytics");
    return;
  }

  logger.info({ groupCount: groups.length }, "Processing groups for analytics");

  let successCount = 0;
  let errorCount = 0;

  for (const group of groups) {
    try {
      // Compute and save stats
      const stats = await computeAndSaveGroupAnalytics(group.group_id);

      // Generate LLM insights (if HF_TOKEN available)
      const insights = await generateInsights(stats);
      if (insights) {
        queries.updateGroupInsights(group.group_id, insights);
      }

      successCount++;

      // Rate limiting between groups (avoid overwhelming LLM API)
      await new Promise((r) => setTimeout(r, 2000));
    } catch (error) {
      logger.error({ groupId: group.group_id, error }, "Failed to compute analytics for group");
      errorCount++;
    }
  }

  logger.info({ successCount, errorCount }, "Nightly analytics completed");
}

function getMillisecondsUntilHour(targetHour: number): number {
  const now = new Date();
  const target = new Date(now);

  target.setHours(targetHour, 0, 0, 0);

  // If target time already passed today, schedule for tomorrow
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime() - now.getTime();
}

export function scheduleNightlyAnalytics(): void {
  const msUntilRun = getMillisecondsUntilHour(ANALYTICS_HOUR);
  const nextRunDate = new Date(Date.now() + msUntilRun);

  logger.info(
    { nextRun: nextRunDate.toISOString(), hoursUntil: Math.round(msUntilRun / 3600000) },
    "Scheduling nightly analytics"
  );

  // Clear any existing timer
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
  }

  schedulerTimer = setTimeout(async () => {
    await runAllGroupAnalytics();

    // Schedule next run (24 hours from now)
    scheduleNightlyAnalytics();
  }, msUntilRun);
}

export function stopAnalyticsScheduler(): void {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
    logger.info("Analytics scheduler stopped");
  }
}
