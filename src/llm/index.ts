import { InferenceClient } from "@huggingface/inference";

const HF_TOKEN = process.env.HF_TOKEN;

if (!HF_TOKEN) {
  console.warn("Warning: HF_TOKEN not set. LLM features will not work.");
}

export const hf = new InferenceClient(HF_TOKEN);

// Models
export const MODELS = {
  // For keyword generation (DeepSeek R1 via Novita provider)
  DEEPSEEK_R1: "deepseek-ai/DeepSeek-R1",
  // Fallback for keyword generation
  MISTRAL: "mistralai/Mistral-7B-Instruct-v0.3",
  // For zero-shot classification (verification)
  BART_MNLI: "facebook/bart-large-mnli",
} as const;

// Rate limiting
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 500; // ms

export async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
    );
  }

  lastRequestTime = Date.now();
  return fn();
}

// Retry with exponential backoff
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await withRateLimit(fn);
    } catch (error) {
      lastError = error as Error;
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("rate limit") || error.message.includes("429"));

      if (isRateLimit) {
        const delay = baseDelay * Math.pow(2, i);
        console.log(`Rate limited, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }

  throw lastError;
}
