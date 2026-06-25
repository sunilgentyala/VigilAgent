/**
 * Parser for unified git diff / patch text into structured per-file hunks.
 *
 * Supports the standard `diff --git a/<path> b/<path>` header format followed
 * by `--- a/<path>` / `+++ b/<path>` file markers and `@@ -l,s +l,s @@` hunk
 * headers, as produced by `git diff`, `git show`, and most `.patch` files.
 */

export type LineKind = "added" | "removed" | "context";

export interface DiffLine {
  kind: LineKind;
  /** Line content with the leading +/-/space marker stripped. */
  content: string;
  /** 1-based line number in the new file (only set for added/context lines). */
  newLineNumber?: number;
  /** 1-based line number in the old file (only set for removed/context lines). */
  oldLineNumber?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  /** Path as it appears after the change (b/ side). Falls back to old path for deletions. */
  path: string;
  oldPath: string;
  newPath: string;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
  hunks: DiffHunk[];
}

export interface ParsedDiff {
  files: FileDiff[];
}

const DIFF_GIT_RE = /^diff --git a\/(.+?) b\/(.+)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Parse unified diff text into a structured representation.
 */
export function parseDiff(diffText: string): ParsedDiff {
  const lines = diffText.split(/\r?\n/);
  const files: FileDiff[] = [];

  let currentFile: FileDiff | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLineCursor = 0;
  let newLineCursor = 0;

  const pushFile = () => {
    if (currentFile) {
      files.push(currentFile);
    }
    currentFile = null;
    currentHunk = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const gitHeaderMatch = DIFF_GIT_RE.exec(line);
    if (gitHeaderMatch) {
      pushFile();
      const [, a, b] = gitHeaderMatch;
      currentFile = {
        path: b,
        oldPath: a,
        newPath: b,
        isNew: false,
        isDeleted: false,
        isRenamed: a !== b,
        hunks: [],
      };
      continue;
    }

    if (!currentFile) {
      // Ignore preamble lines (e.g. "From <sha>", commit messages) that
      // precede the first `diff --git` line.
      continue;
    }

    if (line.startsWith("new file mode")) {
      currentFile.isNew = true;
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      currentFile.isDeleted = true;
      continue;
    }
    if (line.startsWith("--- ")) {
      const path = line.slice(4).trim();
      if (path !== "/dev/null") {
        currentFile.oldPath = path.replace(/^a\//, "");
      } else {
        currentFile.isNew = true;
      }
      continue;
    }
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();
      if (path !== "/dev/null") {
        currentFile.newPath = path.replace(/^b\//, "");
        currentFile.path = currentFile.newPath;
      } else {
        currentFile.isDeleted = true;
      }
      continue;
    }
    if (
      line.startsWith("index ") ||
      line.startsWith("similarity index") ||
      line.startsWith("rename from") ||
      line.startsWith("rename to") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode")
    ) {
      continue;
    }

    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (hunkMatch) {
      const [, oldStartStr, oldLinesStr, newStartStr, newLinesStr] = hunkMatch;
      currentHunk = {
        header: line,
        oldStart: parseInt(oldStartStr, 10),
        oldLines: oldLinesStr ? parseInt(oldLinesStr, 10) : 1,
        newStart: parseInt(newStartStr, 10),
        newLines: newLinesStr ? parseInt(newLinesStr, 10) : 1,
        lines: [],
      };
      currentFile.hunks.push(currentHunk);
      oldLineCursor = currentHunk.oldStart;
      newLineCursor = currentHunk.newStart;
      continue;
    }

    if (!currentHunk) {
      // Outside of a hunk body and not a recognized header; skip.
      continue;
    }

    if (line.startsWith("\\ No newline at end of file")) {
      continue;
    }

    if (line.startsWith("+")) {
      currentHunk.lines.push({
        kind: "added",
        content: line.slice(1),
        newLineNumber: newLineCursor,
      });
      newLineCursor++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({
        kind: "removed",
        content: line.slice(1),
        oldLineNumber: oldLineCursor,
      });
      oldLineCursor++;
    } else if (line.startsWith(" ") || line === "") {
      currentHunk.lines.push({
        kind: "context",
        content: line.slice(1),
        oldLineNumber: oldLineCursor,
        newLineNumber: newLineCursor,
      });
      oldLineCursor++;
      newLineCursor++;
    }
    // Any other line (e.g. trailing metadata) is ignored.
  }

  pushFile();

  return { files };
}

/** Returns only the lines that were added, across all hunks of a file. */
export function addedLines(file: FileDiff): DiffLine[] {
  return file.hunks.flatMap((h) => h.lines.filter((l) => l.kind === "added"));
}

/** Returns only the lines that were removed, across all hunks of a file. */
export function removedLines(file: FileDiff): DiffLine[] {
  return file.hunks.flatMap((h) => h.lines.filter((l) => l.kind === "removed"));
}
