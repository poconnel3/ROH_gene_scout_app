import { NextResponse } from "next/server";
import { analyzeIntervalsWithPublicAnnotations } from "../../../lib/recessive-annotations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INTERVALS = 100;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const intervals = Array.isArray(body?.intervals) ? body.intervals : [];
  const validation = validateIntervals(intervals);
  if (validation.error) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const result = await analyzeIntervalsWithPublicAnnotations(validation.intervals);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Public annotation lookup failed. Ensembl GRCh37 or HPO annotations may be temporarily unavailable.",
        code: "PUBLIC_ANNOTATION_LOOKUP_FAILED",
        status: error.status || 502
      },
      { status: 502 }
    );
  }
}

function validateIntervals(intervals) {
  if (intervals.length === 0) {
    return { error: "At least one interval is required." };
  }

  if (intervals.length > MAX_INTERVALS) {
    return { error: `A maximum of ${MAX_INTERVALS} intervals can be analyzed at once.` };
  }

  const normalized = [];
  for (const interval of intervals) {
    const chromosomeInput = String(interval?.chromosome || "").trim();
    const chromosomeMatch = chromosomeInput.match(/^chr([1-9]|1[0-9]|2[0-2]|x)$/i);
    const start = Number(interval?.start);
    const end = Number(interval?.end);

    if (!chromosomeMatch) {
      return { error: `Invalid chromosome: ${chromosomeInput || "missing"}. Only chr1-chr22 and chrX are supported.` };
    }
    const chromosome = chromosomeMatch[1].toLowerCase() === "x" ? "chrX" : `chr${chromosomeMatch[1]}`;

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
      return { error: `Invalid interval coordinates for ${chromosome}.` };
    }

    normalized.push({ chromosome, start, end });
  }

  return { intervals: normalized };
}
