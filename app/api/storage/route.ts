import { NextResponse } from "next/server";
import { getRequestStorage } from "@/lib/storage";
import type { AppData, JournalEntry, LibraryItem, QAItem, RoadmapStage, Topic } from "@/lib/types";

export async function GET() {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const data = await ctx.storage.load(ctx.userId);
  return NextResponse.json(data);
}

// Mutations arrive as { op, ...payload }. Per-entity ops (not a blob PUT) so
// concurrent devices append rather than overwrite each other.
export async function POST(req: Request) {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { storage, userId } = ctx;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    switch (body.op) {
      case "createTopic": {
        const topic = body.topic as Omit<Topic, "id"> | undefined;
        if (!topic || typeof topic.name !== "string" || !Array.isArray(topic.roadmap)) {
          return NextResponse.json({ error: "Invalid topic." }, { status: 400 });
        }
        const created = await storage.createTopic(userId, topic);
        return NextResponse.json({ topic: created });
      }
      case "deleteTopic": {
        if (typeof body.topicId !== "string") {
          return NextResponse.json({ error: "Missing topicId." }, { status: 400 });
        }
        await storage.deleteTopic(userId, body.topicId);
        return NextResponse.json({ ok: true });
      }
      case "addJournalEntry": {
        const entry = body.entry as JournalEntry | undefined;
        if (typeof body.topicId !== "string" || !entry || typeof entry.userNote !== "string") {
          return NextResponse.json({ error: "Invalid entry." }, { status: 400 });
        }
        await storage.addJournalEntry(
          userId,
          body.topicId,
          entry,
          typeof body.memory === "string" ? body.memory : "",
          typeof body.nextSuggestion === "string" ? body.nextSuggestion : ""
        );
        return NextResponse.json({ ok: true });
      }
      case "addQA": {
        const item = body.item as QAItem | undefined;
        if (typeof body.topicId !== "string" || !item || typeof item.q !== "string") {
          return NextResponse.json({ error: "Invalid question." }, { status: 400 });
        }
        await storage.addQA(
          userId,
          body.topicId,
          item,
          typeof body.memory === "string" ? body.memory : ""
        );
        return NextResponse.json({ ok: true });
      }
      case "updateRoadmap": {
        if (typeof body.topicId !== "string" || !Array.isArray(body.roadmap)) {
          return NextResponse.json({ error: "Invalid roadmap." }, { status: 400 });
        }
        await storage.updateRoadmap(userId, body.topicId, body.roadmap as RoadmapStage[]);
        return NextResponse.json({ ok: true });
      }
      case "updateLibraryStatus": {
        const status = body.status;
        if (
          typeof body.itemId !== "string" ||
          typeof status !== "string" ||
          !["unread", "reading", "done"].includes(status)
        ) {
          return NextResponse.json({ error: "Invalid library status." }, { status: 400 });
        }
        await storage.updateLibraryStatus(userId, body.itemId, status as LibraryItem["status"]);
        return NextResponse.json({ ok: true });
      }
      case "deleteLibraryItem": {
        if (typeof body.itemId !== "string") {
          return NextResponse.json({ error: "Missing itemId." }, { status: 400 });
        }
        await storage.deleteLibraryItem(userId, body.itemId);
        return NextResponse.json({ ok: true });
      }
      case "import": {
        const data = body.data as AppData | undefined;
        if (!data || !Array.isArray(data.topics)) {
          return NextResponse.json({ error: "Invalid data shape." }, { status: 400 });
        }
        await storage.importData(userId, data);
        return NextResponse.json({ ok: true, imported: data.topics.length });
      }
      default:
        return NextResponse.json({ error: "Unknown operation." }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
