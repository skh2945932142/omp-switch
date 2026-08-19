import http, { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import type { GatewayPool, GatewayUpstream, GatewayUpstreamStat } from "./domain";

export const DEFAULT_GATEWAY_PORT = 46831;

/** Upstream requests are aborted after this long; OMP's own gateway allows 255s of idle. */
export const DEFAULT_GATEWAY_UPSTREAM_TIMEOUT_MS = 255_000;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Response headers relayed back to the caller. Everything else is dropped: `transfer-encoding`
 * and `content-length` would fight Node's own framing, and `set-cookie` would hand an upstream
 * session to whatever local process called the gateway.
 */
const RELAYED_RESPONSE_HEADERS = new Set([
  "content-type",
  "content-encoding",
  "cache-control",
  "x-request-id",
  "openai-processing-ms",
  "openai-version",
  "anthropic-version",
  "retry-after",
]);

/** Only loopback names may appear in Host, which is what stops DNS-rebinding from reaching us. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function isLoopbackHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  const withoutPort = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.split(":")[0];
  return LOOPBACK_HOSTS.has(withoutPort.toLowerCase());
}

export function generateGatewayToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Constant-time compare so a wrong token cannot be discovered byte by byte. */
export function matchesGatewayToken(expected: string, presented: string | undefined): boolean {
  if (!presented) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(presented);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function bearerFrom(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : undefined;
}

export function validateGatewayPool(pool: GatewayPool): void {

  if (!SAFE_ID.test(pool.id) || !SAFE_ID.test(pool.profile)) throw new Error("Gateway pool contains an invalid identifier");
  if (!Number.isInteger(pool.port) || pool.port < 1024 || pool.port > 65535) throw new Error("Gateway port is invalid");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:-]{0,127}$/.test(pool.virtualModel)) throw new Error("Gateway virtual model is invalid");
  if (!Array.isArray(pool.upstreams) || pool.upstreams.length === 0) throw new Error("Gateway pool needs at least one upstream");
  for (const upstream of pool.upstreams) {
    if (!SAFE_ID.test(upstream.id) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(upstream.providerId) || !/^[^\s\r\n\t]{1,160}$/.test(upstream.modelId)) throw new Error("Gateway upstream contains an invalid identifier");
    if (upstream.kind !== "secret" && upstream.kind !== "omp-auth-gateway") throw new Error("Gateway upstream kind is invalid");
    if (upstream.kind === "secret" && (!upstream.credentialId || !SAFE_ID.test(upstream.credentialId))) throw new Error("Secret gateway upstream needs a safe credential ID");
    if (upstream.credentialId && !SAFE_ID.test(upstream.credentialId)) throw new Error("Gateway credential ID is invalid");
  }
}

