import { z } from "zod";

// The model sometimes returns a resource type outside the enum; coerce unknown
// values to "website" rather than failing the whole response.
const resourceType = z
  .string()
  .transform((t) =>
    ["book", "course", "website", "video", "practice"].includes(t) ? t : "website"
  );

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

export type TopicSetupResponse = z.infer<typeof topicSetupSchema>;
export type JournalResponse = z.infer<typeof journalSchema>;
export type AskResponse = z.infer<typeof askSchema>;
