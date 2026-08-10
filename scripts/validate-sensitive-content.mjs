import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pack, packageRoot, runNpm } from "./package-archive.mjs";

const ignoredDirectories = new Set([".git", "node_modules"]);
const textExtensions = new Set([".ts", ".mts", ".cts", ".mjs", ".cjs", ".js", ".ps1", ".json", ".md", ".yml", ".yaml", ".txt", ".lock"]);
const patterns = [
  { label: "private-key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { label: "GitHub credential", pattern: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/g },
  { label: "npm credential", pattern: /\bnpm_[A-Za-z0-9]{20,}\b/g },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "1Password service-account credential", pattern: /\bops_[A-Za-z0-9_-]{20,}\b/g },
  { label: "assigned service-account value", pattern: /OP_SERVICE_ACCOUNT_TOKEN\s*[:=]\s*["'][^"'\r\n]{12,}["']/g },
];
// Each entry must be an exact repository-relative file and exact matched text.
// Keep this empty unless a shaped inert credential is indispensable to a test.
const inertExactAllowlist = new Map();

function collectTextFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) visit(path.join(directory, entry.name));
      } else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) {
        const file = path.join(directory, entry.name);
        if (statSync(file).size <= 1024 * 1024) files.push(file);
      }
    }
  };
  visit(root);
  return files;
}

function scan(label, root, allowExactMatches) {
  const findings = [];
  let allowlistedMatches = 0;
  for (const file of collectTextFiles(root)) {
    const relativePath = path.relative(root, file).replaceAll("\\", "/");
    const content = readFileSync(file, "utf8");
    for (const { label: patternLabel, pattern } of patterns) {
      pattern.lastIndex = 0;
      for (let match; (match = pattern.exec(content)); ) {
        const allowlisted = allowExactMatches.get(relativePath);
        if (allowlisted?.has(match[0])) {
          allowlistedMatches += 1;
          continue;
        }
        findings.push(`${label}:${relativePath}: ${patternLabel}`);
      }
    }
  }
  return { findings, allowlistedMatches };
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pi-onepassword-sensitive-"));
try {
  const archiveDir = path.join(tempRoot, "archive");
  const consumerDir = path.join(tempRoot, "consumer");
  mkdirSync(archiveDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });
  writeFileSync(path.join(consumerDir, "package.json"), `${JSON.stringify({ name: "pi-onepassword-sensitive-scan", private: true, version: "0.0.0" })}\n`);
  const packed = pack({ destination: archiveDir });
  const archivePath = path.join(archiveDir, packed.filename);
  runNpm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", "--omit=peer", archivePath], {
    cwd: consumerDir,
    env: { ...process.env, npm_config_offline: "true" },
  });

  const source = scan("repository", packageRoot, inertExactAllowlist);
  // An installed package tree is npm's portable, path-safe archive consumer;
  // it avoids platform-specific tar options and never extracts unvalidated paths.
  const packedScan = scan("installed-tarball", path.join(consumerDir, "node_modules", "@aefree", "pi-onepassword"), new Map());
  const findings = [...source.findings, ...packedScan.findings];
  if (findings.length) {
    console.error("Sensitive-content validation failed:");
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
  } else {
    console.log(`Sensitive-content validation passed: repository and installed packed bytes scanned; ${source.allowlistedMatches} exact inert file/value matches allowlisted.`);
    console.log("This bounded regex scan is evidence only; it cannot prove that secrets are absent.");
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
