const SECRET_ONEPASSWORD_ENV_NAMES = new Set([
  "OP_CONNECT_TOKEN",
]);

export function isSecretOnePasswordEnvironmentVariable(name: string): boolean {
  return SECRET_ONEPASSWORD_ENV_NAMES.has(name)
    || /^OP_SERVICE_ACCOUNT_TOKEN(?:_|$)/.test(name)
    || /^OP_SESSION(?:_|$)/.test(name);
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
