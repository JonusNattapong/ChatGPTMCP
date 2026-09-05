const API_KEY_PATTERNS = [
  /\b(sk|pk|rk|api[_-]?key|api[_-]?secret|secret|token|key|auth|password|passwd|credential)\s*[=:]\s*\S+/gi,
  /(['"])(sk|pk|rk|api[_-]?key)[-'"]?[a-zA-Z0-9+/]{16,}\1/gi,
  /\b[A-Za-z0-9+/]{40,}\b/g,
  /\b(sk|pk|rk)-[a-zA-Z0-9+/_-]{16,}\b/gi,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgho_[A-Za-z0-9]{20,}\b/g,
  /\bghu_[A-Za-z0-9]{20,}\b/g,
  /\bgpr_[A-Za-z0-9]{20,}\b/g,
  /\bssh-rsa\s+[A-Za-z0-9+/=]{100,}\b/g,
  /\bssh-ed25519\s+[A-Za-z0-9+/=]{40,}\b/g,
  /-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH|PGP)\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA|DSA|EC|OPENSSH|PGP)\s+PRIVATE\s+KEY-----/g,
  /-----BEGIN\s+CERTIFICATE-----[\s\S]*?-----END\s+CERTIFICATE-----/g,
  /\b(?:xox[bprs])-[A-Za-z0-9-]{10,}\b/g,
];

const REPLACEMENT = '[REDACTED]';

export function redactContent(content: string): string {
  let result = content;

  for (const pattern of API_KEY_PATTERNS) {
    result = result.replace(pattern, REPLACEMENT);
  }

  return result;
}

export function sanitizeContent(content: string, maxBytes = 32_000): string {
  const redacted = redactContent(content);

  if (redacted.length > maxBytes) {
    return `${redacted.slice(0, maxBytes - 100)}... [truncated ${content.length - maxBytes} chars]`;
  }

  return redacted;
}

export function isSensitiveString(value: string): boolean {
  for (const pattern of API_KEY_PATTERNS) {
    if (pattern.test(value)) {
      return true;
    }
  }

  return false;
}
