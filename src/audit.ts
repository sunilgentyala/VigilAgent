import { parseDiff } from "./parser/diffParser.js";
import { scanPackageHallucination, type PackageHallucinationOptions } from "./modules/packageHallucinationGuard.js";
import { scanPromptInjection } from "./modules/promptInjectionAuditor.js";
import { scanAiDefects } from "./modules/aiDefectHeuristics.js";
import type { AuditReport } from "./types.js";

export interface AuditOptions {
  packageHallucination?: PackageHallucinationOptions;
  /** Skip network-dependent package hallucination checks entirely. */
  skipPackageCheck?: boolean;
}

/**
 * Runs all three audit modules against unified diff text and returns a
 * combined report.
 */
export async function runAudit(diffText: string, options: AuditOptions = {}): Promise<AuditReport> {
  const parsed = parseDiff(diffText);

  const [packageFindings, injectionFindings, defectFindings] = await Promise.all([
    options.skipPackageCheck
      ? Promise.resolve([])
      : scanPackageHallucination(parsed.files, options.packageHallucination),
    Promise.resolve(scanPromptInjection(parsed.files)),
    Promise.resolve(scanAiDefects(parsed.files)),
  ]);

  const findings = [...packageFindings, ...injectionFindings, ...defectFindings];

  return {
    findings,
    filesScanned: parsed.files.length,
    generatedAt: new Date().toISOString(),
  };
}
