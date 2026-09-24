---
commit: "https://github.com/kraj/musl/commit/b5934c400ec53cc74a2a1156403ce1e7c3179b6c"
commit_sha: "b5934c400ec53cc74a2a1156403ce1e7c3179b6c"
repository: "kraj/musl"
provider: "codex"
model: "gpt-6-luna"
runs: 1
generated_at: "2026-09-24T14:35:49.145Z"
---

# Rationale for kraj/musl@b5934c400ec5

## GOAL

Restore the caller’s original `errno` before invoking the `sel()` callback in `scandir`, so it cannot observe the internal reset to zero.

## NEED

POSIX.1-2024 requires standard functions not to set `errno` to zero; the existing code hid the reset from `cmp()` and the caller but not from `sel()`.

## ALTERNATIVE

Not identified.
