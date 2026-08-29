import { createHash, randomBytes } from 'node:crypto';

export interface ApprovalRequestState {
  v: 1;
  tool: string;
  argsHash: string;
  nonce: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function hashArgs(args: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(args))).digest('hex');
}

export function createApprovalRequestState(tool: string, args: Record<string, unknown>): ApprovalRequestState {
  return {
    v: 1,
    tool,
    argsHash: hashArgs(args),
    nonce: randomBytes(16).toString('base64url'),
  };
}

export function matchesApprovalRequestState(
  payload: ApprovalRequestState | undefined,
  tool: string,
  args: Record<string, unknown>,
): boolean {
  return payload?.v === 1 && payload.tool === tool && payload.argsHash === hashArgs(args);
}
