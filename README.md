# VigilAgent

[![CI](https://github.com/sunilgentyala/VigilAgent/actions/workflows/ci.yml/badge.svg)](https://github.com/sunilgentyala/VigilAgent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](package.json)
[![Docs](https://img.shields.io/badge/docs-live-blue)](https://sunilgentyala.github.io/VigilAgent/)
[![Changelog](https://img.shields.io/badge/changelog-0.1.1-informational)](CHANGELOG.md)

Security auditing CLI for AI-agent-authored code changesets: diffs produced
by Claude Code, Cursor, Copilot Workspace, and similar coding agents.

VigilAgent reads a unified diff and runs three security-focused detectors
that none of the existing terminal diff/review tools cover, then renders the
findings as colored terminal output, JSON, or Markdown, with an optional
CI exit-code gate.

## Why VigilAgent

Terminal diff and review tools have converged on visualization and review
ergonomics, not security. Agent-oriented diff viewers make it easier to
follow what an agent changed, but they don't audit content. Structural and
syntax-highlighting tools render diffs beautifully but perform no security
checks at all. "AI slop" scanners catch style and dead-code smells, such as
narrative comments and oversized functions, not security defects.

VigilAgent is the layer none of them are: a detector built specifically for
the failure modes that show up when an agent, not a human, authored the
change. It closes four gaps that are specific to AI-agent-authored code:

1. **Package hallucination**: coding agents occasionally invent
   plausible-sounding package names that don't exist on the real registry,
   or get talked into adding a typosquatted lookalike. Nothing cross-checks
   newly added `package.json` / `requirements.txt` / `Cargo.toml` entries
   against the live npm/PyPI/crates.io registries.
2. **Indirect prompt injection in generated code**: an agent that ingests an
   issue, ticket, or third-party doc can reproduce embedded directives
   ("ignore previous instructions", "as an AI you must...") verbatim into
   comments or strings in the diff it produces. No reviewed tool scans for
   this.
3. **AI-specific defect heuristics**: swallowed exceptions that mask real
   failures, hardcoded placeholder credentials left over from a scaffold,
   and naive/deprecated cryptography (`Math.random()` for tokens, MD5, DES)
   show up disproportionately often in agent-authored diffs and aren't what
   generic slop scanners look for.
4. **CI gating keyed to security, not style**: `--fail-on-vuln` gives you a
   single exit-code gate for HIGH severity findings, suitable for a
   pre-merge check on agent-authored branches.

### The problem, backed by research

This isn't a hypothetical risk. Independent research gives you real numbers:

- **Package hallucination is common and predictable.** Spracklen et al.
  (USENIX Security 2025) generated 576,000 code samples across 16 LLMs and
  found commercial models invent a non-existent package name **5.2% of the
  time**, open-source models **21.7%**, and that the same fake names
  recur often enough for an attacker to pre-register them, a technique now
  called *slopsquatting*. A 2026 re-evaluation across newer frontier
  models found the rate has narrowed but is still **4.6-6.1%**, not zero.
- **Prompt injection reaches coding agents through the files they read.**
  A 2025 study of agentic coding editors demonstrated concrete injection
  paths where an instruction embedded in an issue, README, or third-party
  doc gets reproduced by the agent directly into committed code, a class
  of attack survey work has since organized into a broader taxonomy of
  indirect prompt injection against LLM agent systems.
  Firewall-only defenses have been shown to be an incomplete answer,
  which is why VigilAgent checks the agent's *output* rather than only
  its inputs.
- **Agent-authored code carries more security-bearing defects.** Multiple
  independent studies replicating and extending the original GitHub
  Copilot security study found roughly 30-40% of AI-generated completions
  contain an identifiable security weakness, and a 2025 systematic
  literature review found injection flaws, broken authentication, and
  weak cryptography appear disproportionately relative to human-authored
  code. A separate longitudinal study found the problem doesn't reliably
  improve as you iterate with the same model.

VigilAgent exists because none of the diff/review tooling built for
agentic coding, hunk, codiff, difftastic, delta, "AI slop" scanners,
actually checks for any of these three things. It's a narrow tool by
design: it doesn't try to replace your SAST scanner, it catches the
specific failure modes that are new because a model, not a person, wrote
the diff.

### How it compares

| Tool | Focus | Agent-aware | Security checks |
|---|---|---|---|
| hunk | Review-first terminal diff viewer | Yes | None, visualization only |
| codiff | LLM walkthrough/review mode | Partial | Summarizes, doesn't audit |
| slop-scan | "AI slop" pattern scan | Partial | Style/quality heuristics only |
| difftastic | Structural AST diff | No | None |
| delta | Syntax-highlighted diff pager | No | None |
| diffnav | Delta + file-tree navigation | No | None |
| **VigilAgent** | **Security audit for agent diffs** | **Yes** | **Hallucination + injection + defect heuristics** |

## Install

```bash
npm install -g vigilagent
```

(Until published, clone this repo and run `npm install && npm run build`,
then invoke `node dist/src/cli.js` or `npm link` to get the `vigilagent`
command on your PATH.)

## Quickstart

```bash
# Audit the working tree's uncommitted changes
git diff | vigilagent

# Audit a specific path's uncommitted changes
vigilagent src/

# Audit a saved patch file
vigilagent ./agent-change.patch

# Audit a branch diff and write a Markdown report
git diff main...feature/agent-branch | vigilagent --markdown > report.md

# JSON output for tooling integration
git diff | vigilagent --json

# CI gate: fail the build if any HIGH severity finding is present
git diff origin/main...HEAD | vigilagent --fail-on-vuln

# Skip network registry lookups (e.g. offline, air-gapped CI)
git diff | vigilagent --no-package-check
```

## Use cases

A few concrete scenarios for where VigilAgent fits into a workflow that
already involves a coding agent:

**1. "My agent just finished a task, let me sanity-check it before I
commit."**

```bash
git diff | vigilagent
```

Run this in the same terminal pane you already review the agent's diff
in. It takes a fraction of a second on a normal-sized change and tells
you, before you `git commit`, whether the agent added a dependency that
doesn't exist, left in a swallowed exception, or reproduced text that
looks like it's talking to an AI rather than a human.

**2. "I want a CI gate that blocks agent-authored PRs with real findings,
not just style nits."**

```yaml
# .github/workflows/vigilagent.yml
name: VigilAgent Security Audit
on: pull_request
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx --yes vigilagent@latest
          "$(git diff origin/${{ github.base_ref }}...HEAD)" \
          --fail-on-vuln
```

The job fails only when there's a HIGH-severity finding, hallucinated
dependency, injected directive, swallowed exception, hardcoded secret,
or naive crypto, so it won't nag reviewers about style the way a slop
scanner does.

**3. "I want a Markdown report I can drop into a PR description or a
Slack message."**

```bash
git diff main...feature/agent-branch | vigilagent --markdown > report.md
```

Useful when a human is doing the final review pass on a large
agent-authored PR and wants a summary they can skim instead of reading
findings interleaved with the raw diff.

**4. "I'm offline, or my CI runner can't reach the public registries."**

```bash
git diff | vigilagent --no-package-check
```

Skips the network-dependent Package Hallucination Guard entirely and
still runs the Prompt Injection Auditor and AI Defect Heuristics, both of
which operate purely on the text of the diff.

**5. "I want machine-readable output for my own tooling."**

```bash
git diff | vigilagent --json | jq '.findings[] | select(.severity=="HIGH")'
```

Pipe findings into whatever bot, dashboard, or Slack webhook your team
already has for CI results.

## Usage

```
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
```

## Example output

```
$ git diff | vigilagent

VigilAgent Security Audit
Files scanned: 2

HIGH (3)
  [hallucinated-package] package.json:7
    Package "fastify-super-turbo-async-helper-totally-real" was not found on
    the npm registry. This may be a hallucinated or typosquatted dependency
    introduced by an AI coding agent.
    > fastify-super-turbo-async-helper-totally-real
  [swallowed-exception] src/payments.js:5
    Catch block contains only comments or nothing: the exception is
    swallowed with no logging, rethrow, or handling, silently hiding failures.
    > } catch (e) {
  [math-random-for-security-token] src/payments.js:10
    Math.random() is not cryptographically secure and must not be used to
    generate tokens, keys, salts, or nonces; use crypto.randomBytes /
    crypto.getRandomValues instead.
    > const token = Math.random().toString(36);

Summary: 3 finding(s), 3 HIGH severity
```

## Architecture

```
src/
  parser/diffParser.ts          Unified diff -> structured FileDiff[]/DiffHunk[]
  modules/
    packageHallucinationGuard.ts  Dependency extraction + registry lookups
    promptInjectionAuditor.ts     Regex/heuristic scan for AI-directed directives
    aiDefectHeuristics.ts         Swallowed catches, placeholder creds, naive crypto
  output/
    json.ts                       --json renderer
    markdown.ts                   --markdown renderer
    terminal.ts                   Default colored terminal renderer
  audit.ts                        Orchestrates parser + all three modules
  cli.ts                          Argument parsing, stdin/file/git-diff input, entrypoint
```

The diff parser is a dependency-free implementation of the standard
`diff --git` / `--- a/` / `+++ b/` / `@@ -l,s +l,s @@` unified diff format, so
the rest of the pipeline works on structured `FileDiff` objects rather than
raw text.

### Package Hallucination Guard

Extracts newly added dependency lines from `package.json` (inside
`dependencies` / `devDependencies` / `peerDependencies` /
`optionalDependencies` blocks), `requirements.txt`/`pyproject.toml`, and
`Cargo.toml`, then queries:

- npm: `https://registry.npmjs.org/<package>`
- PyPI: `https://pypi.org/pypi/<package>/json`
- crates.io: `https://crates.io/api/v1/crates/<package>`

A `404` is flagged as a HIGH severity `hallucinated-package` finding.
Network errors, timeouts, and non-404 error statuses are reported as INFO
severity `unverified-package` findings. VigilAgent never reports a package
as hallucinated just because the registry was unreachable.

This module is a **package-existence verifier**, not a comprehensive
supply-chain risk detector: a registry hit only confirms a name is
registered, not that its contents are safe, so a slopsquatted package
published under a hallucinated name passes this check by construction.
Reputation signals (package age, download counts, maintainer history,
provenance) are tracked as future work.

### Prompt Injection Auditor

Scans added lines that look like comments or string literals for:

- "ignore previous instructions" / "disregard the above" style overrides
- "as an AI you must..." directive phrasing
- attempts to inject a replacement system prompt
- directives instructing the agent to conceal actions from a human reviewer
- directives instructing exfiltration of secrets to an external destination
- zero-width and bidirectional-override Unicode characters (text
  steganography used to hide instructions from human reviewers while an
  agent's tokenizer still reads them)
- suspicious base64-looking blobs co-occurring with prompt/injection/decode
  keywords
- jailbreak-style keywords

### AI Defect Heuristics

- **Swallowed exceptions**: empty `catch (e) {}` blocks, catch blocks whose
  body is comment-only, and Python `except:` blocks that do nothing but
  `pass`. Detection is diff-aware: a finding only fires when the diff itself
  touched the block (so untouched pre-existing code is never flagged).
- **Hardcoded placeholder credentials**: `TODO: secure this`, literal
  placeholder passwords (`changeme`, `password123`, etc.), API keys/tokens
  assigned as string literals, AWS access key ID patterns.
- **Naive/deprecated cryptography**: `Math.random()` used for
  tokens/keys/nonces/salts, MD5/SHA-1-for-passwords/DES/3DES usage, AES-ECB
  mode.

**Language coverage**: all three modules are currently most mature for
JavaScript and Python. Go, Rust, and Java support is shallower today (the
Package Hallucination Guard covers crates.io, but the AI Defect Heuristics
patterns are tuned primarily against JS/Python idioms). Widening that
coverage is tracked as future work.

## Development

```bash
npm install
npm run build   # tsc compile to dist/
npm test        # builds, then runs node:test against dist/tests/
```

Tests use Node's built-in `node:test` + `node:assert` runner against fixture
diffs in `tests/fixtures/`, with no Jest or other test framework dependency.

Unit tests cover the detection logic; they don't exercise the CLI's actual
process-exit path against a live registry response. If you're changing
`cli.ts` or `HttpRegistryChecker`, also run the built CLI directly against
a real diff (`node dist/src/cli.js some.diff`) a few times in a row, not
just `npm test`, since that's how a real crash on exit (see
[CHANGELOG](CHANGELOG.md#011)) actually surfaced.

## Authors

VigilAgent is built and maintained by Sunil Gentyala. The design is informed
by ongoing research co-authored with:

- Sundarigari Manoj, IT Head, Associate Professor, Department of Cybersecurity,
  Anil Neerukonda Educational Institute, Visakhapatnam, India
- Vahiduddin Shariff, Assistant Professor, Department of CSE, Sir C R Reddy
  College of Engineering, Eluru, India
- Akhila Kasturi, Research Analyst Lead, HCLTech

A research paper describing VigilAgent's architecture and evaluation
methodology is currently in preparation.

## Citing this project

If you use VigilAgent in research or tooling, please cite it using the
metadata in [CITATION.cff](CITATION.cff).

## License

MIT, see [LICENSE](LICENSE).
