# Changelog

## 0.1.1

Two real defects found and fixed during a live-CLI verification pass (not
caught by the existing unit test suite, since both only surface when the
tool runs against its actual network/CLI surface):

- **Fixed a process crash on exit.** Running the CLI against a diff whose
  new dependency *does* exist on the registry (the ordinary, common case)
  could crash the process on exit with a native libuv assertion
  (`!(handle->flags & UV_HANDLE_CLOSING)`), reproduced on Node.js 24 /
  Windows. Root cause: an explicit `process.exit()` call racing an
  in-flight `fetch()` connection teardown. Fixed by draining the response
  body in `HttpRegistryChecker` and replacing the explicit `process.exit()`
  in the CLI entrypoint with `process.exitCode`, which lets Node drain the
  event loop naturally. All CI-relevant exit codes (0 on clean/no findings,
  1 with `--fail-on-vuln` and a HIGH finding) are unchanged.
- **Fixed a false negative in the `math-random-for-security-token` rule.**
  The rule's keyword-boundary regex (`\b...\b`) does not match at a
  camelCase hump or across an underscore, so `Math.random()`-derived
  tokens named `authToken`, `sessionToken`, `_token`, etc. (extremely
  common real-world naming) went undetected, while `token` or `my_token`
  did not. Broadened the match so the keyword group no longer requires a
  literal word boundary on either side.

Both fixes are covered by the existing 19-test suite (still 19/19 passing)
plus manual live-CLI verification against real diffs and a real npm
registry lookup.

## 0.1.0

Initial release: Package Hallucination Guard, Prompt Injection Auditor,
AI Defect Heuristics, and terminal/JSON/Markdown output with a
`--fail-on-vuln` CI gate.
