import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseDiff } from "../src/parser/diffParser.js";
import { scanAiDefects } from "../src/modules/aiDefectHeuristics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

test("detects swallowed exception in catch block with only a comment", () => {
  const diffText = loadFixture("swallowed-exception.diff");
  const parsed = parseDiff(diffText);
  const findings = scanAiDefects(parsed.files);

  const swallowed = findings.find((f) => f.rule === "swallowed-exception");
  assert.ok(swallowed, "expected a swallowed-exception finding");
  assert.equal(swallowed?.severity, "HIGH");
});

test("detects Math.random() used for token generation", () => {
  const diffText = loadFixture("swallowed-exception.diff");
  const parsed = parseDiff(diffText);
  const findings = scanAiDefects(parsed.files);

  const naiveCrypto = findings.find((f) => f.rule === "math-random-for-security-token");
  assert.ok(naiveCrypto, "expected math-random-for-security-token finding");
  assert.equal(naiveCrypto?.severity, "HIGH");
});

test("detects hardcoded placeholder password", () => {
  const diffText = `diff --git a/src/config.js b/src/config.js
index 1111111..2222222 100644
--- a/src/config.js
+++ b/src/config.js
@@ -1,1 +1,2 @@
 module.exports = {};
+const password = "changeme";
`;
  const parsed = parseDiff(diffText);
  const findings = scanAiDefects(parsed.files);
  const placeholder = findings.find((f) => f.rule === "hardcoded-placeholder-password");
  assert.ok(placeholder, "expected hardcoded-placeholder-password finding");
  assert.equal(placeholder?.severity, "HIGH");
});

test("detects MD5 usage", () => {
  const diffText = `diff --git a/src/hash.js b/src/hash.js
index 1111111..2222222 100644
--- a/src/hash.js
+++ b/src/hash.js
@@ -1,1 +1,2 @@
 const crypto = require("crypto");
+const hash = crypto.createHash("md5").update(data).digest("hex");
`;
  const parsed = parseDiff(diffText);
  const findings = scanAiDefects(parsed.files);
  const md5 = findings.find((f) => f.rule === "md5-usage");
  assert.ok(md5, "expected md5-usage finding");
});

test("clean diff produces no AI defect findings", () => {
  const diffText = loadFixture("clean-diff.diff");
  const parsed = parseDiff(diffText);
  const findings = scanAiDefects(parsed.files);
  assert.equal(findings.length, 0);
});
