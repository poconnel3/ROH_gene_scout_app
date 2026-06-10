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

test("extracts AOH intervals from array cytoband table rows", () => {
  const result = parseRohIntervals(`
AOH Region [hg19]                               Size (bp)
.        No. of Gene
.        arr 1p31.1(75,592,228-82,395,691)x2 hmz         6,803,464  72
.        arr 2q11.2q14.1(101,877,339-116,330,802)x2 hmz  14,453,464
.        195
.        arr 3p14.1(64,352,801-68,463,132)x2 hmz         4,110,332  23
.        arr 4p13p12(41,672,599-48,036,737)x2 hmz        6,364,139  53
.        arr 6q21q22.31(106,949,394-120,108,162)x2 hmz   13,158,769
.        169
.        arr 7p22.1p21.3(4,593,407-13,683,216)x2 hmz     9,089,810
.        106
.        arr 7q31.2q31.31(114,786,932-120,722,820)x2 hmz 5,935,889  39
.        arr 8q13.2q13.3(68,389,968-72,636,606)x2 hmz    4,246,639  46
.        arr 9q33.2q34.12(124,633,018-133,939,646)x2 hmz 9,306,629
.        199
.        arr 12q21.31q21.33(85,766,847-89,481,885)x2 hmz 3,715,039  20
.        arr 20p13p12.2(4,614,979-10,167,541)x2 hmz      5,552,563  56
`);

  assert.deepEqual(result.intervals, [
    { chromosome: "chr1", start: 75592228, end: 82395691 },
    { chromosome: "chr2", start: 101877339, end: 116330802 },
    { chromosome: "chr3", start: 64352801, end: 68463132 },
    { chromosome: "chr4", start: 41672599, end: 48036737 },
    { chromosome: "chr6", start: 106949394, end: 120108162 },
    { chromosome: "chr7", start: 4593407, end: 13683216 },
    { chromosome: "chr7", start: 114786932, end: 120722820 },
    { chromosome: "chr8", start: 68389968, end: 72636606 },
    { chromosome: "chr9", start: 124633018, end: 133939646 },
    { chromosome: "chr12", start: 85766847, end: 89481885 },
    { chromosome: "chr20", start: 4614979, end: 10167541 }
  ]);
  assert.equal(result.warnings.length, 0);
});

test("supports expanded AOH terminology and standalone hmz array rows while rejecting CNVs", () => {
  const result = parseRohIntervals(`
Absence of heterozygosity regions:
arr[hg19] Xq21.1q21.2(84,000,000_86,000,000)x2 hmz
arr[hg19] 5q31.1(130,000,000-131,000,000)x1 deletion
arr[hg19] 6p21.1(42,000,000-43,000,000)x3 gain
`);

  assert.deepEqual(result.intervals, [{ chromosome: "chrX", start: 84000000, end: 86000000 }]);

  const standalone = parseRohIntervals("arr 7q11.1q11.2(60,000,000-62,000,000)x2 hmz");
  assert.deepEqual(standalone.intervals, [{ chromosome: "chr7", start: 60000000, end: 62000000 }]);
  assert.match(standalone.warnings.join("\n"), /No explicit ROH\/AOH heading/i);
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
