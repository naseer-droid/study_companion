import { NextResponse } from "next/server";
import { askModelText, errorMessage } from "@/lib/llm";
import { organizePrompt, type OrganizeAction } from "@/lib/prompts";
import { getRequestStorage } from "@/lib/storage";
import { looksLikeHtml } from "@/lib/types";
import { htmlToMarkdown } from "@/lib/extract";

// Reader "organize with AI": tidy / summarize / simplify / fix a whole article,
// or rewrite / explain a highlighted selection. Returns Markdown WITHOUT saving
// — the reader previews it and the learner accepts (→ /api/library/edit) or
// discards. Article-only; books stream and videos are transcripts.
export const maxDuration = 180;

const WHOLE_DOC_ACTIONS: OrganizeAction[] = ["tidy", "summarize", "simplify", "fixFormatting"];
const SELECTION_ACTIONS: OrganizeAction[] = ["rewrite", "explain"];
const DOC_BUDGET = 16_000; // chars of article Markdown sent to the model
const SEL_BUDGET = 4_000; // chars of a highlighted passage

// Models sometimes wrap the whole answer in a ```markdown fence despite being
// asked not to — peel a single outer fence so the preview isn't literal ```.
function stripOuterFence(md: string): string {
  const t = md.trim();
  const m = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  return (m ? m[1] : t).trim();
}

export async function POST(req: Request) {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { itemId, action, selection } = await req.json();
    if (typeof itemId !== "string" || !itemId) {
      return NextResponse.json({ error: "Missing item." }, { status: 400 });
    }
    const act = action as OrganizeAction;
    const isSelection = SELECTION_ACTIONS.includes(act);
    if (!WHOLE_DOC_ACTIONS.includes(act) && !isSelection) {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    const data = await ctx.storage.load(ctx.userId);
    const item = data.topics.flatMap((t) => t.library).find((i) => i.id === itemId);
    if (!item) return NextResponse.json({ error: "Couldn't find that item." }, { status: 404 });
    if (item.kind !== "article") {
      return NextResponse.json({ error: "Only articles can be organized." }, { status: 400 });
    }

    let text: string;
    if (isSelection) {
      if (typeof selection !== "string" || !selection.trim()) {
        return NextResponse.json({ error: "Select some text first." }, { status: 400 });
      }
      text = selection.trim().slice(0, SEL_BUDGET);
    } else {
      const raw = await ctx.storage.getLibraryContent(ctx.userId, itemId);
      if (!raw.trim()) {
        return NextResponse.json({ error: "There's no text to organize yet." }, { status: 400 });
      }
      const md = looksLikeHtml(raw) ? await htmlToMarkdown(raw) : raw;
      text = md.slice(0, DOC_BUDGET);
    }

    const out = await askModelText(organizePrompt(act, item.title, text), 8_000);
    const markdown = stripOuterFence(out);
    if (!markdown) {
      return NextResponse.json({ error: "The model returned nothing — try again." }, { status: 502 });
    }
    return NextResponse.json({ markdown });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 502 });
  }
}
