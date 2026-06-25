// Copies test fixture files into dist/ so compiled tests (dist/tests/*.test.js)
// can load them via relative paths next to themselves, mirroring the
// tests/fixtures/ layout in the TypeScript source tree.
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(root, "tests", "fixtures");
const dest = path.join(root, "dist", "tests", "fixtures");

if (existsSync(src)) {
  cpSync(src, dest, { recursive: true });
  console.log(`Copied fixtures: ${src} -> ${dest}`);
}
