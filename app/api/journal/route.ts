import { NextResponse } from "next/server";
import { askModel, errorMessage } from "@/lib/llm";
import { journalPrompt } from "@/lib/prompts";
import { journalSchema } from "@/lib/schemas";

export async function POST(req: Request) {
  try {
    const { topic, memory, entry } = await req.json();
    if (typeof topic !== "string" || typeof entry !== "string" || !entry.trim()) {
      return NextResponse.json({ error: "Missing topic or entry." }, { status: 400 });
    }
    const raw = await askModel(journalPrompt(topic, typeof memory === "string" ? memory : "", entry.trim()));
    const parsed = journalSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "The companion couldn't respond just now. Your note wasn't lost - try sending it again." },
        { status: 502 }
      );
    }
    return NextResponse.json(parsed.data);
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 502 });
  }
}
