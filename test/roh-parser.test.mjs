import test from "node:test";
import assert from "node:assert/strict";
import { formatInterval, parseRohIntervals } from "../lib/roh-parser.js";

test("extracts ROH intervals from the sample report excerpt and ignores the 7q deletion", () => {
  const excerpt = `
119 KB INTERSTITIAL DELETION OF 7Q11.22->Q11.22;
LONG CONTIGUOUS REGIONS OF HOMOZYGOSITY IN MULTIPLE CHROMOSOMES
. arr[hg19] 7q11.22(69,478,506-69,597,073)x1

ROH Bp linear position:
  chr2:204991426-224932239
  chr3:127055920-131374290.
  chr4:132600769-145625951.
  chr5:28720094-42918025.
  chr5:57287088-68826246.
  chr7:106793175-127158405.
  chr10:11210860-25581379.
  chr11:22135371-40746664.
  chr11:60804710-69393671.
  chr11:12916233-18285205.
  chr12:37857751-50183996.
  chr12:23796727-34835837.
  chr16:46464489-62417538.
  chr16:26157995-35220544.
  chr20:61795-5353005.
  chr21:37131502-41351577
Total: 188.22 Mb
`;

  const result = parseRohIntervals(excerpt);
  assert.equal(result.intervals.length, 16);
  assert.equal(formatInterval(result.intervals[0]), "chr2:204991426-224932239");
  assert.equal(result.intervals.some((interval) => interval.start === 69478506), false);
  assert.doesNotMatch(result.warnings.join("\n"), /7Q/);
});

test("supports comma-separated positions, spaces, en dashes, and missing chr prefix", () => {
  const result = parseRohIntervals(`
ROH Bp linear position:
2:204,991,426 – 224,932,239
chr 3: 127,055,920 - 131,374,290
4 132600769 145625951
`);

  assert.deepEqual(result.intervals, [
    { chromosome: "chr2", start: 204991426, end: 224932239 },
    { chromosome: "chr3", start: 127055920, end: 131374290 },
    { chromosome: "chr4", start: 132600769, end: 145625951 }
  ]);
});

test("supports chrX ROH intervals", () => {
  const result = parseRohIntervals(`
ROH Bp linear position:
chrX:1,000-2,000
X 3000 4000
`);

  assert.deepEqual(result.intervals, [
    { chromosome: "chrX", start: 1000, end: 2000 },
    { chromosome: "chrX", start: 3000, end: 4000 }
  ]);
});

test("ignores unsupported, duplicate, reversed, and copy-number intervals with warnings", () => {
  const result = parseRohIntervals(`
ROH Bp linear position:
chrY:1000-2000
chr2:3000-2000
chr2:1000-2000
chr2:1000-2000
arr[hg19] chr3:1000-2000x1 deletion
`);

  assert.deepEqual(result.intervals, [{ chromosome: "chr2", start: 1000, end: 2000 }]);
  assert.match(result.warnings.join("\n"), /unsupported/i);
  assert.match(result.warnings.join("\n"), /reversed/i);
  assert.match(result.warnings.join("\n"), /duplicate/i);
});

test("parses standalone coordinate lists with a caution when no ROH heading is present", () => {
  const result = parseRohIntervals("chr2:1000-2000\nchr3:3000-4000");
  assert.equal(result.intervals.length, 2);
  assert.match(result.warnings.join("\n"), /No explicit ROH\/AOH heading/i);
});
