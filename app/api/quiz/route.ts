import { NextResponse } from "next/server";
import { askModel, errorMessage } from "@/lib/llm";
import { quizPrompt, quizFeedbackPrompt } from "@/lib/prompts";
import { quizQuestionSchema, quizFeedbackSchema } from "@/lib/schemas";
import { getRequestStorage } from "@/lib/storage";

// Teach-back quiz (v3.3): mode "question" asks the companion to pose one
// teach-back question; mode "answer" grades it warmly and rewrites memory.
// The client persists the exchange as an ordinary journal entry, so quiz
// results feed shared memory through the existing storage op.
export const maxDuration = 60;

export async function POST(req: Request) {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const body = await req.json();
    const { topicId, mode } = body;
    if (typeof topicId !== "string" || !topicId) {
      return NextResponse.json({ error: "Missing topicId." }, { status: 400 });
    }

    const data = await ctx.storage.load(ctx.userId);
    const topic = data.topics.find((t) => t.id === topicId);
    if (!topic) return NextResponse.json({ error: "Couldn't find that topic." }, { status: 404 });

    if (mode === "question") {
      const seedNote = typeof body.seedNote === "string" ? body.seedNote : undefined;
      const raw = await askModel(quizPrompt(topic.name, topic.memory, seedNote));
      const parsed = quizQuestionSchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json({ error: "The companion couldn't think of a question just now." }, { status: 502 });
      }
      return NextResponse.json(parsed.data);
    }

    if (mode === "answer") {
      const { question, answer } = body;
      if (typeof question !== "string" || !question || typeof answer !== "string" || !answer) {
        return NextResponse.json({ error: "Missing question or answer." }, { status: 400 });
      }
      const raw = await askModel(quizFeedbackPrompt(topic.name, topic.memory, question, answer));
      const parsed = quizFeedbackSchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json({ error: "The companion couldn't respond just now." }, { status: 502 });
      }
      return NextResponse.json(parsed.data);
    }

    return NextResponse.json({ error: "Unknown mode." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 502 });
  }
}
