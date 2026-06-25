export type Severity = "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type FindingCategory =
  | "package-hallucination"
  | "prompt-injection"
  | "ai-defect";

export interface Finding {
  category: FindingCategory;
  severity: Severity;
  rule: string;
  message: string;
  file: string;
  line?: number;
  snippet?: string;
}

export interface AuditReport {
  findings: Finding[];
  filesScanned: number;
  generatedAt: string;
}
