const SUPPORTED_CHROMOSOME_PATTERN = /^(?:chr)?([1-9]|1[0-9]|2[0-2]|x)$/i;
const CHROM_PATTERN = /(?:chr(?:omosome)?\s*)?([0-9]{1,2}|x|y|m|mt)/i;
const RANGE_WITH_COLON_PATTERN =
  /(?:chr(?:omosome)?\s*)?([0-9]{1,2}|x|y|m|mt)\s*:\s*([0-9][0-9,\s]*)\s*[-–—]\s*([0-9][0-9,\s]*)/gi;
const RANGE_WITH_SPACES_PATTERN =
  /(?:chr(?:omosome)?\s*)?([0-9]{1,2}|x|y|m|mt)\s+([0-9][0-9,]{3,})\s+([0-9][0-9,]{3,})/gi;
const ARRAY_CYTOBAND_RANGE_PATTERN =
  /(?:\barr(?:\[[^\]]+\])?\s*)?(?:chr(?:omosome)?\s*)?([0-9]{1,2}|x|y|m|mt)\s*[pq][0-9a-z.]*\s*\(\s*([0-9][0-9,\s]*)\s*[-–—_]\s*([0-9][0-9,\s]*)\s*\)/gi;

const ROH_HEADING_PATTERN =
  /\b(roh|aoh|lcsh|absence\s+of\s+heterozygosity|loss\s+of\s+heterozygosity|regions?\s+of\s+(allele\s+)?homozygosity|areas?\s+of\s+homozygosity|runs?\s+of\s+homozygosity|contiguous\s+(regions?|stretches?)\s+of\s+homozygosity|homozygous\s+regions?)\b/i;
const ROH_COORD_HEADING_PATTERN = /\b(roh|aoh)\b.*\b(bp|base|linear|position|coordinate|interval|region)/i;
const TERMINATOR_PATTERN =
  /^\s*(total|reference|references|methodology|method|limitations?|positive evaluation|snp chromosomal|interpretation|comment)\b/i;
const HOMOZYGOSITY_MARKER_PATTERN =
  /\b(aoh|roh|lcsh|hmz|hom(?:ozygous|ozygosity)?|absence\s+of\s+heterozygosity|loss\s+of\s+heterozygosity|loh)\b/i;
const COPY_NUMBER_EVENT_PATTERN =
  /\b(copy\s+number\s+(gain|loss)|deletion|duplication|amplification|interstitial\s+deletion)\b/i;
const COPY_NUMBER_MULTIPLIER_PATTERN = /(?:\)|[0-9])\s*x\s*([0-9]+)\b/i;
const GENERIC_GAIN_LOSS_PATTERN = /\b(gain|loss)\b/i;
const COPY_NEUTRAL_LOSS_PATTERN = /\b(loss\s+of\s+heterozygosity|loh|copy[-\s]*neutral)\b/i;

export function parseRohIntervals(reportText) {
  const warnings = [];
  const rawText = typeof reportText === "string" ? reportText : "";
  const normalizedText = rawText.replace(/\r\n?/g, "\n").replace(/[−‒]/g, "-");
  const lines = normalizedText.split("\n");
  const hasExplicitRohContext = ROH_HEADING_PATTERN.test(normalizedText);
  const seen = new Set();
  const intervals = [];
  let inRohBlock = false;
  let parsedFromRohBlock = 0;
  let sawExplicitHeading = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const isRohLine = ROH_HEADING_PATTERN.test(line) || ROH_COORD_HEADING_PATTERN.test(line);

    if (isRohLine) {
      inRohBlock = true;
      sawExplicitHeading = true;
    }

    if (inRohBlock && parsedFromRohBlock > 0 && TERMINATOR_PATTERN.test(line)) {
      inRohBlock = false;
    }

    const shouldParseLine =
      inRohBlock ||
      (!hasExplicitRohContext && (looksLikeStandaloneCoordinateLine(line) || looksLikeStandaloneRohArrayLine(line)));
    if (!shouldParseLine || isCopyNumberEventLine(line)) {
      continue;
    }

    const extracted = extractIntervalsFromLine(line);
    if (extracted.length === 0) {
      if (inRohBlock && looksCoordinateLikeButUnparsed(line)) {
        warnings.push(`Could not parse possible ROH coordinate line: "${truncate(line)}"`);
      }
      continue;
    }

    for (const candidate of extracted) {
      const accepted = normalizeCandidate(candidate, warnings);
      if (!accepted) continue;
      const key = `${accepted.chromosome}:${accepted.start}-${accepted.end}`;
      if (seen.has(key)) {
        warnings.push(`Ignored duplicate interval ${key}.`);
        continue;
      }
      seen.add(key);
      intervals.push(accepted);
      if (inRohBlock) parsedFromRohBlock += 1;
    }
  }

  if (!sawExplicitHeading && intervals.length > 0) {
    warnings.push("No explicit ROH/AOH heading was found; parsed standalone coordinate lines as candidate ROH intervals.");
  }

  if (intervals.length === 0) {
    warnings.push("No hg19 ROH intervals on chromosomes 1-22 or X were detected in the pasted text.");
  }

  return { intervals, warnings };
}

