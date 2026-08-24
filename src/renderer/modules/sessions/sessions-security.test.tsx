import { describe, it, expect } from "vitest";
import { renderSafeSnippet } from "./sessions-module";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

describe("FTS Snippet XSS Sanitization", () => {
  it("renders highlight marks as text elements without executing scripts or injecting raw HTML", () => {
    const malicious = '<img src=x onerror=alert(1)> <script>alert("pwned")</script> <mark>matched keyword</mark> trailing text';
    const element = renderSafeSnippet(malicious);
    expect(element).not.toBeNull();
    
    // Render to static HTML string
    const html = renderToStaticMarkup(<div>{element}</div>);
    
    // The HTML output MUST contain escaped entities &lt;img and &lt;script, NEVER unescaped tags!
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt;');
    
    // The mark tag MUST be properly rendered
    expect(html).toContain('<mark>matched keyword</mark>');
  });

  it("handles null, empty, or normal strings safely", () => {
    expect(renderSafeSnippet("")).toBeNull();
    const html = renderToStaticMarkup(<div>{renderSafeSnippet("normal text without highlights")}</div>);
    expect(html).toContain("normal text without highlights");
  });
});
