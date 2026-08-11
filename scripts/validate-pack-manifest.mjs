import { readFileSync } from "node:fs";
import path from "node:path";
import { pack, packageRoot } from "./package-archive.mjs";

const requiredFiles = [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "extensions/bash-op-guard.ts",
  "extensions/shared/bash-op-guard-core.ts",
  "extensions/shared/onepassword-env.ts",
  "extensions/shared/onepassword-trusted.ts",
  "package.json",
];
const allowedExact = new Set(["CHANGELOG.md", "LICENSE", "README.md", "package.json"]);
const allowedPrefixes = ["extensions/"];
const forbiddenPathPatterns = [
  { label: "test or fixture", pattern: /^tests\// },
  { label: "maintainer script", pattern: /^scripts\// },
  { label: "GitHub metadata", pattern: /^\.github\// },
  { label: "TypeScript project config", pattern: /(^|\/)tsconfig\.json$/ },
  { label: "lockfile", pattern: /(^|\/)package-lock\.json$/ },
  { label: "environment file", pattern: /(^|\/)\.env(?:\.|$)/i },
  { label: "private key file", pattern: /\.(?:key|pem|p12|pfx)$/i },
  { label: "generated tarball", pattern: /\.tgz$/i },
];
const forbiddenContentPatterns = [
  { label: "private key material", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "machine user-profile path", pattern: /[A-Za-z]:[\\/]Users[\\/](?![<{])[^\\/\s]+|\/(?:Users|home)\/(?![<{])[^/\s]+/ },
];

const result = pack({ dryRun: true });
const files = result.files.map((entry) => String(entry.path).replaceAll("\\", "/")).sort();
const errors = [];
for (const required of requiredFiles) if (!files.includes(required)) errors.push(`missing required package file: ${required}`);
for (const file of files) {
  if (!allowedExact.has(file) && !allowedPrefixes.some((prefix) => file.startsWith(prefix))) {
    errors.push(`file is outside the public allow-list: ${file}`);
  }
  for (const { label, pattern } of forbiddenPathPatterns) if (pattern.test(file)) errors.push(`${label} must not be packed: ${file}`);
  const content = readFileSync(path.join(packageRoot, ...file.split("/")), "utf8");
  for (const { label, pattern } of forbiddenContentPatterns) if (pattern.test(content)) errors.push(`${label} found in packed file: ${file}`);
}
if (errors.length) {
  console.error("Packed manifest validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Packed manifest validation passed (${files.length} intentional public files).`);
}
