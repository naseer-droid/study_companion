import { z } from "zod";

// The model sometimes returns a resource type outside the enum; coerce unknown
// values to "website" rather than failing the whole response.
const resourceType = z
  .string()
  .transform((t) =>
    ["book", "course", "website", "video", "practice"].includes(t) ? t : "website"
  );

// Models hallucinate URLs; keep one only when it at least parses as http(s).
const resourceUrl = z
  .string()
  .optional()
  .transform((u) => {
    if (!u) return undefined;
    try {
      const parsed = new URL(u);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? u : undefined;
    } catch {
      return undefined;
    }
  });

export const topicSetupSchema = z.object({
  brief: z.string(),
  whyItMatters: z.string().default(""),
  roadmap: z
    .array(z.object({ title: z.string(), desc: z.string().default("") }))
    .min(1),
  resources: z
    .array(
      z.object({
        title: z.string(),
        type: resourceType,
        why: z.string().default(""),
        url: resourceUrl,
      })
    )
    .default([]),
  firstStep: z.string().default(""),
});

export const journalSchema = z.object({
  reply: z.string(),
  updatedMemory: z.string(),
  nextSuggestion: z.string().default(""),
});

export const askSchema = z.object({
  answer: z.string(),
  updatedMemory: z.string(),
  followUp: z.string().default(""),
});

// --- Study Room (v3.0) ---
export const discussSchema = z.object({
  reply: z.string(),
  updatedMemory: z.string(),
});

export const greetingSchema = z.object({
  greeting: z.string(),
});

// --- v3.3 Living Companion ---
export const quizQuestionSchema = z.object({
  question: z.string(),
});

export const quizFeedbackSchema = z.object({
  feedback: z.string(),
  updatedMemory: z.string(),
});

export const progressSchema = z.object({
  completedStageIds: z.array(z.number()).default([]),
});

export type TopicSetupResponse = z.infer<typeof topicSetupSchema>;
export type JournalResponse = z.infer<typeof journalSchema>;
export type AskResponse = z.infer<typeof askSchema>;
export type DiscussResponse = z.infer<typeof discussSchema>;
export type GreetingResponse = z.infer<typeof greetingSchema>;
export type QuizQuestionResponse = z.infer<typeof quizQuestionSchema>;
export type QuizFeedbackResponse = z.infer<typeof quizFeedbackSchema>;
export type ProgressResponse = z.infer<typeof progressSchema>;
