// Unit test for parseEvidence() in public/ribbon.js — run: node scripts/ribbon-evidence-test.mjs
import { parseEvidence } from "../public/ribbon.js";

const cases = [
  ["4 calls; falling segments lasting 848-1781 ms; median f0 558 Hz",
    { line: 558, band: null, calls: 4 }],
  ["single loud 1.149 s call; rms_mean 0.194; wide f0 range 166-1000 Hz with falling contour",
    { line: null, band: [166, 1000], calls: 1 }],
  ["3 short calls over 2.61 s; median f0 429 Hz; spectral centroid 1014 Hz",
    { line: 429, band: null, calls: 3 }],
  ["4 calls; 848-1781 ms segments; all falling at 516-608 Hz",
    { line: null, band: [516, 608], calls: 4 }],
  ["7 calls; warbled contour; f0 range 80-1000 Hz across 10.635 s",
    { line: null, band: [80, 1000], calls: 7 }],
  ["rising contour; 2 calls; median f0 600 Hz",
    { line: 600, band: null, calls: 2 }],
  [null, { line: null, band: null, calls: null }],
];

let fail = 0;
for (const [input, want] of cases) {
  const got = parseEvidence(input);
  const ok = got.line === want.line && got.calls === want.calls &&
    JSON.stringify(got.band) === JSON.stringify(want.band);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${JSON.stringify(got)}  <-  ${input}`);
}
if (fail) { console.error(`${fail} FAIL`); process.exit(1); }
console.log("ALL EVIDENCE TESTS PASS");
