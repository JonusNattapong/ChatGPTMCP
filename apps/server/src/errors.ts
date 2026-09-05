/**
 * Structured tool errors.
 *
 * Tool callers are language models, not humans: a bare message string forces the
 * model to guess whether a failure is retryable, an argument mistake, or a policy
 * denial. Every failure therefore carries a stable machine-readable `code` and an
 * optional `hint` describing the next useful action.
 */
export type ToolErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'NOT_A_FILE'
  | 'NOT_A_DIRECTORY'
  | 'PATH_DENIED'
  | 'PRECONDITION_FAILED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'IDEMPOTENCY_UNKNOWN'
  | 'PROCESS_IDENTITY_UNVERIFIED'
  | 'PATCH_PARTIAL_FAILURE'
  | 'AMBIGUOUS_MATCH'
  | 'NO_MATCH'
  | 'TOO_LARGE'
  | 'BINARY_FILE'
  | 'TIMEOUT'
  | 'DEPENDENCY_MISSING'
  | 'NETWORK'
  | 'POLICY_DENIED'
  | 'APPROVAL_REQUIRED'
  | 'PROCESS_NOT_MANAGED'
  | 'PROCESS_IO_UNAVAILABLE'
  | 'PATCH_INVALID'
  | 'REMOTE_ERROR'
  | 'UNKNOWN_TOOL'
  | 'INTERNAL';

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly hint?: string;
  readonly details?: Record<string, unknown>;

  constructor(code: ToolErrorCode, message: string, hint?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

export function describeError(error: unknown): {
  code: ToolErrorCode;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
} {
  if (error instanceof ToolError) {
    return { code: error.code, message: error.message, hint: error.hint, details: error.details };
  }
  const errno = error as NodeJS.ErrnoException | undefined;
  if (errno?.code === 'ENOENT') {
    return { code: 'NOT_FOUND', message: errno.message, hint: 'Verify the path with list_directory or find_files.' };
  }
  if (errno?.code === 'EACCES' || errno?.code === 'EPERM') {
    return { code: 'PATH_DENIED', message: errno.message, hint: 'The operating system denied access to this path.' };
  }
  if (errno?.code === 'EEXIST') {
    return { code: 'ALREADY_EXISTS', message: errno.message };
  }
  if (errno?.code === 'EISDIR') {
    return { code: 'NOT_A_FILE', message: errno.message };
  }
  if (errno?.code === 'ENOTDIR') {
    return { code: 'NOT_A_DIRECTORY', message: errno.message };
  }
  return { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) };
}

