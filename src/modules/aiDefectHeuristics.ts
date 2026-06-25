/**
 * AI Defect Heuristics
 *
 * Detects defect patterns that AI coding agents introduce deliberately
 * (e.g. when asked to "make the build pass") or incidentally far more often
 * than human authors: swallowed exceptions that mask real failures,
 * hardcoded placeholder credentials left in from a scaffold/example, and
 * naive or deprecated cryptography. Generic "AI slop" scanners look for
 * style/dead-code smells; this module specifically targets security-bearing
 * defects.
 */

import type { FileDiff } from "../parser/diffParser.js";
import { addedLines } from "../parser/diffParser.js";
import type { Finding, Severity } from "../types.js";

interface DefectRule {
  rule: string;
  severity: Severity;
  pattern: RegExp;
  message: string;
}

// --- Swallowed / empty catch blocks -----------------------------------

const EMPTY_CATCH_OPEN_RE = /catch\s*(\([^)]*\))?\s*\{\s*\}/; // catch (e) {}
const CATCH_OPEN_RE = /\bcatch\s*\(([^)]*)\)\s*\{/;
const PY_EXCEPT_RE = /^\s*except(\s+[\w.]+(\s+as\s+\w+)?)?\s*:\s*$/;

/**
 * Detects empty or comment-only catch blocks touched by the diff. We scan
 * the full hunk (context + added lines) so we can recognize a catch block
 * whose opening line is unchanged context but whose body was added/edited
 * by the agent (the common real-world shape: an existing try/catch gets a
 * swallowing comment dropped into its body). A finding only fires when at
 * least one line of the block is an "added" line, so untouched pre-existing
 * code is never flagged.
 */
function detectSwallowedCatch(file: FileDiff): Finding[] {
  const findings: Finding[] = [];

  for (const hunk of file.hunks) {
    const lines = hunk.lines;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Single-line empty catch: catch (e) {}
      if (line.kind === "added" && EMPTY_CATCH_OPEN_RE.test(line.content)) {
        findings.push({
          category: "ai-defect",
          severity: "HIGH",
          rule: "swallowed-exception",
          message: "Empty catch block swallows the exception with no logging, rethrow, or handling, silently hiding failures.",
          file: file.path,
          line: line.newLineNumber,
          snippet: line.content.trim(),
        });
        continue;
      }

      // Multi-line catch: catch (e) { ... } where body is empty/comment-only.
      // We only care whether anything follows the catch's own opening brace
      // on this line (a leading `}` closing a preceding try block, e.g.
      // `} catch (e) {`, must not be mistaken for the catch body closing).
      const openMatch = CATCH_OPEN_RE.exec(line.content);
      const restOfLineAfterOpenBrace = openMatch
        ? line.content.slice(openMatch.index + openMatch[0].length)
        : "";
      if (openMatch && !restOfLineAfterOpenBrace.includes("}")) {
        const body: typeof lines = [];
        let depth = 1;
        let j = i + 1;
        let closed = false;
        for (; j < lines.length; j++) {
          const bodyLine = lines[j].content;
          const opens = (bodyLine.match(/\{/g) || []).length;
          const closes = (bodyLine.match(/\}/g) || []).length;
          depth += opens - closes;
          if (depth <= 0) {
            closed = true;
            break;
          }
          body.push(lines[j]);
        }
        if (closed) {
          const meaningfulLines = body.filter((b) => {
            const t = b.content.trim();
            return t.length > 0 && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("#");
          });
          const touchedByDiff = line.kind === "added" || body.some((b) => b.kind === "added");
          if (meaningfulLines.length === 0 && touchedByDiff) {
            const reportLine = body.find((b) => b.kind === "added") ?? line;
            findings.push({
              category: "ai-defect",
              severity: "HIGH",
              rule: "swallowed-exception",
              message:
                "Catch block contains only comments or nothing: the exception is swallowed with no logging, rethrow, or handling, silently hiding failures.",
              file: file.path,
              line: reportLine.newLineNumber,
              snippet: line.content.trim(),
            });
          }
        }
      }
    }

    // Python `except:` / `except Exception:` followed by only `pass` or comments.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.kind === "added" && PY_EXCEPT_RE.test(line.content)) {
        const next = lines[i + 1];
        if (next) {
          const t = next.content.trim();
          if (t === "pass" || t === "" || t.startsWith("#")) {
            findings.push({
              category: "ai-defect",
              severity: "HIGH",
              rule: "swallowed-exception",
              message: "Bare `except` block does nothing but `pass`, silently hiding failures.",
              file: file.path,
              line: line.newLineNumber,
              snippet: line.content.trim(),
            });
          }
        }
      }
    }
  }

  return findings;
}

