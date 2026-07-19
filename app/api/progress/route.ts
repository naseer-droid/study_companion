import { NextResponse } from "next/server";
import { askModel, errorMessage } from "@/lib/llm";
import { progressPrompt } from "@/lib/prompts";
import { progressSchema } from "@/lib/schemas";
import { getRequestStorage } from "@/lib/storage";

// Roadmap progress check (v3.3): after a journal entry saves, the client fires
// this non-blocking to ask whether the entry shows any not-yet-done stage is
// complete. Returns suggestions only — the learner confirms in the UI; the app
// never silently marks stages. Failures are silent on the client.
export const maxDuration = 60;

export async function POST(req: Request) {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { topicId, entryText } = await req.json();
    if (typeof topicId !== "string" || !topicId || typeof entryText !== "string" || !entryText) {
      return NextResponse.json({ error: "Missing topicId or entryText." }, { status: 400 });
    }

    const data = await ctx.storage.load(ctx.userId);
    const topic = data.topics.find((t) => t.id === topicId);
    if (!topic) return NextResponse.json({ error: "Couldn't find that topic." }, { status: 404 });

    const open = topic.roadmap.filter((s) => !s.done);
    if (!open.length) return NextResponse.json({ completedStageIds: [] });

    const raw = await askModel(progressPrompt(topic.name, topic.roadmap, entryText));
    const parsed = progressSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ completedStageIds: [] });

    // Only ids that are real, still-open stages.
    const openIds = new Set(open.map((s) => s.id));
    return NextResponse.json({
      completedStageIds: parsed.data.completedStageIds.filter((id) => openIds.has(id)),
    });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 502 });
  }
}
