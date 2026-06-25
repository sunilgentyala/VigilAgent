import type { AuditReport, Finding, Severity } from "../types.js";

const SEVERITY_ORDER: Severity[] = ["HIGH", "MEDIUM", "LOW", "INFO"];

function groupBySeverity(findings: Finding[]): Map<Severity, Finding[]> {
  const map = new Map<Severity, Finding[]>();
  for (const sev of SEVERITY_ORDER) map.set(sev, []);
  for (const f of findings) {
    map.get(f.severity)?.push(f);
  }
  return map;
}

/** Renders the audit report as a Markdown summary suitable for PR comments. */
export function renderMarkdown(report: AuditReport): string {
  const lines: string[] = [];
  lines.push("# VigilAgent Security Audit Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Files scanned: ${report.filesScanned}`);
  lines.push(`Total findings: ${report.findings.length}`);
  lines.push("");

  const grouped = groupBySeverity(report.findings);

  lines.push("| Severity | Count |");
  lines.push("|---|---|");
  for (const sev of SEVERITY_ORDER) {
    lines.push(`| ${sev} | ${grouped.get(sev)?.length ?? 0} |`);
  }
  lines.push("");

  if (report.findings.length === 0) {
    lines.push("No findings. Clean changeset.");
    return lines.join("\n");
  }

  for (const sev of SEVERITY_ORDER) {
    const items = grouped.get(sev) ?? [];
    if (items.length === 0) continue;
    lines.push(`## ${sev}`);
    lines.push("");
    for (const f of items) {
      const location = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(`- **[${f.rule}]** ${location}: ${f.message}`);
      if (f.snippet) {
        lines.push(`  \`\`\``);
        lines.push(`  ${f.snippet}`);
        lines.push(`  \`\`\``);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
