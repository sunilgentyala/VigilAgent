// Explicitly enumerates compiled test files and passes them to node:test as
// individual file arguments. node --test's directory/glob handling for
// positional paths is inconsistent across Node 18/20/22/24 and between
// Windows and POSIX shells, so we avoid relying on it entirely.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const testDir = path.join(root, "dist", "tests");

function findTestFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findTestFiles(full));
    } else if (entry.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

const files = findTestFiles(testDir);
if (files.length === 0) {
  console.error(`No .test.js files found under ${testDir}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
