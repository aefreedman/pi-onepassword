import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { packageRoot, pack, runNpm } from "./package-archive.mjs";

const codecksPackageRoot = path.resolve(packageRoot, "..", "pi-codecks");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pi-onepassword-composition-"));
const archiveDir = path.join(tempRoot, "archive");
const consumerDir = path.join(tempRoot, "consumer");

function packCodecks(destination) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
  const args = npmCli
    ? [npmCli, "pack", "--json", "--ignore-scripts", "--pack-destination", destination]
    : ["pack", "--json", "--ignore-scripts", "--pack-destination", destination];
  const result = spawnSync(command, args, {
    cwd: codecksPackageRoot,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32" && !npmCli,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pi-codecks npm pack failed: ${result.stderr}`);
  const entry = JSON.parse(result.stdout);
  const manifest = Array.isArray(entry) ? entry[0] : entry;
  if (!manifest?.filename) throw new Error("pi-codecks npm pack returned no filename");
  return path.join(destination, manifest.filename);
}

function assertRealInstalledPackage(packagePath, packageName) {
  assert.ok(existsSync(packagePath), `packed ${packageName} must be installed`);
  assert.equal(lstatSync(packagePath).isSymbolicLink(), false, `installed ${packageName} root must not be a symlink`);
  const resolvedConsumer = realpathSync(consumerDir);
  const resolvedPackage = realpathSync(packagePath);
  const relative = path.relative(resolvedConsumer, resolvedPackage);
  assert.ok(relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative), `installed ${packageName} must physically reside inside the neutral consumer`);
}

try {
  mkdirSync(archiveDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });
  writeFileSync(path.join(consumerDir, "package.json"), `${JSON.stringify({
    name: "pi-external-helper-packed-composition",
    private: true,
    version: "0.0.0",
  }, null, 2)}\n`);

  // Both inputs below are generated archives. The consumer has no local package
  // dependencies, links, or copied sibling runtime files.
  const onePasswordArchive = path.join(archiveDir, pack({ destination: archiveDir }).filename);
  const codecksArchive = packCodecks(archiveDir);
  const cleanEnv = { ...process.env, npm_config_offline: "true" };
  for (const name of Object.keys(cleanEnv)) if (/^(?:OP_|PI_ONEPASSWORD_|CODECKS_|PI_CODECKS_)/i.test(name)) delete cleanEnv[name];
  runNpm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", "--omit=optional", onePasswordArchive, codecksArchive], { cwd: consumerDir, env: cleanEnv });

  const installedOnePassword = path.join(consumerDir, "node_modules", "@aefree", "pi-onepassword");
  const installedCodecks = path.join(consumerDir, "node_modules", "@aefree", "pi-codecks");
  assertRealInstalledPackage(installedOnePassword, "pi-onepassword");
  assertRealInstalledPackage(installedCodecks, "pi-codecks");
  const adapter = path.join(installedOnePassword, "extensions", "integrations", "codecks-credential-helper.mjs");
  const core = path.join(installedCodecks, "src", "codecks-core.ts");
  assert.ok(existsSync(adapter), "packed pi-onepassword adapter must be installed");
  assert.ok(existsSync(core), "packed pi-codecks production core must be installed");

  // The adapter deliberately invokes its configured executable as `node run`;
  // this generated script is an inert stand-in for `op run`, never a network client.
  writeFileSync(path.join(consumerDir, "run"), `
const { spawn } = require("node:child_process");
const [delimiter, child, ...args] = process.argv.slice(2);
if (delimiter !== "--" || !child || process.env.OP_SERVICE_ACCOUNT_TOKEN !== "inert-packed-service-account") process.exit(64);
if (process.env.CODECKS_TOKEN || process.env.CODECKS_API_TOKEN || process.env.CODECKS_CREDENTIAL_PROVIDER) process.exit(65);
if (process.env.PACKED_FAKE_OP_MODE === "malformed") { process.stdout.write("not-json"); process.exit(0); }
const env = { ...process.env, PI_ONEPASSWORD_CODECKS_CREDENTIAL: "inert-packed-provider-token" };
delete env.OP_SERVICE_ACCOUNT_TOKEN;
const launched = spawn(child, args, { env, stdio: ["ignore", "pipe", "pipe"] });
launched.stdout.pipe(process.stdout); launched.stderr.pipe(process.stderr);
launched.once("error", () => process.exit(66));
launched.once("close", (code) => process.exit(code ?? 66));
`);
  const fixture = path.join(consumerDir, "composition.mjs");
  writeFileSync(fixture, `
import assert from "node:assert/strict";
import * as productionCore from ${JSON.stringify(pathToFileURL(core).href)};
process.env.CODECKS_ACCOUNT = "packed-composition-account";
process.env.CODECKS_TOKEN = "ambient-token-that-must-not-be-used";
process.env.CODECKS_CREDENTIAL_PROVIDER = "external-helper";
process.env.CODECKS_CREDENTIAL_HELPER_MODULE = ${JSON.stringify(adapter)};
process.env.PI_CODECKS_ALLOW_LIVE_VALIDATION = "1";
process.env.PI_ONEPASSWORD_OP_EXECUTABLE = process.execPath;
process.env.PI_ONEPASSWORD_CODECKS_REFERENCE = '"op://Packed Vault/codecks/token"';
process.env["OP_" + "SERVICE_ACCOUNT_TOKEN"] = "inert-packed-service-account";
let fetchCalls = 0;
const success = await productionCore.runExternalProviderIdentityCheck(async (input, init) => {
  fetchCalls += 1;
  assert.equal(input, "https://api.codecks.io/");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["X-Account"], "packed-composition-account");
  assert.equal(init.headers["X-Auth-Token"], "inert-packed-provider-token");
  assert.deepEqual(JSON.parse(init.body), { query: { _root: [{ loggedInUser: ["id", "name", "fullName"] }] } });
  return new Response(JSON.stringify({ data: { _root: { loggedInUser: { id: "packed-user" } } } }), { status: 200 });
});
assert.deepEqual(success, { category: "authenticated" });
assert.equal(fetchCalls, 1);
process.env.PACKED_FAKE_OP_MODE = "malformed";
const failed = await productionCore.runExternalProviderIdentityCheck(async () => {
  throw new Error("fetch must not run when the selected packed helper fails");
});
assert.deepEqual(failed, { category: "unavailable" });
console.log("packed external-provider composition succeeds and fails closed");
`);
  // tsx remains this repository's external test loader, not a neutral-consumer
  // dependency. The fixture imports production code only from installed archives.
  const loader = pathToFileURL(path.join(packageRoot, "node_modules", "tsx", "dist", "loader.mjs")).href;
  const result = spawnSync(process.execPath, ["--import", loader, fixture], { cwd: consumerDir, env: cleanEnv, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `packed composition failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /packed external-provider composition succeeds and fails closed/);
  console.log("Packed pi-codecks/pi-onepassword external-provider composition smoke passed.");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
