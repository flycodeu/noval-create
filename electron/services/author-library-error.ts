/** Expected business failures may be shown by desktop, Web and MCP without leaking runtime errors. */
export class AuthorLibraryError extends Error {
  readonly code = 'AUTHOR_LIBRARY_INVALID'
}
