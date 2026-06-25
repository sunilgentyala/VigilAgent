# VigilAgent

Security auditing CLI for AI-agent-authored code changesets — diffs produced
by Claude Code, Cursor, Copilot Workspace, and similar coding agents.

VigilAgent reads a unified diff and runs three security-focused detectors
that none of the existing terminal diff/review tools cover, then renders the
findings as colored terminal output, JSON, or Markdown, with an optional
CI exit-code gate.

## Why VigilAgent

Terminal diff and review tools have converged on visualization and review
ergonomics: [hunk](https://github.com/modem-dev/hunk) and
[codiff](https://github.com/modem-dev/codiff) are built for agent workflows
but don't audit content; [difftastic](https://github.com/Wilfred/difftastic),
[delta](https://github.com/dandavison/delta), and
[diffnav](https://github.com/dandavison/diffnav) render diffs beautifully but
perform no security checks at all; "AI slop" scanners like
[slop-scan](https://github.com/modem-dev/slop-scan) catch style and dead-code
smells, not security defects.

None of them close these gaps, which are specific to AI-agent-authored code:

1. **Package hallucination** — coding agents occasionally invent
   plausible-sounding package names that don't exist on the real registry,
   or get talked into adding a typosquatted lookalike. Nothing cross-checks
   newly added `package.json` / `requirements.txt` / `Cargo.toml` entries
   against the live npm/PyPI/crates.io registries.
2. **Indirect prompt injection in generated code** — an agent that ingests an
   issue, ticket, or third-party doc can reproduce embedded directives
   ("ignore previous instructions", "as an AI you must...") verbatim into
   comments or strings in the diff it produces. No reviewed tool scans for
   this.
3. **AI-specific defect heuristics** — swallowed exceptions that mask real
   failures, hardcoded placeholder credentials left over from a scaffold,
   and naive/deprecated cryptography (`Math.random()` for tokens, MD5, DES)
   show up disproportionately often in agent-authored diffs and aren't what
   generic slop scanners look for.
4. **CI gating keyed to security, not style** — `--fail-on-vuln` gives you a
   single exit-code gate for HIGH severity findings, suitable for a
   pre-merge check on agent-authored branches.

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
    Catch block contains only comments or nothing — the exception is
    swallowed with no logging, rethrow, or handling, silently hiding failures.
    > } catch (e) {
  [math-random-for-security-token] src/payments.js:10
    Math.random() is not cryptographically secure and must not be used to
    generate tokens, keys, salts, or nonces; use crypto.randomBytes /
    crypto.getRandomValues instead.
    > const token = Math.random().toString(36);

Summary: 3 finding(s) — 3 HIGH severity
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
severity `unverified-package` findings — VigilAgent never reports a package
as hallucinated just because the registry was unreachable.

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

- **Swallowed exceptions** — empty `catch (e) {}` blocks, catch blocks whose
  body is comment-only, and Python `except:` blocks that do nothing but
  `pass`. Detection is diff-aware: a finding only fires when the diff itself
  touched the block (so untouched pre-existing code is never flagged).
- **Hardcoded placeholder credentials** — `TODO: secure this`, literal
  placeholder passwords (`changeme`, `password123`, etc.), API keys/tokens
  assigned as string literals, AWS access key ID patterns.
- **Naive/deprecated cryptography** — `Math.random()` used for
  tokens/keys/nonces/salts, MD5/SHA-1-for-passwords/DES/3DES usage, AES-ECB
  mode.

## Development

```bash
npm install
npm run build   # tsc compile to dist/
npm test        # builds, then runs node:test against dist/tests/
```

Tests use Node's built-in `node:test` + `node:assert` runner against fixture
diffs in `tests/fixtures/` — no Jest or other test framework dependency.

## License

MIT — see [LICENSE](LICENSE).
