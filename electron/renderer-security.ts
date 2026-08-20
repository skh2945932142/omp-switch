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
