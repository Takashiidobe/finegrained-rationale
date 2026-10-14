---
commit: "https://github.com/torvalds/linux/commit/3d8cc52db2f86b624308321c58513019f6b21eec"
commit_sha: "3d8cc52db2f86b624308321c58513019f6b21eec"
repository: "torvalds/linux"
provider: "codex"
model: "gpt-6-luna"
runs: 1
generated_at: "2026-10-14T00:10:03.327996+00:00"
---

# Rationale for torvalds/linux@3d8cc52db2f8

## GOAL

Drop `__counted_by` from `landlock_domain.handled_masks`.[^1] The flexible array is in an anonymous struct inside an anonymous union that overlays `work_free`.[^2]

## NEED

With clang 22 and `CONFIG_FORTIFY_SOURCE`, the second `landlock_restrict_self()` call triggers a bogus fortify report in `inherit_ruleset()`.[^3] Clang computes the `__counted_by` counter address as the start of the flexible array instead of `&num_layers`.[^4] It then reads the bound from `handled_masks[0]`, which contains the first layer’s access masks rather than a count.[^5]

## ALTERNATIVE

The annotation was added as documentation, so the commit drops it rather than restructuring the union.[^6]

## References

[^1]: [Commit message](<https://github.com/torvalds/linux/commit/3d8cc52db2f86b624308321c58513019f6b21eec>) — “landlock: Drop \_\_counted\_by from landlock\_domain.handled\_masks”

[^2]: [Commit message](<https://github.com/torvalds/linux/commit/3d8cc52db2f86b624308321c58513019f6b21eec>) — “handled\_masks\[\] lives in an anonymous struct inside the anonymous union that overlays work\_free.”

[^3]: [Commit message](<https://github.com/torvalds/linux/commit/3d8cc52db2f86b624308321c58513019f6b21eec>) — “With clang 22 and CONFIG\_FORTIFY\_SOURCE, the second landlock\_restrict\_self() call hits a bogus fortify report in inherit\_ruleset():”

[^4]: [Commit message](<https://github.com/torvalds/linux/commit/3d8cc52db2f86b624308321c58513019f6b21eec>) — “For such a flexible array, clang computes the address of the \_\_counted\_by counter as the start of the array instead of \&num\_layers.”

[^5]: [Commit message](<https://github.com/torvalds/linux/commit/3d8cc52db2f86b624308321c58513019f6b21eec>) — “The bound is then read from handled\_masks\[0\], i.e. from the first layer's access masks, which is not a count.”

[^6]: [Commit message](<https://github.com/torvalds/linux/commit/3d8cc52db2f86b624308321c58513019f6b21eec>) — “The annotation was added as documentation, so drop it rather than restructure the union.”
