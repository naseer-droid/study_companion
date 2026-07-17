import { NextResponse } from "next/server";
import { askModel, errorMessage } from "@/lib/llm";
import { greetingPrompt } from "@/lib/prompts";
import { greetingSchema } from "@/lib/schemas";
import { getRequestStorage } from "@/lib/storage";

// Session greeting: one short continuity note per topic-open. Non-blocking
// for the UI; failures are silent on the client (the strip just stays hidden).
export const maxDuration = 60;

export async function POST(req: Request) {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { topicId } = await req.json();
    if (typeof topicId !== "string" || !topicId) {
      return NextResponse.json({ error: "Missing topicId." }, { status: 400 });
    }

    const data = await ctx.storage.load(ctx.userId);
    const topic = data.topics.find((t) => t.id === topicId);
    if (!topic) return NextResponse.json({ error: "Couldn't find that topic." }, { status: 404 });

    const lastActivity = [
      ...topic.journal.map((e) => e.date),
      ...topic.qa.map((q) => q.date),
      ...topic.library.map((i) => i.addedAt),
      ...topic.library.flatMap((i) => i.discussion.map((m) => m.date)),
    ]
      .sort()
      .pop();

    const raw = await askModel(
      greetingPrompt(
        topic.name,
        topic.memory,
        topic.nextSuggestion,
        topic.roadmap,
        lastActivity
          ? new Date(lastActivity).toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          : "this is the first session"
      )
    );
    const parsed = greetingSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "No greeting right now." }, { status: 502 });
    }
    return NextResponse.json(parsed.data);
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 502 });
  }
}
