import test from "node:test";
import assert from "node:assert/strict";
import { parseDiff, addedLines, removedLines } from "../src/parser/diffParser.js";

test("parses a simple single-file diff with one hunk", () => {
  const diffText = `diff --git a/src/utils.js b/src/utils.js
index 1111111..2222222 100644
--- a/src/utils.js
+++ b/src/utils.js
@@ -1,4 +1,9 @@
 function add(a, b) {
   return a + b;
 }
+
+function multiply(a, b) {
+  return a * b;
+}
`;

  const parsed = parseDiff(diffText);
  assert.equal(parsed.files.length, 1);
  const file = parsed.files[0];
  assert.equal(file.path, "src/utils.js");
  assert.equal(file.hunks.length, 1);

  const added = addedLines(file);
  assert.equal(added.length, 4);
  assert.match(added[1].content, /function multiply/);
  assert.equal(removedLines(file).length, 0);
});

test("parses multiple files and detects new file mode", () => {
  const diffText = `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,1 +1,2 @@
 hello
+world
diff --git a/b.txt b/b.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/b.txt
@@ -0,0 +1,2 @@
+line one
+line two
`;

  const parsed = parseDiff(diffText);
  assert.equal(parsed.files.length, 2);
  assert.equal(parsed.files[0].path, "a.txt");
  assert.equal(parsed.files[1].path, "b.txt");
  assert.equal(parsed.files[1].isNew, true);
  assert.equal(addedLines(parsed.files[1]).length, 2);
});

test("tracks removed lines and line numbers", () => {
  const diffText = `diff --git a/x.js b/x.js
index 1111111..2222222 100644
--- a/x.js
+++ b/x.js
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
`;
  const parsed = parseDiff(diffText);
  const file = parsed.files[0];
  const removed = removedLines(file);
  const added = addedLines(file);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].content, "const b = 2;");
  assert.equal(added.length, 1);
  assert.equal(added[0].content, "const b = 3;");
  assert.equal(added[0].newLineNumber, 2);
});
