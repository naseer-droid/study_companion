import { NextResponse } from "next/server";
import { askModel, errorMessage } from "@/lib/llm";
import { askPrompt } from "@/lib/prompts";
import { askSchema } from "@/lib/schemas";

// LLM round-trips can take 30-60s; be explicit about the budget on Vercel.
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { topic, memory, question } = await req.json();
    if (typeof topic !== "string" || typeof question !== "string" || !question.trim()) {
      return NextResponse.json({ error: "Missing topic or question." }, { status: 400 });
    }
    const raw = await askModel(askPrompt(topic, typeof memory === "string" ? memory : "", question.trim()));
    const parsed = askSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Couldn't get a readable answer just now - try again." },
        { status: 502 }
      );
    }
    return NextResponse.json(parsed.data);
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 502 });
  }
}
