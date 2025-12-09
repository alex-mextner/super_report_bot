import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";
const isTest = process.env.NODE_ENV === "test";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? "error" : isDev ? "debug" : "info"),
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      }
    : undefined,
});

// Child loggers for different components
export const listenerLog = logger.child({ component: "listener" });
export const matcherLog = logger.child({ component: "matcher" });
export const llmLog = logger.child({ component: "llm" });
export const botLog = logger.child({ component: "bot" });
export const apiLog = logger.child({ component: "api" });
