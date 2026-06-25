import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runAudit } from "../src/audit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

test("runAudit on a clean diff with skipPackageCheck returns no findings", async () => {
  const diffText = loadFixture("clean-diff.diff");
  const report = await runAudit(diffText, { skipPackageCheck: true });
  assert.equal(report.findings.length, 0);
  assert.equal(report.filesScanned, 1);
});

test("runAudit on a swallowed-exception diff finds HIGH severity issues", async () => {
  const diffText = loadFixture("swallowed-exception.diff");
  const report = await runAudit(diffText, { skipPackageCheck: true });
  assert.ok(report.findings.some((f) => f.severity === "HIGH"));
});

test("runAudit on a prompt-injection diff finds the injection patterns", async () => {
  const diffText = loadFixture("prompt-injection-comment.diff");
  const report = await runAudit(diffText, { skipPackageCheck: true });
  assert.ok(report.findings.some((f) => f.category === "prompt-injection"));
});
