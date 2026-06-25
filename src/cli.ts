#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runAudit } from "./audit.js";
import { renderJson } from "./output/json.js";
import { renderMarkdown } from "./output/markdown.js";
import { renderTerminal } from "./output/terminal.js";
import type { AuditReport } from "./types.js";

interface CliOptions {
  json: boolean;
  markdown: boolean;
  failOnVuln: boolean;
  skipPackageCheck: boolean;
  pathArg?: string;
  help: boolean;
}

function printHelp(): void {
  console.log(`VigilAgent: security auditing CLI for AI-agent-authored code changesets

Usage:
  vigilagent [path] [options]
  git diff | vigilagent [options]

Arguments:
  path                  Path to a .patch/.diff file, or a directory/file to run
                         "git diff" against. If omitted, reads a diff from stdin.

Options:
  --json                 Output findings as JSON
  --markdown             Output findings as a Markdown summary
  --fail-on-vuln         Exit with code 1 if any HIGH severity finding is present
  --no-package-check     Skip registry lookups for package hallucination detection
  -h, --help             Show this help message

Examples:
  git diff | vigilagent
  vigilagent ./my-change.patch --json
  vigilagent src/ --fail-on-vuln
  git diff main...feature | vigilagent --markdown > report.md
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    markdown: false,
    failOnVuln: false,
    skipPackageCheck: false,
    help: false,
  };

  for (const arg of argv) {
    switch (arg) {
      case "--json":
        options.json = true;
        break;
      case "--markdown":
        options.markdown = true;
        break;
      case "--fail-on-vuln":
        options.failOnVuln = true;
        break;
      case "--no-package-check":
        options.skipPackageCheck = true;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        if (!arg.startsWith("-")) {
          options.pathArg = arg;
        }
        break;
    }
  }

  return options;
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function isPatchFile(path: string): boolean {
  return /\.(patch|diff)$/i.test(path);
}

function getDiffText(pathArg: string | undefined): string {
  if (!pathArg) {
    return readStdin();
  }

  if (isPatchFile(pathArg)) {
    return readFileSync(pathArg, "utf-8");
  }

  // Treat as a path to diff against the working tree via `git diff`.
  const result = spawnSync("git", ["diff", "--", pathArg], {
    encoding: "utf-8",
    maxBuffer: 1024 * 1024 * 64,
  });

  if (result.error) {
    throw new Error(`Failed to run "git diff -- ${pathArg}": ${result.error.message}`);
  }
  if (result.status !== 0 && result.stderr) {
    throw new Error(`git diff failed: ${result.stderr.trim()}`);
  }

  return result.stdout ?? "";
}

function hasHighSeverity(report: AuditReport): boolean {
  return report.findings.some((f) => f.severity === "HIGH");
}

export async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);

  if (options.help) {
    printHelp();
    return 0;
  }

  let diffText: string;
  try {
    diffText = getDiffText(options.pathArg);
  } catch (err) {
    console.error(`vigilagent: ${(err as Error).message}`);
    return 2;
  }

  if (!diffText || !diffText.trim()) {
    console.error("vigilagent: no diff input found (empty stdin/file, or no changes detected).");
    return 2;
  }

  const report = await runAudit(diffText, { skipPackageCheck: options.skipPackageCheck });

  if (options.json) {
    console.log(renderJson(report));
  } else if (options.markdown) {
    console.log(renderMarkdown(report));
  } else {
    console.log(renderTerminal(report));
  }

  if (options.failOnVuln && hasHighSeverity(report)) {
    return 1;
  }

  return 0;
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;

if (isMainModule || process.argv[1]?.endsWith("cli.js")) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("vigilagent: unexpected error:", err);
      process.exit(2);
    });
}
