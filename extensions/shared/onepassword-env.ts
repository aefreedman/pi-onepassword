export function isSecretOnePasswordEnvironmentVariable(name: string): boolean {
  // Environment variable names are case-insensitive on Windows. Apply the
  // stricter behavior everywhere so a package behaves consistently cross-platform.
  return /^OP_SERVICE_ACCOUNT_TOKEN(?:_|$)/i.test(name)
    || /^OP_CONNECT_TOKEN(?:_|$)/i.test(name)
    || /^OP_SESSION(?:_|$)/i.test(name);
}

export function sanitizeOnePasswordEnvironment(
  environment: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const sanitized = { ...environment };
  for (const name of Object.keys(sanitized)) {
    if (isSecretOnePasswordEnvironmentVariable(name)) {
      delete sanitized[name];
    }
  }
  return sanitized;
}
