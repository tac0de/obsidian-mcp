import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

export type VaultErrorCode =
  | 'E_PATH_TRAVERSAL'
  | 'E_FILE_NOT_FOUND'
  | 'E_MAX_BYTES_EXCEEDED'
  | 'E_EMPTY_QUERY'
  | 'E_INVALID_PATH'
  | 'E_INVALID_FOLDER'
  | 'E_GRAPH_NOT_BUILT'
  | 'E_NODE_NOT_FOUND'
  | 'E_EXECUTION_DISABLED'
  | 'E_CAPABILITY_DENIED'
  | 'E_COMMAND_TIMEOUT'
  | 'E_COMMAND_FAILED'
  | 'E_OUTPUT_LIMIT_EXCEEDED'
  | 'E_UNKNOWN_PROVIDER'
  | 'E_PROVIDER_NOT_CONFIGURED'
  | 'E_EMBEDDINGS_DISABLED'
  | 'E_INDEX_NOT_FOUND';

export class VaultError extends Error {
  readonly code: VaultErrorCode;
  readonly retryable: boolean;

  constructor(code: VaultErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function toMcpError(error: unknown): McpError {
  if (error instanceof VaultError) {
    const category =
      error.code === 'E_COMMAND_FAILED'
        ? ErrorCode.InternalError
        : error.code === 'E_COMMAND_TIMEOUT'
          ? ErrorCode.InternalError
          : ErrorCode.InvalidParams;

    return new McpError(category, `${error.code}: ${error.message}`);
  }

  if (error instanceof Error) {
    return new McpError(ErrorCode.InternalError, `E_INTERNAL: ${error.message}`);
  }

  return new McpError(ErrorCode.InternalError, 'E_INTERNAL: Unknown error');
}
