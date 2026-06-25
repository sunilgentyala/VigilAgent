import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseDiff } from "../src/parser/diffParser.js";
import {
  extractAddedDependencies,
  scanPackageHallucination,
  type RegistryChecker,
  type RegistryCheckResult,
  type Ecosystem,
} from "../src/modules/packageHallucinationGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

class FakeRegistryChecker implements RegistryChecker {
  constructor(private readonly knownPackages: Set<string>) {}
  async check(_ecosystem: Ecosystem, name: string): Promise<RegistryCheckResult> {
    return this.knownPackages.has(name) ? "found" : "not-found";
  }
}

test("extracts newly added npm dependencies from package.json diff", () => {
  const diffText = loadFixture("hallucinated-package.diff");
  const parsed = parseDiff(diffText);
  const deps = extractAddedDependencies(parsed.files);

  const names = deps.map((d) => d.name);
  assert.ok(names.includes("fastify-super-turbo-async-helper-totally-real"));
  assert.ok(names.includes("left-pad"));
  // lodash is re-emitted as an added line purely because a trailing comma
  // was introduced (a common git-diff artifact); it legitimately appears
  // as an "added" line even though the dependency itself isn't new.
  assert.ok(names.includes("lodash"));
});

test("flags packages not found on the registry as HIGH severity findings", async () => {
  const diffText = loadFixture("hallucinated-package.diff");
  const parsed = parseDiff(diffText);

  const checker = new FakeRegistryChecker(new Set(["left-pad", "lodash"]));
  const findings = await scanPackageHallucination(parsed.files, { checker });

  const hallucinated = findings.find(
    (f) => f.rule === "hallucinated-package" && f.snippet === "fastify-super-turbo-async-helper-totally-real"
  );
  assert.ok(hallucinated, "expected a hallucinated-package finding for the fake package");
  assert.equal(hallucinated?.severity, "HIGH");

  const realPkgFinding = findings.find((f) => f.snippet === "left-pad");
  assert.equal(realPkgFinding, undefined, "left-pad is known to the fake registry and should not be flagged");
});

test("treats network failures as unverified, not vulnerable", async () => {
  const diffText = loadFixture("hallucinated-package.diff");
  const parsed = parseDiff(diffText);

  class FailingChecker implements RegistryChecker {
    async check(): Promise<RegistryCheckResult> {
      return "unverified";
    }
  }

  const findings = await scanPackageHallucination(parsed.files, { checker: new FailingChecker() });
  assert.ok(findings.length > 0);
  for (const f of findings) {
    assert.equal(f.rule, "unverified-package");
    assert.equal(f.severity, "INFO");
  }
});

test("clean diff with no dependency manifest changes produces no package findings", async () => {
  const diffText = loadFixture("clean-diff.diff");
  const parsed = parseDiff(diffText);
  const findings = await scanPackageHallucination(parsed.files, {
    checker: new FakeRegistryChecker(new Set()),
  });
  assert.equal(findings.length, 0);
});
