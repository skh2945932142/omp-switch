import type { SessionMessagePreview, SessionSummary } from "@omp-switch/core";
import { formatDateTime, formatClock } from "../../locale";

export function generateSessionMarkdown(session: SessionSummary, msgs: SessionMessagePreview[]): string {
  const lines: string[] = [
    `# ${session.title ?? session.model ?? "OMP Session"}`,
    ``,
    `- **Session ID**: \`${session.id}\``,
    `- **Model**: \`${session.provider ?? "—"}/${session.model ?? "—"}\``,
    `- **Started**: ${session.startedAt ? formatDateTime(session.startedAt) : "—"}`,
    `- **Messages**: ${session.messageCount}`,
    `- **Tokens**: ${Object.entries(session.tokens).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}`,
    `- **Cost**: $${session.cost.toFixed(4)}`,
    ``,
    `---`,
    ``,
  ];
  for (const msg of msgs) {
    const roleLabel = msg.role === "user" ? "👤 User" : msg.role === "assistant" ? "🤖 Assistant" : `⚙️ ${msg.role}`;
    const time = msg.timestamp ? ` (${formatClock(msg.timestamp)})` : "";
    const modelTag = msg.provider && msg.model ? ` [${msg.provider}/${msg.model}]` : "";
    lines.push(`### ${roleLabel}${modelTag}${time}`);
    lines.push(``);
    lines.push(msg.text || "(empty)");
    lines.push(``);
  }
  return lines.join("\n");
}

export function generateSessionJson(session: SessionSummary, msgs: SessionMessagePreview[]): string {
  return JSON.stringify({ summary: session, messages: msgs }, null, 2);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMessageTextHtml(text: string): string {
  if (!text) return '<span class="empty">(empty)</span>';

  let processed = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_, thinkContent) => {
    return `<details class="thinking-box"><summary class="thinking-summary">🧠 思考过程 (${thinkContent.trim().length} 字)</summary><div class="thinking-content">${escapeHtml(thinkContent.trim())}</div></details>`;
  });

  processed = processed.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<div class="code-block"><div class="code-header"><span>${escapeHtml(lang || "text")}</span></div><pre class="code-body"><code>${escapeHtml(code.trimEnd())}</code></pre></div>`;
  });

  const segments = processed.split(/(\n\n+)/);
  return segments.map((seg) => {
    if (seg.startsWith("<details") || seg.startsWith("<div class=\"code-block\"")) return seg;
    if (/^\n+$/.test(seg)) return "";
    return `<p>${escapeHtml(seg).replace(/\n/g, "<br/>")}</p>`;
  }).join("");
}

export function generateSessionHtml(session: SessionSummary, msgs: SessionMessagePreview[]): string {
  const title = escapeHtml(session.title ?? session.model ?? "OMP Session");
  const model = escapeHtml(`${session.provider ?? "—"}/${session.model ?? "—"}`);
  const started = session.startedAt ? escapeHtml(formatDateTime(session.startedAt)) : "—";
  const tokens = Object.entries(session.tokens).map(([k, v]) => `${k}: ${v}`).join(", ") || "—";

  const messageItems = msgs.map((msg) => {
    const isUser = msg.role === "user";
    const roleName = isUser ? "User" : msg.role === "assistant" ? "Assistant" : msg.role;
    const time = msg.timestamp ? formatClock(msg.timestamp) : "";
    const modelTag = msg.provider && msg.model ? ` · ${escapeHtml(msg.provider)}/${escapeHtml(msg.model)}` : "";
    const htmlBody = formatMessageTextHtml(msg.text);

    return `
    <article class="message ${isUser ? "user" : "assistant"}">
      <header class="message-header">
        <span class="role-badge ${isUser ? "user" : "assistant"}">${roleName}</span>
        <span class="meta">${time}${modelTag}</span>
      </header>
      <div class="message-body">${htmlBody}</div>
    </article>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - OMP Switch Session</title>
  <style>
    :root {
      --bg: #0e0e11;
      --card: #151518;
      --card-user: #182234;
      --border: #27272e;
      --text: #e6e6ed;
      --muted: #8e8e9c;
      --accent: #3b82f6;
      --accent-soft: rgba(59, 130, 246, 0.15);
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f8f9fa;
        --card: #ffffff;
        --card-user: #eff6ff;
        --border: #e2e8f0;
        --text: #1e293b;
        --muted: #64748b;
        --accent: #2563eb;
        --accent-soft: rgba(37, 99, 235, 0.1);
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      line-height: 1.6;
      padding: 32px 16px;
      display: flex;
      justify-content: center;
    }
    .container {
      width: 100%;
      max-width: 860px;
    }
    header.report-head {
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }
    h1 { font-size: 24px; font-weight: 650; margin-bottom: 12px; }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
      font-size: 13px;
      color: var(--muted);
    }
    .meta-item strong { color: var(--text); }
    .messages-list { display: flex; flex-direction: column; gap: 16px; margin-top: 24px; }
    .message {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
    }
    .message.user {
      background: var(--card-user);
      border-color: rgba(59, 130, 246, 0.3);
    }
    .message-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .role-badge {
      font-size: 12px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 6px;
    }
    .role-badge.user { background: var(--accent); color: #fff; }
    .role-badge.assistant { background: var(--accent-soft); color: var(--accent); }
    .meta { font-size: 12px; color: var(--muted); font-family: var(--mono); }
    .message-body { font-size: 14.5px; }
    .message-body p { margin-bottom: 10px; }
    .message-body p:last-child { margin-bottom: 0; }
    .code-block {
      background: #000;
      border: 1px solid var(--border);
      border-radius: 8px;
      margin: 12px 0;
      overflow: hidden;
      font-family: var(--mono);
      font-size: 13px;
    }
    .code-header {
      background: rgba(255, 255, 255, 0.05);
      padding: 4px 12px;
      font-size: 11px;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
    }
    .code-body { padding: 12px; overflow-x: auto; color: #f1f5f9; }
    .thinking-box {
      background: rgba(142, 142, 156, 0.08);
      border: 1px dashed var(--border);
      border-radius: 8px;
      margin: 10px 0;
      padding: 8px 12px;
      font-size: 13px;
    }
    .thinking-summary { cursor: pointer; color: var(--muted); font-weight: 500; }
    .thinking-content { margin-top: 8px; color: var(--muted); font-family: var(--mono); white-space: pre-wrap; font-size: 12.5px; }
    @media print {
      body { background: #fff; color: #000; padding: 0; }
      .message { break-inside: avoid; border: 1px solid #ccc; background: #fff; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="report-head">
      <h1>${title}</h1>
      <div class="meta-grid">
        <div class="meta-item">模型: <strong>${model}</strong></div>
        <div class="meta-item">时间: <strong>${started}</strong></div>
        <div class="meta-item">消息数: <strong>${session.messageCount}</strong></div>
        <div class="meta-item">花费: <strong>$${session.cost.toFixed(4)}</strong></div>
        <div class="meta-item">Tokens: <strong>${tokens}</strong></div>
      </div>
    </header>
    <main class="messages-list">
      ${messageItems}
    </main>
  </div>
</body>
</html>`;
}
