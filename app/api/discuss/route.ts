import { NextResponse } from "next/server";
import { askModel, errorMessage } from "@/lib/llm";
import { discussPrompt } from "@/lib/prompts";
import { discussSchema } from "@/lib/schemas";
import { getRequestStorage } from "@/lib/storage";
import type { DiscussionMsg } from "@/lib/types";

// Discuss a library item with the companion. Needs storage (item content +
// memory + persistence), so unlike /api/ask this route is authed directly.
export const maxDuration = 180;

const CONTENT_BUDGET = 20_000; // chars of article text / transcript sent to the model
const RECENT_TURNS = 10;

export async function POST(req: Request) {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { topicId, itemId, message } = await req.json();
    if (
      typeof topicId !== "string" ||
      typeof itemId !== "string" ||
      typeof message !== "string" ||
      !message.trim()
    ) {
      return NextResponse.json({ error: "Missing topic, item, or message." }, { status: 400 });
    }

    const data = await ctx.storage.load(ctx.userId);
    const topic = data.topics.find((t) => t.id === topicId);
    const item = topic?.library.find((i) => i.id === itemId);
    if (!topic || !item) {
      return NextResponse.json({ error: "Couldn't find that library item." }, { status: 404 });
    }

    const content = item.hasContent
      ? (await ctx.storage.getLibraryContent(ctx.userId, itemId)).slice(0, CONTENT_BUDGET)
      : "";
    const recent = item.discussion
      .slice(-RECENT_TURNS)
      .map((m) => ({ role: m.role, text: m.text }));

    const raw = await askModel(
      discussPrompt(topic.name, topic.memory, item.title, item.kind, content, recent, message.trim())
    );
    const parsed = discussSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Couldn't get a readable reply just now - try again." },
        { status: 502 }
      );
    }

    const now = new Date().toISOString();
    const userMsg: DiscussionMsg = { date: now, role: "user", text: message.trim() };
    const companionMsg: DiscussionMsg = { date: now, role: "companion", text: parsed.data.reply };
    const memory = parsed.data.updatedMemory || topic.memory;
    await ctx.storage.addDiscussion(ctx.userId, topicId, itemId, userMsg, companionMsg, memory);

    return NextResponse.json({ userMsg, companionMsg, memory });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 502 });
  }
}