export interface ResolvedGatewayUpstream {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface GatewayForwarder {
  resolve(upstream: GatewayUpstream): Promise<ResolvedGatewayUpstream>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Called once per attempt so the caller can surface latency and failure counts. */
  onAttempt?(observation: { poolId: string; upstreamId: string; status?: number; latencyMs: number; error?: string }): void;
}

export interface GatewayRequest {
  path: "/v1/chat/completions" | "/v1/responses";
  body: Record<string, unknown>;
}

function joinEndpoint(baseUrl: string, requestPath: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/v1") && requestPath.startsWith("/v1/")) return `${normalized}${requestPath.slice(3)}`;
  return `${normalized}${requestPath}`;
}

export function isRetryableGatewayStatus(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

export async function forwardGatewayRequest(pool: GatewayPool, request: GatewayRequest, forwarder: GatewayForwarder): Promise<Response> {
  const candidates = pool.upstreams.filter((upstream) => upstream.enabled);
  if (candidates.length === 0) return new Response(JSON.stringify({ error: { message: "No enabled upstreams" } }), { status: 503, headers: { "content-type": "application/json" } });
  const fetchImpl = forwarder.fetchImpl ?? fetch;
  const timeoutMs = forwarder.timeoutMs ?? DEFAULT_GATEWAY_UPSTREAM_TIMEOUT_MS;
  let lastError: unknown;
  for (const upstream of candidates) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resolved = await forwarder.resolve(upstream);
      const headers = new Headers(resolved.headers);
      headers.set("content-type", "application/json");
      if (resolved.apiKey && !headers.has("authorization")) headers.set("authorization", `Bearer ${resolved.apiKey}`);
      const response = await fetchImpl(joinEndpoint(resolved.baseUrl, request.path), {
        method: "POST",
        headers,
        body: JSON.stringify({ ...request.body, model: upstream.modelId }),
        signal: controller.signal,
      });
      forwarder.onAttempt?.({ poolId: pool.id, upstreamId: upstream.id, status: response.status, latencyMs: Date.now() - startedAt });
      if (!isRetryableGatewayStatus(response.status) || upstream === candidates[candidates.length - 1]) return response;
      lastError = new Error(`Upstream returned HTTP ${response.status}`);
    } catch (error) {
      const message = (error as Error)?.name === "AbortError"
        ? `Upstream did not respond within ${timeoutMs}ms`
        : error instanceof Error ? error.message : String(error);
      lastError = new Error(message);
      forwarder.onAttempt?.({ poolId: pool.id, upstreamId: upstream.id, latencyMs: Date.now() - startedAt, error: message });
      if (upstream === candidates[candidates.length - 1]) break;
    } finally {
      clearTimeout(timer);
    }
  }
  const message = lastError instanceof Error ? lastError.message : "Gateway upstream request failed";
  return new Response(JSON.stringify({ error: { message } }), { status: 502, headers: { "content-type": "application/json" } });
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 4 * 1024 * 1024) throw new Error("Request body is too large");
    parts.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Request body must be a JSON object");
  return parsed as Record<string, unknown>;
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function copyResponse(upstream: Response, response: ServerResponse): void {
  const headers: Record<string, string> = {};
  for (const [name, value] of upstream.headers.entries()) {
    if (RELAYED_RESPONSE_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }
  response.writeHead(upstream.status, headers);
  if (!upstream.body) {
    response.end();
    return;
  }
  Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(response);
}

export interface GatewayServerOptions {
  /**
   * Bearer token every request except `/healthz` must present. Omitting it leaves the gateway open
   * to any local process, so `start` refuses to bind unless `allowAnonymous` is also set.
   */
  token?: string;
  allowAnonymous?: boolean;
}

export class GatewayServer {
  private server: http.Server | null = null;
  private readonly stats = new Map<string, GatewayUpstreamStat>();

  constructor(
    private readonly forwarder: GatewayForwarder,
    private pools: GatewayPool[],
    private readonly options: GatewayServerOptions = {},
  ) {}

  setPools(pools: GatewayPool[]): void {
    this.pools = pools;
  }

  get running(): boolean {
    return Boolean(this.server?.listening);
  }

  getStats(): GatewayUpstreamStat[] {
    return Array.from(this.stats.values());
  }

  private recordAttempt(observation: { poolId: string; upstreamId: string; status?: number; latencyMs: number; error?: string }): void {
    const key = `${observation.poolId}:${observation.upstreamId}`;
    const previous = this.stats.get(key);
    const failed = observation.error !== undefined || isRetryableGatewayStatus(observation.status);
    this.stats.set(key, {
      poolId: observation.poolId,
      upstreamId: observation.upstreamId,
      lastStatus: observation.status,
      lastLatencyMs: observation.latencyMs,
      lastAt: new Date().toISOString(),
      lastError: observation.error,
      consecutiveFailures: failed ? (previous?.consecutiveFailures ?? 0) + 1 : 0,
    });
  }

  async start(port = DEFAULT_GATEWAY_PORT): Promise<number> {
    if (!this.options.token && !this.options.allowAnonymous) {
      throw new Error("Refusing to start the gateway without a bearer token; pass allowAnonymous to opt out deliberately");
    }
    if (this.server?.listening) {
      const address = this.server.address();
      return typeof address === "object" && address ? address.port : port;
    }
    this.server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(port, "127.0.0.1", () => {
        this.server?.off("error", reject);
        resolve();
      });
    });
    const address = this.server.address();
    return typeof address === "object" && address ? address.port : port;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => this.server?.close((error) => error ? reject(error) : resolve()));
    this.server = null;
  }

  private authorize(request: IncomingMessage, response: ServerResponse): boolean {
    if (!isLoopbackHostHeader(request.headers.host)) {
      writeJson(response, 421, { error: { message: "Gateway only serves loopback Host headers" } });
      return false;
    }
    // A browser page can reach 127.0.0.1; refuse anything carrying an Origin so a web page cannot
    // spend the user's credentials, and never answer a preflight.
    if (request.headers.origin !== undefined) {
      writeJson(response, 403, { error: { message: "Cross-origin requests are not accepted" } });
      return false;
    }
    if (this.options.token && !matchesGatewayToken(this.options.token, bearerFrom(request.headers.authorization))) {
      response.writeHead(401, { "content-type": "application/json; charset=utf-8", "www-authenticate": "Bearer" });
      response.end(JSON.stringify({ error: { message: "Missing or invalid gateway bearer token" } }));
      return false;
    }
    return true;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (request.method === "GET" && path === "/healthz") {
        // Liveness stays unauthenticated, like OMP's own gateway, and exposes no pool identifiers.
        writeJson(response, 200, { ok: true, pools: this.pools.filter((pool) => pool.enabled).length, authRequired: Boolean(this.options.token) });
        return;
      }
      if (!this.authorize(request, response)) return;
      if (request.method === "GET" && path === "/v1/models") {
        writeJson(response, 200, { object: "list", data: this.pools.filter((pool) => pool.enabled).map((pool) => ({ id: pool.virtualModel, object: "model" })) });
        return;
      }
      if (request.method !== "POST" || (path !== "/v1/chat/completions" && path !== "/v1/responses")) {
        writeJson(response, 404, { error: { message: "Not found" } });
        return;
      }
      const body = await readJsonBody(request);
      const model = typeof body.model === "string" ? body.model : "";
      const pool = this.pools.find((candidate) => candidate.enabled && candidate.virtualModel === model);
      if (!pool) {
        writeJson(response, 404, { error: { message: "Unknown virtual model" } });
        return;
      }
      const forwarder: GatewayForwarder = {
        ...this.forwarder,
        resolve: (upstream) => this.forwarder.resolve(upstream),
        onAttempt: (observation) => {
          this.recordAttempt(observation);
          this.forwarder.onAttempt?.(observation);
        },
      };
      copyResponse(await forwardGatewayRequest(pool, { path, body }, forwarder), response);
    } catch (error) {
      writeJson(response, 400, { error: { message: error instanceof Error ? error.message : "Gateway request failed" } });
    }
  }
}
