---
commit: "https://github.com/go-gitea/gitea/commit/bac747518a3d3e08468c30811c45f4a646d6a9de"
commit_sha: "bac747518a3d3e08468c30811c45f4a646d6a9de"
repository: "go-gitea/gitea"
provider: "codex"
model: "gpt-6-luna"
runs: 1
generated_at: "2026-10-13T23:53:26.836Z"
---

# Rationale for go-gitea/gitea@bac747518a3d

## GOAL

Validate the OID before building the filesystem object path.[^1]

## NEED

The path-building function relies on its callers to validate OIDs; a `..` OID could direct reads or writes outside the objects directory, and a short OID could cause a slice panic.[^2], [^3]

## ALTERNATIVE

No evidence found.

## References

[^1]: [Commit message](<https://github.com/go-gitea/gitea/commit/bac747518a3d3e08468c30811c45f4a646d6a9de>) — “fix(lfs): validate OID before building filesystem object path (\#39762)”

[^2]: [PR \#39762](<https://github.com/go-gitea/gitea/pull/39762#body>) — “Today the OIDs always arrive from \`SearchPointerBlobs\` and the LFS server, which run \`IsValid\` first, so the safety of this function lives entirely in its callers rather than in the function itself.”

[^3]: [PR \#39762](<https://github.com/go-gitea/gitea/pull/39762#body>) — “That is a fragile place to depend on: an OID carrying \`..\` would let a read or write land outside the objects directory, and a short OID slices \`oid\[0:2\]\`/\`oid\[2:4\]\` out of range and panics.”
