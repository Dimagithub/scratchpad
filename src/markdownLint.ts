// Conservative Markdown linter. Returns a list of {line, message} (1-based line
// numbers). Heuristics are deliberately kept loose to avoid false positives on
// ordinary prose that happens to contain brackets or pipes.

export interface LintIssue {
  line: number;
  message: string;
}

function isFence(line: string): boolean {
  // ``` or ~~~ optionally indented, possibly with an info string.
  return /^\s{0,3}(```|~~~)/.test(line);
}

function atxHeadingLevel(line: string): number | null {
  const m = /^\s{0,3}(#{1,6})(\s|$)/.exec(line);
  return m ? m[1].length : null;
}

// A table separator row: only |, -, :, and whitespace, containing at least one -.
function isTableSeparator(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (!/-/.test(t)) return false;
  return /^\|?[\s:\-|]+\|?$/.test(t) && /^[\s:\-|]+$/.test(t);
}

// Count table columns from a pipe row, ignoring leading/trailing pipe delimiters.
function columnCount(line: string): number {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").length;
}

function looksLikeTableRow(line: string): boolean {
  return line.includes("|") && line.trim().length > 0;
}

export function lintMarkdown(text: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const lines = text.split("\n");

  // --- Fenced code blocks: track open/closed to (a) report unclosed and
  //     (b) skip link/table checks inside code. ---
  let fenceCount = 0;
  const inCode: boolean[] = [];
  let open = false;
  for (let i = 0; i < lines.length; i++) {
    if (isFence(lines[i])) {
      fenceCount++;
      // The fence line itself belongs to the code region boundary.
      inCode[i] = true;
      open = !open;
    } else {
      inCode[i] = open;
    }
  }
  if (fenceCount % 2 !== 0) {
    // Report on the last fence line that left a block open.
    let lastFence = 1;
    for (let i = 0; i < lines.length; i++) if (isFence(lines[i])) lastFence = i + 1;
    issues.push({ line: lastFence, message: "Unclosed fenced code block" });
  }

  // --- Broken link/image syntax + heading jumps ---
  let prevHeading: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inCode[i] && !isFence(line)) continue;

    // Broken link/image: a `](` that has no closing `)` after it on the line.
    const linkIdx = line.indexOf("](");
    if (linkIdx !== -1) {
      const after = line.slice(linkIdx + 2);
      if (!after.includes(")")) {
        issues.push({ line: i + 1, message: "Broken link/image: missing closing ')'" });
      }
    }

    // Heading-level jump (skip inside code).
    if (!inCode[i]) {
      const level = atxHeadingLevel(line);
      if (level !== null) {
        if (prevHeading !== null && level > prevHeading + 1) {
          issues.push({
            line: i + 1,
            message: `Heading level jumps from ${prevHeading} to ${level}`,
          });
        }
        prevHeading = level;
      }
    }
  }

  // --- Malformed tables ---
  for (let i = 0; i < lines.length; i++) {
    if (inCode[i]) continue;
    const line = lines[i];
    // A header candidate: has a pipe, next line exists.
    if (!looksLikeTableRow(line)) continue;
    const next = lines[i + 1];
    if (next === undefined) continue;
    // Only treat as a table header if the following line looks like it's meant
    // to be a separator (contains dashes and pipe/colon chars) — conservative.
    const nextLooksSeparatorish =
      next.includes("-") && /^[\s:\-|]+$/.test(next.trim()) && next.trim().length > 0;
    const nextIsPipeRow = looksLikeTableRow(next);
    if (!nextLooksSeparatorish && !nextIsPipeRow) continue;

    // Require the header itself to have at least 2 columns to be a real table.
    const headerCols = columnCount(line);
    if (headerCols < 2) continue;

    if (!isTableSeparator(next)) {
      // A pipe row immediately under a header, but not a valid separator.
      if (nextLooksSeparatorish) {
        issues.push({ line: i + 2, message: "Malformed table: invalid separator row" });
      }
      // If next is just another pipe row (no dashes), this isn't a table; skip.
      continue;
    }

    // Valid header + separator: check body rows' column counts.
    for (let j = i + 2; j < lines.length; j++) {
      if (inCode[j]) break;
      if (!looksLikeTableRow(lines[j])) break;
      if (isTableSeparator(lines[j])) continue;
      if (columnCount(lines[j]) !== headerCols) {
        issues.push({
          line: j + 1,
          message: `Malformed table: row has ${columnCount(lines[j])} columns, expected ${headerCols}`,
        });
      }
    }
    // Skip past the consumed table to avoid re-flagging the header rows.
    // (Loop continues naturally; separator lines aren't table headers.)
  }

  issues.sort((a, b) => a.line - b.line);
  return issues;
}
