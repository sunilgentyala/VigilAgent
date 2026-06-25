# Contributing to VigilAgent

Thanks for your interest in improving VigilAgent. This project is a security
auditing CLI for AI-agent-authored code changesets, and contributions of new
detection rules, parser robustness fixes, and output formats are all welcome.

## Getting started

1. Fork the repository and clone your fork.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```
4. Run the test suite:
   ```bash
   npm test
   ```

All three commands should complete with no errors before you start making
changes, and again before you open a pull request.

## Project structure

- `src/parser/`: the unified diff parser. Changes here affect every module,
  so be conservative and add fixtures for any new diff shape you need to
  support.
- `src/modules/`: the three detection modules:
  - `packageHallucinationGuard.ts`: dependency manifest parsing and registry
    lookups (npm, PyPI, crates.io).
  - `promptInjectionAuditor.ts`: regex/heuristic scanning for AI-directed
    directives smuggled into comments/strings.
  - `aiDefectHeuristics.ts`: swallowed exceptions, placeholder credentials,
    naive cryptography.
- `src/output/`: JSON, Markdown, and terminal renderers.
- `src/cli.ts`: argument parsing and entrypoint wiring.
- `tests/`: `node:test` unit tests with fixture diffs under
  `tests/fixtures/`.

## Adding a new detection rule

1. Add the regex/heuristic to the relevant module, following the existing
   `DefectRule` / `InjectionRule` shape so severity and rule IDs stay
   consistent.
2. Add a fixture diff under `tests/fixtures/` that exercises the new
   pattern, plus a corresponding negative case if there's a realistic
   false-positive risk.
3. Add a `node:test` covering both the positive and negative case.
4. Run `npm test` and confirm everything passes.

## Code style

- TypeScript, strict mode. No `any` unless genuinely unavoidable.
- No stub/TODO code paths; every code path should do something real.
- Network calls must fail gracefully (treat unreachable registries as
  "unverified," never crash the process and never silently report a false
  vulnerability).
- Keep modules independent: each detector should be runnable and testable in
  isolation from the others.

## Reporting issues

Please include:
- The CLI flags you ran.
- The diff (or a minimal reproduction) that triggered the unexpected
  behavior.
- What you expected vs. what happened.

## Pull requests

- Keep PRs focused on one change.
- Include or update tests for any behavior change.
- Update the README if you add a flag, module, or output format.
