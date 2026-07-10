import { NextResponse } from "next/server";
import { storage } from "@/lib/storage";

export async function GET() {
  const data = await storage.load();
  return NextResponse.json(data);
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    if (!body || !Array.isArray(body.topics)) {
      return NextResponse.json({ error: "Invalid data shape." }, { status: 400 });
    }
    await storage.save(body);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }
}
