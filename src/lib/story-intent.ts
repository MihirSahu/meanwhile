import { z } from "zod";

export const storyOptionSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    period: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(180),
    prompt: z.string().trim().min(3).max(500),
  })
  .strict();

export const storyIntentSchema = z
  .object({
    result: z.discriminatedUnion("status", [
      z.object({ status: z.literal("resolved") }).strict(),
      z
        .object({
          status: z.literal("clarification"),
          question: z.string().trim().min(1).max(240),
          options: z.array(storyOptionSchema).min(2).max(4),
        })
        .strict(),
    ]),
  })
  .strict();

export type StoryClarification = Extract<
  z.infer<typeof storyIntentSchema>["result"],
  { status: "clarification" }
>;
