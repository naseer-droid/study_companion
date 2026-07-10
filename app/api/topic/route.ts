import { NextResponse } from "next/server";
import { askModel, errorMessage } from "@/lib/llm";
import { topicSetupPrompt } from "@/lib/prompts";
import { topicSetupSchema } from "@/lib/schemas";

export async function POST(req: Request) {
  try {
    const { topic } = await req.json();
    if (typeof topic !== "string" || !topic.trim()) {
      return NextResponse.json({ error: "Please name a topic." }, { status: 400 });
    }
    const raw = await askModel(topicSetupPrompt(topic.trim()));
    const parsed = topicSetupSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "The companion's plan came back malformed. Please try again." },
        { status: 502 }
      );
    }
    return NextResponse.json(parsed.data);
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 502 });
  }
}
