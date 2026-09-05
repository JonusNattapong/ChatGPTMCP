# Lessons: Cross-Platform CI & Line Endings

*Tags: ci, github-actions, windows, linux, line-endings*

## Key Lessons
1. **Enforce LF for scripts**: Always configure .gitattributes with *.sh text eol=lf so Bash scripts checked out on Windows runners execute cleanly on Linux without syntax errors ().
2. **Hermetic test gates**: Avoid spawning external system binaries (like ruff, pytest) inside unit test suites unless pre-installed on the runner image; detect config/AST instead.
3. **Avoid CWD reliance**: Fixtures should resolve paths relative to import.meta.url rather than process.cwd() so tests pass whether executed from monorepo root or package directory.
