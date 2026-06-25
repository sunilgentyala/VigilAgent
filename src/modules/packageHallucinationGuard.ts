/**
 * Package Hallucination Guard
 *
 * Extracts newly added dependency declarations from package.json,
 * requirements.txt, and Cargo.toml diffs, then cross-references each
 * package name against the live public registry (npm, PyPI, crates.io).
 * Packages that the registry has never heard of (HTTP 404) are flagged as
 * likely hallucinated or typosquatted, a known failure mode of AI coding
 * agents that invent plausible-sounding package names.
 *
 * Network failures are treated as "unverified", never as a vulnerability:
 * we cannot prove a package is fake just because we couldn't reach the
 * registry, so we surface that distinction explicitly rather than crying
 * wolf when offline or rate-limited.
 */

import type { FileDiff } from "../parser/diffParser.js";
import { addedLines } from "../parser/diffParser.js";
import type { Finding } from "../types.js";

export type Ecosystem = "npm" | "pypi" | "cargo";

export interface ExtractedDependency {
  ecosystem: Ecosystem;
  name: string;
  file: string;
  line?: number;
}

export type RegistryCheckResult = "found" | "not-found" | "unverified";

export interface RegistryChecker {
  check(ecosystem: Ecosystem, name: string): Promise<RegistryCheckResult>;
}

