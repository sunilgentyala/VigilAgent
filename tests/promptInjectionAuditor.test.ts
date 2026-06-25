import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseDiff } from "../src/parser/diffParser.js";
import { scanPromptInjection } from "../src/modules/promptInjectionAuditor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

test("detects 'ignore previous instructions' directive in added comment", () => {
  const diffText = loadFixture("prompt-injection-comment.diff");
  const parsed = parseDiff(diffText);
  const findings = scanPromptInjection(parsed.files);

  const ignorePrevious = findings.find((f) => f.rule === "ignore-previous-instructions");
  assert.ok(ignorePrevious, "expected ignore-previous-instructions finding");
  assert.equal(ignorePrevious?.severity, "HIGH");
});

test("detects 'as an AI you must' directive pattern", () => {
  const diffText = loadFixture("prompt-injection-comment.diff");
  const parsed = parseDiff(diffText);
  const findings = scanPromptInjection(parsed.files);

  const aiDirective = findings.find((f) => f.rule === "ai-must-directive");
  assert.ok(aiDirective, "expected ai-must-directive finding");
  assert.equal(aiDirective?.severity, "HIGH");
});

test("detects zero-width steganography characters", () => {
  const diffText = `diff --git a/src/note.js b/src/note.js
index 1111111..2222222 100644
--- a/src/note.js
+++ b/src/note.js
@@ -1,1 +1,2 @@
 const x = 1;
+// normal looking comment​with hidden zero width char
`;
  const parsed = parseDiff(diffText);
  const findings = scanPromptInjection(parsed.files);
  const zw = findings.find((f) => f.rule === "zero-width-steganography");
  assert.ok(zw, "expected zero-width-steganography finding");
});

test("clean diff produces no prompt injection findings", () => {
  const diffText = loadFixture("clean-diff.diff");
  const parsed = parseDiff(diffText);
  const findings = scanPromptInjection(parsed.files);
  assert.equal(findings.length, 0);
});
