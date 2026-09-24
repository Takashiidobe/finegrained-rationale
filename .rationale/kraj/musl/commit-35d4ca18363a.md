---
commit: "https://github.com/kraj/musl/commit/35d4ca18363a979e77ad47f45b3b8e28f6809ac8"
commit_sha: "35d4ca18363a979e77ad47f45b3b8e28f6809ac8"
repository: "kraj/musl"
provider: "codex"
model: "gpt-6-luna"
runs: 1
generated_at: "2026-09-24T14:29:34.154Z"
---

# Rationale for kraj/musl@35d4ca18363a

## GOAL

Make the dynamic linker a relative symlink to libc, using `ln -r`.

## NEED

An absolute symlink into `$(libdir)` can fail in cross-build environments, especially when running target applications with qemu user mode.

## ALTERNATIVE

Not identified.