export function formatInterval(interval) {
  return `${interval.chromosome}:${interval.start}-${interval.end}`;
}

function extractIntervalsFromLine(line) {
  const candidates = [];
  RANGE_WITH_COLON_PATTERN.lastIndex = 0;
  RANGE_WITH_SPACES_PATTERN.lastIndex = 0;
  ARRAY_CYTOBAND_RANGE_PATTERN.lastIndex = 0;
  const colonMatches = [...line.matchAll(RANGE_WITH_COLON_PATTERN)];
  for (const match of colonMatches) {
    candidates.push({ chromosome: match[1], start: match[2], end: match[3] });
  }

  if (candidates.length === 0) {
    const spacedMatches = [...line.matchAll(RANGE_WITH_SPACES_PATTERN)];
    for (const match of spacedMatches) {
      candidates.push({ chromosome: match[1], start: match[2], end: match[3] });
    }
  }

  if (candidates.length === 0) {
    const arrayMatches = [...line.matchAll(ARRAY_CYTOBAND_RANGE_PATTERN)];
    for (const match of arrayMatches) {
      candidates.push({ chromosome: match[1], start: match[2], end: match[3] });
    }
  }

  return candidates;
}

function normalizeCandidate(candidate, warnings) {
  const chromosomeMatch = String(candidate.chromosome).trim().match(SUPPORTED_CHROMOSOME_PATTERN);
  if (!chromosomeMatch) {
    warnings.push(`Ignored unsupported interval on chromosome ${candidate.chromosome}; only chromosomes 1-22 and X are analyzed.`);
    return null;
  }
  const chromosome = normalizeChromosome(chromosomeMatch[1]);

  const start = parsePosition(candidate.start);
  const end = parsePosition(candidate.end);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < 1) {
    warnings.push(`Ignored malformed interval ${chromosome}:${candidate.start}-${candidate.end}.`);
    return null;
  }

  if (start > end) {
    warnings.push(`Ignored reversed interval ${chromosome}:${start}-${end}.`);
    return null;
  }

  return {
    chromosome,
    start,
    end
  };
}

function normalizeChromosome(value) {
  const chromosome = String(value).trim().toUpperCase();
  return chromosome === "X" ? "chrX" : `chr${chromosome}`;
}

function parsePosition(value) {
  const normalized = String(value).replace(/[,\s]/g, "");
  if (!/^\d+$/.test(normalized)) return Number.NaN;
  return Number.parseInt(normalized, 10);
}

function looksLikeStandaloneCoordinateLine(line) {
  if (!line || isCopyNumberEventLine(line)) return false;
  return RANGE_WITH_COLON_PATTERN.test(resetGlobalRegexInput(line)) || RANGE_WITH_SPACES_PATTERN.test(resetGlobalRegexInput(line));
}

function looksLikeStandaloneRohArrayLine(line) {
  if (!line || isCopyNumberEventLine(line) || !HOMOZYGOSITY_MARKER_PATTERN.test(line)) return false;
  return ARRAY_CYTOBAND_RANGE_PATTERN.test(resetGlobalRegexInput(line));
}

function looksCoordinateLikeButUnparsed(line) {
  CHROM_PATTERN.lastIndex = 0;
  return (
    /(?:chr(?:omosome)?\s*)?(?:[0-9]{1,2}|x|y|m|mt)\s*:\s*[0-9]/i.test(line) ||
    /(?:chr(?:omosome)?\s*)?(?:[0-9]{1,2}|x|y|m|mt)\s+[0-9][0-9,]{3,}/i.test(line) ||
    /(?:\barr(?:\[[^\]]+\])?\s*)?(?:chr(?:omosome)?\s*)?(?:[0-9]{1,2}|x|y|m|mt)\s*[pq][0-9a-z.]*\s*\(\s*[0-9]/i.test(
      line
    )
  );
}

function isCopyNumberEventLine(line) {
  const copyNumberMatch = line.match(COPY_NUMBER_MULTIPLIER_PATTERN);
  if ((copyNumberMatch && Number.parseInt(copyNumberMatch[1], 10) !== 2) || COPY_NUMBER_EVENT_PATTERN.test(line)) return true;
  return GENERIC_GAIN_LOSS_PATTERN.test(line) && !COPY_NEUTRAL_LOSS_PATTERN.test(line);
}

function resetGlobalRegexInput(value) {
  RANGE_WITH_COLON_PATTERN.lastIndex = 0;
  RANGE_WITH_SPACES_PATTERN.lastIndex = 0;
  ARRAY_CYTOBAND_RANGE_PATTERN.lastIndex = 0;
  return value;
}

function truncate(value) {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}