const REGISTRY_URL: Record<Ecosystem, (name: string) => string> = {
  npm: (name) => `https://registry.npmjs.org/${encodeURIComponent(name)}`,
  pypi: (name) => `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
  cargo: (name) => `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`,
};

/** Default checker that hits the real public registries over HTTPS. */
export class HttpRegistryChecker implements RegistryChecker {
  constructor(private readonly timeoutMs = 8000) {}

  async check(ecosystem: Ecosystem, name: string): Promise<RegistryCheckResult> {
    const url = REGISTRY_URL[ecosystem](name);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { "User-Agent": "vigilagent-security-audit" },
      });
      if (res.status === 404) {
        return "not-found";
      }
      if (res.ok) {
        return "found";
      }
      // Non-404 error status (rate limit, 5xx, etc.): can't conclude either way.
      return "unverified";
    } catch {
      // Network error, timeout, DNS failure, offline, etc.
      return "unverified";
    } finally {
      clearTimeout(timer);
    }
  }
}

function isDependencyManifest(path: string): Ecosystem | null {
  const lower = path.toLowerCase();
  if (lower.endsWith("package.json")) return "npm";
  if (lower.endsWith("requirements.txt") || lower.endsWith("pyproject.toml")) return "pypi";
  if (lower.endsWith("cargo.toml")) return "cargo";
  return null;
}

const NPM_PACKAGE_JSON_LINE_RE = /^\s*"([^"@][^"]*)"\s*:\s*"[^"]*"\s*,?\s*$/;
const PY_REQUIREMENT_RE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:[=<>!~]{1,2}=?\s*[\w.*+!-]+)?\s*(?:;.*)?$/;
const CARGO_DEP_LINE_RE = /^\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s*=\s*(?:"[^"]*"|\{.*\})\s*$/;

/**
 * Heuristically determines whether a JSON line sits inside a dependency
 * block (dependencies / devDependencies / peerDependencies / optionalDependencies).
 */
function collectNpmDependencyNames(file: FileDiff): ExtractedDependency[] {
  const deps: ExtractedDependency[] = [];
  for (const hunk of file.hunks) {
    let inDepsBlock = false;
    let braceDepthAtBlockStart = 0;
    let braceDepth = 0;
    for (const line of hunk.lines) {
      const trimmed = line.content.trim();
      if (/^"(dependencies|devDependencies|peerDependencies|optionalDependencies)"\s*:\s*\{/.test(trimmed)) {
        inDepsBlock = true;
        braceDepthAtBlockStart = braceDepth;
      }
      const opens = (trimmed.match(/\{/g) || []).length;
      const closes = (trimmed.match(/\}/g) || []).length;

      if (inDepsBlock && line.kind === "added") {
        const m = NPM_PACKAGE_JSON_LINE_RE.exec(line.content);
        if (m) {
          deps.push({ ecosystem: "npm", name: m[1], file: file.path, line: line.newLineNumber });
        }
      }

      braceDepth += opens - closes;
      if (inDepsBlock && braceDepth <= braceDepthAtBlockStart && closes > 0) {
        inDepsBlock = false;
      }
    }
  }
  return deps;
}

function collectPyDependencyNames(file: FileDiff): ExtractedDependency[] {
  const deps: ExtractedDependency[] = [];
  for (const line of addedLines(file)) {
    const trimmed = line.content.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const m = PY_REQUIREMENT_RE.exec(trimmed);
    if (m) {
      deps.push({ ecosystem: "pypi", name: m[1], file: file.path, line: line.newLineNumber });
    }
  }
  return deps;
}

function collectCargoDependencyNames(file: FileDiff): ExtractedDependency[] {
  const deps: ExtractedDependency[] = [];
  for (const hunk of file.hunks) {
    let inDepsBlock = false;
    for (const line of hunk.lines) {
      const trimmed = line.content.trim();
      if (/^\[(dependencies|dev-dependencies|build-dependencies)(\..+)?\]\s*$/.test(trimmed)) {
        inDepsBlock = true;
        continue;
      }
      if (/^\[.+\]\s*$/.test(trimmed)) {
        inDepsBlock = false;
        continue;
      }
      if (inDepsBlock && line.kind === "added") {
        const m = CARGO_DEP_LINE_RE.exec(line.content);
        if (m) {
          deps.push({ ecosystem: "cargo", name: m[1], file: file.path, line: line.newLineNumber });
        }
      }
    }
  }
  return deps;
}

/** Extracts all newly added dependency declarations from a parsed diff's files. */
export function extractAddedDependencies(files: FileDiff[]): ExtractedDependency[] {
  const result: ExtractedDependency[] = [];
  for (const file of files) {
    const ecosystem = isDependencyManifest(file.path);
    if (!ecosystem) continue;
    if (ecosystem === "npm") result.push(...collectNpmDependencyNames(file));
    if (ecosystem === "pypi") result.push(...collectPyDependencyNames(file));
    if (ecosystem === "cargo") result.push(...collectCargoDependencyNames(file));
  }
  return result;
}

export interface PackageHallucinationOptions {
  checker?: RegistryChecker;
}

/**
 * Scans a parsed diff for newly added dependencies and checks each against
 * its public registry, producing findings for packages that don't exist.
 */
export async function scanPackageHallucination(
  files: FileDiff[],
  options: PackageHallucinationOptions = {}
): Promise<Finding[]> {
  const checker = options.checker ?? new HttpRegistryChecker();
  const deps = extractAddedDependencies(files);
  const findings: Finding[] = [];

  const results = await Promise.all(
    deps.map(async (dep) => ({ dep, result: await checker.check(dep.ecosystem, dep.name) }))
  );

  for (const { dep, result } of results) {
    if (result === "not-found") {
      findings.push({
        category: "package-hallucination",
        severity: "HIGH",
        rule: "hallucinated-package",
        message: `Package "${dep.name}" was not found on the ${registryLabel(dep.ecosystem)} registry. This may be a hallucinated or typosquatted dependency introduced by an AI coding agent.`,
        file: dep.file,
        line: dep.line,
        snippet: dep.name,
      });
    } else if (result === "unverified") {
      findings.push({
        category: "package-hallucination",
        severity: "INFO",
        rule: "unverified-package",
        message: `Could not verify package "${dep.name}" against the ${registryLabel(dep.ecosystem)} registry (network unavailable or rate-limited). Treat as unverified, not as a confirmed issue.`,
        file: dep.file,
        line: dep.line,
        snippet: dep.name,
      });
    }
  }

  return findings;
}

function registryLabel(ecosystem: Ecosystem): string {
  switch (ecosystem) {
    case "npm":
      return "npm";
    case "pypi":
      return "PyPI";
    case "cargo":
      return "crates.io";
  }
}