// --- Hardcoded / placeholder credentials -------------------------------

const CREDENTIAL_RULES: DefectRule[] = [
  {
    rule: "placeholder-todo-security",
    severity: "MEDIUM",
    pattern: /\/\/\s*TODO:?\s*secure this|#\s*TODO:?\s*secure this/i,
    message: 'Placeholder comment ("TODO: secure this") indicates a known-insecure stopgap was left in agent-authored code.',
  },
  {
    rule: "hardcoded-placeholder-password",
    severity: "HIGH",
    pattern: /\b(password|passwd|pwd)\s*[=:]\s*["'](changeme|password123?|admin123?|letmein|placeholder|secret123?|test123?)["']/i,
    message: "Hardcoded placeholder password literal found in source.",
  },
  {
    rule: "hardcoded-api-key",
    severity: "HIGH",
    pattern: /\b(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token)\s*[=:]\s*["'][A-Za-z0-9_\-/+]{12,}["']/i,
    message: "Hardcoded API key / secret / access token literal found in source.",
  },
  {
    rule: "hardcoded-aws-key",
    severity: "HIGH",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    message: "Hardcoded AWS access key ID literal found in source.",
  },
  {
    rule: "hardcoded-generic-secret-assignment",
    severity: "MEDIUM",
    pattern: /\b(secret|token)\s*[=:]\s*["'][^"']{8,}["']/i,
    message: "Hardcoded secret/token-like literal assigned directly in source rather than loaded from config/secret storage.",
  },
];

// --- Naive / deprecated cryptography ------------------------------------

const CRYPTO_RULES: DefectRule[] = [
  {
    rule: "math-random-for-security-token",
    severity: "HIGH",
    pattern: /\b(token|password|secret|key|nonce|salt|sessionid|session_id)\b[^\n]{0,40}Math\.random\(\)|Math\.random\(\)[^\n]{0,40}\b(token|password|secret|key|nonce|salt)\b/i,
    message: "Math.random() is not cryptographically secure and must not be used to generate tokens, keys, salts, or nonces; use crypto.randomBytes / crypto.getRandomValues instead.",
  },
  {
    rule: "md5-usage",
    severity: "HIGH",
    pattern: /\b(createHash\(\s*["']md5["']\s*\)|hashlib\.md5\(|MD5\.(new|create)|MessageDigest\.getInstance\(\s*["']MD5["']\s*\))/i,
    message: "MD5 is cryptographically broken and unsuitable for password hashing, integrity checks, or signatures; use SHA-256/bcrypt/Argon2 as appropriate.",
  },
  {
    rule: "des-usage",
    severity: "HIGH",
    pattern: /\b(DES|3DES|TripleDES)\b.{0,30}\b(encrypt|cipher|Cipher)\b|Cipher\.getInstance\(\s*["']DES/i,
    message: "DES/3DES is a deprecated, weak cipher; use AES-256-GCM or another modern authenticated cipher instead.",
  },
  {
    rule: "sha1-for-passwords",
    severity: "MEDIUM",
    pattern: /\b(createHash\(\s*["']sha1["']\s*\)|hashlib\.sha1\()[^\n]{0,60}(password|pwd|secret)/i,
    message: "SHA-1 is unsuitable for password hashing; use a dedicated password-hashing function (bcrypt/scrypt/Argon2).",
  },
  {
    rule: "ecb-mode-cipher",
    severity: "MEDIUM",
    pattern: /\bAES\/ECB\b|MODE_ECB/,
    message: "AES in ECB mode leaks structural information about plaintext; use GCM or CBC with a random IV instead.",
  },
];

function scanLinesAgainstRules(file: FileDiff, rules: DefectRule[], category: Finding["category"]): Finding[] {
  const findings: Finding[] = [];
  for (const line of addedLines(file)) {
    for (const rule of rules) {
      if (rule.pattern.test(line.content)) {
        findings.push({
          category,
          severity: rule.severity,
          rule: rule.rule,
          message: rule.message,
          file: file.path,
          line: line.newLineNumber,
          snippet: line.content.trim().slice(0, 160),
        });
      }
    }
  }
  return findings;
}

/** Scans a single file's added lines for AI-pattern defects. */
export function detectFile(file: FileDiff): Finding[] {
  return [
    ...detectSwallowedCatch(file),
    ...scanLinesAgainstRules(file, CREDENTIAL_RULES, "ai-defect"),
    ...scanLinesAgainstRules(file, CRYPTO_RULES, "ai-defect"),
  ];
}

/** Scans all files in a parsed diff for AI-pattern security defects. */
export function scanAiDefects(files: FileDiff[]): Finding[] {
  return files.flatMap(detectFile);
}
