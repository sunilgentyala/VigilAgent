/**
 * Prompt Injection Auditor
 *
 * Scans newly added lines (comments and string literals) in a diff for
 * directive-like patterns aimed at an AI coding agent. This catches
 * "indirect prompt injection" that has been smuggled into source through an
 * ingested issue, ticket, third-party doc, or dependency README and then
 * reproduced verbatim by an agent into committed code — a vector none of
 * the existing terminal diff tools audit for.
 */

import type { FileDiff } from "../parser/diffParser.js";
import { addedLines } from "../parser/diffParser.js";
import type { Finding, Severity } from "../types.js";

interface InjectionRule {
  rule: string;
  severity: Severity;
  pattern: RegExp;
  describe: (match: string) => string;
}

const INSTRUCTION_OVERRIDE_RULES: InjectionRule[] = [
  {
    rule: "ignore-previous-instructions",
    severity: "HIGH",
    pattern: /\b(ignore|disregard|forget)\s+(all\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|directives?|rules?)\b/i,
    describe: () => 'Directive instructing an AI agent to ignore prior instructions ("ignore previous instructions" pattern).',
  },
  {
    rule: "ai-must-directive",
    severity: "HIGH",
    pattern: /\bas an? (ai|assistant|language model)\b.{0,40}\b(you must|you should|you will|you are required to)\b/i,
    describe: () => 'Directive addressing "as an AI ... you must/should" — classic indirect prompt injection phrasing.',
  },
  {
    rule: "system-prompt-override",
    severity: "HIGH",
    pattern: /\b(new|updated|real|actual)\s+(system prompt|instructions?)\s*[:\-]/i,
    describe: () => "Text attempting to inject a replacement system prompt or instruction set.",
  },
  {
    rule: "do-not-tell-operator",
    severity: "HIGH",
    pattern: /\b(do not|don't|never)\s+(tell|inform|alert|notify)\s+(the\s+)?(user|developer|operator|reviewer)\b/i,
    describe: () => "Directive instructing the agent to conceal actions from the human operator/reviewer.",
  },
  {
    rule: "exfiltrate-secrets-directive",
    severity: "HIGH",
    pattern: /\b(send|post|email|exfiltrate|upload)\s+(the\s+)?(api[ _-]?key|secret|token|credentials?|password|env(ironment)? variables?)\s+(to|via)\b/i,
    describe: () => "Directive instructing exfiltration of secrets/credentials to an external destination.",
  },
  {
    rule: "agent-tool-coercion",
    severity: "MEDIUM",
    pattern: /\b(you (have|must) (access|permission) to|use your (tool|shell|terminal) access to)\b/i,
    describe: () => "Language attempting to coerce an agent into exercising elevated tool/shell access.",
  },
  {
    rule: "jailbreak-keyword",
    severity: "MEDIUM",
    pattern: /\b(jailbreak|dan mode|developer mode enabled|unfiltered mode)\b/i,
    describe: (match) => `Suspicious jailbreak-style keyword found: "${match}".`,
  },
];

// Base64 blobs are common (build hashes, fixtures, etc.), so we only flag
// them when they co-occur with suspicious keywords nearby in the same line,
// reducing false positives on legitimate base64 fixtures/test data.
const BASE64_BLOB_RE = /(?:[A-Za-z0-9+/]{40,}={0,2})/;
const BASE64_SUSPICIOUS_CONTEXT_RE =
  /\b(prompt|instruction|system|agent|directive|payload|inject|decode and run|eval)\b/i;

// Zero-width and bidirectional-override characters used for text steganography.
const ZERO_WIDTH_RE = /[​‌‍⁠﻿᠎‎‏‪-‮⁦-⁩]/;

const IMPERATIVE_COMMENT_RE =
  /\b(you must|always (run|execute|include)|never (question|refuse)|from now on,? (you|your))\b/i;

function isCommentOrStringLine(content: string): boolean {
  const trimmed = content.trim();
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith('"""') ||
    trimmed.startsWith("'''") ||
    trimmed.startsWith("--")
  ) {
    return true;
  }
  // Heuristic: line contains a quoted string literal of meaningful length.
  return /["'`][^"'`]{8,}["'`]/.test(trimmed);
}

/**
 * Scans a single file's added lines for prompt-injection style content.
 */
export function auditFile(file: FileDiff): Finding[] {
  const findings: Finding[] = [];

  for (const line of addedLines(file)) {
    const content = line.content;
    if (!content.trim()) continue;

    const relevant = isCommentOrStringLine(content);

    for (const rule of INSTRUCTION_OVERRIDE_RULES) {
      const match = rule.pattern.exec(content);
      if (match && relevant) {
        findings.push({
          category: "prompt-injection",
          severity: rule.severity,
          rule: rule.rule,
          message: rule.describe(match[0]),
          file: file.path,
          line: line.newLineNumber,
          snippet: content.trim().slice(0, 160),
        });
      }
    }

    if (ZERO_WIDTH_RE.test(content)) {
      findings.push({
        category: "prompt-injection",
        severity: "HIGH",
        rule: "zero-width-steganography",
        message:
          "Zero-width or bidirectional-override Unicode character detected — a known technique for hiding instructions from human reviewers while an AI agent's tokenizer still reads them.",
        file: file.path,
        line: line.newLineNumber,
        snippet: JSON.stringify(content.trim().slice(0, 80)),
      });
    }

    if (relevant && IMPERATIVE_COMMENT_RE.test(content)) {
      findings.push({
        category: "prompt-injection",
        severity: "MEDIUM",
        rule: "suspicious-imperative-comment",
        message: "Comment contains an imperative directive phrased at an AI agent rather than a human reader.",
        file: file.path,
        line: line.newLineNumber,
        snippet: content.trim().slice(0, 160),
      });
    }

    const b64Match = BASE64_BLOB_RE.exec(content);
    if (b64Match && BASE64_SUSPICIOUS_CONTEXT_RE.test(content)) {
      findings.push({
        category: "prompt-injection",
        severity: "MEDIUM",
        rule: "suspicious-base64-blob",
        message: "Base64-looking blob found near suspicious keywords (prompt/instruction/payload/decode-and-run context).",
        file: file.path,
        line: line.newLineNumber,
        snippet: `${b64Match[0].slice(0, 40)}...`,
      });
    }
  }

  return findings;
}

/** Scans all files in a parsed diff for prompt-injection style content. */
export function scanPromptInjection(files: FileDiff[]): Finding[] {
  return files.flatMap(auditFile);
}
