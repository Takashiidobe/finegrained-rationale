---
commit: "https://github.com/go-gitea/gitea/commit/bac747518a3d3e08468c30811c45f4a646d6a9de"
commit_sha: "bac747518a3d3e08468c30811c45f4a646d6a9de"
repository: "go-gitea/gitea"
provider: "codex"
model: "gpt-6-luna"
runs: 1
generated_at: "2026-10-14T00:09:51.992755+00:00"
---

# Rationale for go-gitea/gitea@bac747518a3d

## GOAL

The change aims to validate an LFS OID before using it to build a filesystem object path.[^1], [^2] The pull request describes `objectPath` as turning the OID into an on-disk path that `Download` and `Upload` access directly.[^3] It proposes validating the pointer at the start of `Download` and `Upload`, while keeping the behavior for well-formed 64-hex OIDs unchanged.[^4]

## NEED

The function’s safety depended on callers validating OIDs first, which the pull request describes as fragile.[^5] An OID containing `..` could direct a read or write outside the objects directory, and a short OID could panic during slicing.[^6]

## ALTERNATIVE

No evidence found.

## References

[^1]: [Commit message](<https://github.com/go-gitea/gitea/commit/bac747518a3d3e08468c30811c45f4a646d6a9de>) — “fix(lfs): validate OID before building filesystem object path (\#39762)”

[^2]: [PR \#39762](<https://github.com/go-gitea/gitea/pull/39762#title>) — “fix(lfs): validate OID before building filesystem object path”

[^3]: [PR \#39762](<https://github.com/go-gitea/gitea/pull/39762#body>) — “Its \`objectPath\` turns a pointer's OID straight into an on-disk path with \`filepath.Join(c.lfsDir, oid\[0:2\], oid\[2:4\], oid)\`, and \`Download\`/\`Upload\` then \`os.Open\` and \`os.Create\` that path directly, without the storage layer that contains every other LFS access.”

[^4]: [PR \#39762](<https://github.com/go-gitea/gitea/pull/39762#body>) — “Validating the pointer with \`IsValid\` at the top of \`Download\` and \`Upload\` keeps the check next to the code that builds the path, and a well-formed 64-hex OID behaves exactly as before.”

[^5]: [PR \#39762](<https://github.com/go-gitea/gitea/pull/39762#body>) — “Today the OIDs always arrive from \`SearchPointerBlobs\` and the LFS server, which run \`IsValid\` first, so the safety of this function lives entirely in its callers rather than in the function itself.”

[^6]: [PR \#39762](<https://github.com/go-gitea/gitea/pull/39762#body>) — “That is a fragile place to depend on: an OID carrying \`..\` would let a read or write land outside the objects directory, and a short OID slices \`oid\[0:2\]\`/\`oid\[2:4\]\` out of range and panics.”
