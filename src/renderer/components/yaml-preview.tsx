import { useState } from "react";
import type { ReactElement } from "react";
import { FileText } from "lucide-react";

/**
 * Lightweight YAML preview with file tabs, line numbers, and four-color syntax highlighting.
 *
 * The highlighter is a hand-written tokenizer — no dependency, no Shiki/prism. It colors comments,
 * keys, strings, and numbers using design tokens so the dual-track light-dark theme applies for free.
 * It is deliberately conservative: it only recolors tokens it is confident about and leaves the rest
 * as default text, so an unfamiliar YAML shape never renders as a wall of one color.
 */

type TokenKind = "comment" | "key" | "string" | "number" | "punct" | "text";

interface Token {
  kind: TokenKind;
  value: string;
}

/** Split a single YAML line into tokens. Operates on one line so block scalars (|, >) stay simple. */
function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = line.length;

  // Leading whitespace is preserved as plain text so indentation survives.
  while (i < n && (line[i] === " " || line[i] === "\t")) {
    tokens.push({ kind: "text", value: line[i] });
    i++;
  }
  if (i >= n) return tokens;

  // Full-line comment.
  if (line[i] === "#") {
    tokens.push({ kind: "comment", value: line.slice(i) });
    return tokens;
  }

  // Document markers and list dashes are punctuation.
  if (line[i] === "-" && (i + 1 >= n || line[i + 1] === " ")) {
    tokens.push({ kind: "punct", value: "-" });
    i++;
    while (i < n && line[i] === " ") { tokens.push({ kind: "text", value: " " }); i++; }
  }

  // Try to read a key: "identifier:" where identifier is path-safe. A quoted key still counts.
  const keyMatch = readKey(line, i);
  if (keyMatch) {
    tokens.push({ kind: "key", value: keyMatch.key });
    i = keyMatch.end;
    if (i < n && line[i] === ":") {
      tokens.push({ kind: "punct", value: ":" });
      i++;
    }
  }

  // Rest of the line: values (strings, numbers, inline comments, plain scalars).
  while (i < n) {
    const ch = line[i];
    if (ch === " " || ch === "\t") { tokens.push({ kind: "text", value: ch }); i++; continue; }
    if (ch === "#") { tokens.push({ kind: "comment", value: line.slice(i) }); break; }
    if (ch === '"' || ch === "'") {
      const end = readQuoted(line, i, ch);
      tokens.push({ kind: "string", value: line.slice(i, end) });
      i = end;
      continue;
    }
    if (ch === "{" || ch === "}" || ch === "[" || ch === "]" || ch === "," || ch === ":") {
      tokens.push({ kind: "punct", value: ch }); i++; continue;
    }
    // Number? A run of digits / dots / sign that starts with a digit or sign+digit.
    const num = readNumber(line, i);
    if (num) {
      tokens.push({ kind: "number", value: num });
      i += num.length;
      continue;
    }
    // Plain scalar — read until the next delimiter so words don't get split char by char.
    const scalar = readScalar(line, i);
    tokens.push({ kind: "text", value: scalar });
    i += scalar.length;
  }
  return tokens;
}

function readKey(line: string, start: number): { key: string; end: number } | null {
  const n = line.length;
  let i = start;
  if (line[i] === '"' || line[i] === "'") {
    const end = readQuoted(line, i, line[i]);
    // A quoted key must be followed by ':'.
    if (end < n && line[end] === ":") return { key: line.slice(i, end), end };
    return null;
  }
  // Unquoted key: read until ':' or whitespace. Must contain something and be followed by ':'.
  let j = i;
  while (j < n && line[j] !== ":" && line[j] !== " " && line[j] !== "\t" && line[j] !== "#") j++;
  if (j > i && j < n && line[j] === ":") return { key: line.slice(i, j), end: j };
  return null;
}

function readQuoted(line: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < line.length) {
    if (line[i] === "\\") { i += 2; continue; }
    if (line[i] === quote) return i + 1;
    i++;
  }
  return line.length;
}

function readNumber(line: string, start: number): string | null {
  const rest = line.slice(start);
  const match = rest.match(/^[+-]?\d[\d._]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?/);
  return match ? match[0] : null;
}

function readScalar(line: string, start: number): string {
  let j = start;
  while (j < line.length && !":{}[],#\"'".includes(line[j]) && line[j] !== " " && line[j] !== "\t") j++;
  return line.slice(start, j);
}

const TOKEN_CLASS: Record<TokenKind, string> = {
  comment: "yml-comment",
  key: "yml-key",
  string: "yml-string",
  number: "yml-number",
  punct: "yml-punct",
  text: "yml-text",
};

interface YamlFile {
  name: string;
  content: string;
}

export function YamlPreview({ files }: { files: YamlFile[] }): ReactElement | null {
  const [active, setActive] = useState(0);
  if (files.length === 0) return null;
  const file = files[Math.min(active, files.length - 1)] ?? files[0];
  const lines = file.content.split("\n");

  return <div className="yaml-viewer">
    <div className="yml-tabs" role="tablist">
      {files.map((f, index) => <button
        key={f.name}
        type="button"
        role="tab"
        aria-selected={index === active}
        className={`yml-tab${index === active ? " active" : ""}`}
        onClick={() => setActive(index)}
      >
        <FileText size={13} />{f.name}
      </button>)}
    </div>
    <div className="yml-body">
      <pre className="yml-code">{lines.map((line, index) => <div className="yml-line" key={index}>
        <span className="yml-lineno">{index + 1}</span>
        <span className="yml-linecontent">{line.length === 0 ? " " : tokenizeLine(line).map((token, ti) =>
          <span key={ti} className={TOKEN_CLASS[token.kind]}>{token.value}</span>)}</span>
      </div>)}</pre>
    </div>
  </div>;
}
