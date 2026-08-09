#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const account = process.env.PI_CODECKS_READONLY_AUTH_ACCOUNT;
const token = process.env.PI_CODECKS_READONLY_AUTH_TOKEN;
if (account !== "example-team" || token !== "inert-codecks-token-sentinel") process.exit(13);

// The test child implements only pi-codecks's fixed redacted exit protocol. It
// makes no HTTP request and writes no credential-bearing diagnostics.
if (process.env.PI_ONEPASSWORD_TEST_CODECKS_TRACE_FILE) {
  writeFileSync(process.env.PI_ONEPASSWORD_TEST_CODECKS_TRACE_FILE, JSON.stringify({
    argv: process.argv.slice(2),
    environmentNames: Object.keys(process.env).sort(),
  }));
}
process.exit(Number.parseInt(process.env.PI_ONEPASSWORD_TEST_CODECKS_EXIT ?? "0", 10));
