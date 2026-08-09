#!/usr/bin/env node
import http from "node:http";

// Package-owned fixed child for the deterministic loopback integration. It
// accepts no operation, method, destination, or credential selection. The
// literal destination deliberately cannot be redirected by arguments or env.
const token = process.env.PI_ONEPASSWORD_FIXED_AUTH_TOKEN;

if (!token) process.exit(14);

const request = httpRequest(new URL("http://127.0.0.1:43123/v1/identity"), token);
request.on("response", (response) => {
  let bytes = 0;
  const chunks = [];
  response.on("data", (chunk) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 1024) {
      request.destroy();
      process.exitCode = 12;
    } else {
      chunks.push(chunk);
    }
  });
  response.on("end", () => {
    if (process.exitCode) return;
    if (response.statusCode === 401) {
      process.exitCode = 10;
      return;
    }
    const contentType = response.headers["content-type"];
    if (response.statusCode !== 200 || typeof contentType !== "string" || !contentType.startsWith("application/json")) {
      process.exitCode = 11;
      return;
    }
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      process.exitCode = body?.identity === "fixed-fake-service" && body?.connectivity === "ok" ? 0 : 11;
    } catch {
      process.exitCode = 11;
    }
  });
});
// runBoundedOpRun() owns the configurable operation deadline. Do not add a
// client-level socket timer: it could preempt that deadline and misclassify it.
request.on("error", () => { if (!process.exitCode) process.exitCode = 14; });
request.end();

function httpRequest(url, token) {
  return http.request(url, {
    method: "GET",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
}
