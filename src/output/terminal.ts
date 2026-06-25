import type { AuditReport, Finding, Severity } from "../types.js";

const SEVERITY_ORDER: Severity[] = ["HIGH", "MEDIUM", "LOW", "INFO"];

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  green: "\x1b[32m",
};

const SEVERITY_COLOR: Record<Severity, string> = {
  HIGH: ANSI.red,
  MEDIUM: ANSI.yellow,
  LOW: ANSI.blue,
  INFO: ANSI.gray,
};

function colorize(text: string, code: string, useColor: boolean): string {
  return useColor ? `${code}${text}${ANSI.reset}` : text;
}

function groupBySeverity(findings: Finding[]): Map<Severity, Finding[]> {
  const map = new Map<Severity, Finding[]>();
  for (const sev of SEVERITY_ORDER) map.set(sev, []);
  for (const f of findings) {
    map.get(f.severity)?.push(f);
  }
  return map;
}

export interface TerminalRenderOptions {
  /** Force color on/off. Defaults to detecting TTY via process.stdout.isTTY. */
  color?: boolean;
}

/** Renders the audit report as human-readable terminal output, colored when run in a TTY. */
export function renderTerminal(report: AuditReport, options: TerminalRenderOptions = {}): string {
  const useColor = options.color ?? Boolean(process.stdout.isTTY);
  const lines: string[] = [];

  lines.push(colorize("VigilAgent Security Audit", ANSI.bold, useColor));
  lines.push(colorize(`Files scanned: ${report.filesScanned}`, ANSI.dim, useColor));
  lines.push("");

  if (report.findings.length === 0) {
    lines.push(colorize("No findings. Clean changeset.", ANSI.green, useColor));
    return lines.join("\n");
  }

  const grouped = groupBySeverity(report.findings);

  for (const sev of SEVERITY_ORDER) {
    const items = grouped.get(sev) ?? [];
    if (items.length === 0) continue;

    lines.push(colorize(`${sev} (${items.length})`, `${ANSI.bold}${SEVERITY_COLOR[sev]}`, useColor));
    for (const f of items) {
      const location = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(`  ${colorize(`[${f.rule}]`, SEVERITY_COLOR[sev], useColor)} ${location}`);
      lines.push(`    ${f.message}`);
      if (f.snippet) {
        lines.push(colorize(`    > ${f.snippet}`, ANSI.dim, useColor));
      }
    }
    lines.push("");
  }

  const highCount = grouped.get("HIGH")?.length ?? 0;
  const summaryColor = highCount > 0 ? ANSI.red : ANSI.green;
  lines.push(
    colorize(
      `Summary: ${report.findings.length} finding(s), ${highCount} HIGH severity`,
      `${ANSI.bold}${summaryColor}`,
      useColor
    )
  );

  return lines.join("\n");
}
