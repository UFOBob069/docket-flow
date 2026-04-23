import { NextResponse } from "next/server";
import mammoth from "mammoth";
import OpenAI from "openai";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  buf: Buffer
) => Promise<{ text: string }>;
import { buildDeadlineSystemPrompt } from "@/lib/llm-prompt";
import type { ExtractedDeadline } from "@/lib/types";
import { getUserFromBearer } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
export const maxDuration = 120;

async function bufferFromRequest(req: Request): Promise<{
  buffer: Buffer;
  name: string;
  mime: string;
}> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new Error("Missing file field");
    }
    const ab = await file.arrayBuffer();
    return {
      buffer: Buffer.from(ab),
      name: file.name || "document",
      mime: file.type || "application/octet-stream",
    };
  }
  const body = (await req.json()) as { base64?: string; name?: string; mime?: string };
  if (!body.base64) throw new Error("Expected multipart file or JSON base64");
  return {
    buffer: Buffer.from(body.base64, "base64"),
    name: body.name ?? "document",
    mime: body.mime ?? "application/pdf",
  };
}

async function extractText(buffer: Buffer, mime: string, name: string): Promise<string> {
  const lower = name.toLowerCase();
  if (
    mime.includes("wordprocessing") ||
    mime.includes("officedocument") ||
    lower.endsWith(".docx")
  ) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  const data = await pdfParse(buffer);
  return data.text;
}

function parseDeadlinesJson(raw: string): ExtractedDeadline[] {
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*$/gi, "").trim();
  const parsed = JSON.parse(cleaned) as { deadlines?: ExtractedDeadline[] };
  if (!Array.isArray(parsed.deadlines)) {
    throw new Error("LLM returned invalid shape");
  }
  return parsed.deadlines;
}

export async function POST(req: Request): Promise<Response> {
  const session = await getUserFromBearer(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  try {
    const { buffer, name, mime } = await bufferFromRequest(req);
    const text = await extractText(buffer, mime, name);
    if (!text.trim()) {
      return NextResponse.json(
        { error: "No text could be extracted from the document" },
        { status: 400 }
      );
    }

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [
        { role: "system", content: buildDeadlineSystemPrompt() },
        {
          role: "user",
          content: text.slice(0, 120_000),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const deadlines = parseDeadlinesJson(raw);
    return NextResponse.json({ deadlines, sourceFileName: name });
  } catch (e) {
    console.error("[/api/extract] Error:", e);
    const message = e instanceof Error ? e.message : "Extract failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
