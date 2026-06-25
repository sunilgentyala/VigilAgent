import type { AuditReport } from "../types.js";

/** Renders the audit report as pretty-printed JSON. */
export function renderJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}
