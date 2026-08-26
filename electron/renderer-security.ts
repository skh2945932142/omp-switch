export function isLoopbackHttpUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1" || parsed.hostname === "[::1]");
  } catch {
    return false;
  }
}

export function mayUseDevRenderer(isPackaged: boolean, value: string | undefined): boolean {
  return !isPackaged && isLoopbackHttpUrl(value);
}

export function blockRendererNavigation(event: { preventDefault(): void }): void {
  event.preventDefault();
}

export function denyRendererWindowOpen(): { action: "deny" } {
  return { action: "deny" };
}

export function getContentSecurityPolicy(isDev: boolean): string {
  if (isDev) {
    return "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: http:; object-src 'none'; base-uri 'none'; form-action 'none'";
  }
  return "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
}
