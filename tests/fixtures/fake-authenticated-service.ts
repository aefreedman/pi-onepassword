import { createServer, type Server } from "node:http";

export type FakeAuthenticatedServiceMode = "success" | "rejected" | "malformed" | "oversized" | "timeout";

// Must match the packaged client's literal-only Phase 3A destination.
export const FIXED_AUTHENTICATED_SERVICE_HOST = "127.0.0.1";
export const FIXED_AUTHENTICATED_SERVICE_PORT = 43_123;
export type FakeAuthenticatedService = Readonly<{
  requests: readonly Readonly<{ method: string | undefined; url: string | undefined; authorization: string | undefined }>[];
  close(): Promise<void>;
}>;

/** A loopback-only, inert authenticated identity endpoint for deterministic tests. */
export async function startFakeAuthenticatedService(mode: FakeAuthenticatedServiceMode): Promise<FakeAuthenticatedService> {
  const requests: { method: string | undefined; url: string | undefined; authorization: string | undefined }[] = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
    if (request.method !== "GET" || request.url !== "/v1/identity") {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== "Bearer inert-resolved-secret-sentinel" || mode === "rejected") {
      response.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}');
      return;
    }
    if (mode === "timeout") return;
    if (mode === "malformed") {
      response.writeHead(200, { "content-type": "application/json" }).end('{"identity":"inert-resolved-secret-sentinel"');
      return;
    }
    if (mode === "oversized") {
      response.writeHead(200, { "content-type": "application/json" }).end(`{"padding":"${"x".repeat(2_048)}"}`);
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end('{"identity":"fixed-fake-service","connectivity":"ok"}');
  });
  await listenLoopback(server);
  return Object.freeze({
    requests,
    close: () => closeServer(server),
  });
}

function listenLoopback(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(FIXED_AUTHENTICATED_SERVICE_PORT, FIXED_AUTHENTICATED_SERVICE_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
