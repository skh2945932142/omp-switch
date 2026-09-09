/** LCS line diff. Config files are small, so the O(n·m) table is fine and always correct. */
export interface DiffLine { kind: "add" | "del" | "ctx" | "gap"; text: string }

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: "ctx", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: "del", text: a[i] }); i++; }
    else { out.push({ kind: "add", text: b[j] }); j++; }
  }
  while (i < a.length) { out.push({ kind: "del", text: a[i] }); i++; }
  while (j < b.length) { out.push({ kind: "add", text: b[j] }); j++; }
  return out;
}

/** Collapses runs of unchanged lines to ±radius around edits, so a whole file never scrolls by. */
export function trimContext(lines: DiffLine[], radius = 3): DiffLine[] {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === "ctx") return;
    for (let k = Math.max(0, index - radius); k <= Math.min(lines.length - 1, index + radius); k++) keep[k] = true;
  });
  const out: DiffLine[] = [];
  let gapping = false;
  lines.forEach((line, index) => {
    if (keep[index]) { out.push(line); gapping = false; }
    else if (!gapping) { out.push({ kind: "gap", text: "…" }); gapping = true; }
  });
  return out;
}
