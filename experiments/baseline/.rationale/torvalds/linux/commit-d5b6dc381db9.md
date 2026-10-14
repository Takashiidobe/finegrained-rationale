---
commit: "https://github.com/torvalds/linux/commit/d5b6dc381db93ff2d1888f7d99c06e0bd85f4083"
commit_sha: "d5b6dc381db93ff2d1888f7d99c06e0bd85f4083"
repository: "torvalds/linux"
provider: "codex"
model: "gpt-6-luna"
runs: 1
generated_at: "2026-10-14T00:09:14.725662+00:00"
---

# Rationale for torvalds/linux@d5b6dc381db9

## GOAL

The commit contains fixes for ch, UFS MCQ completion handling, unsafe MMIO reads, MediaTek mPHY power-on failures, qedi callback registration, and holding a clock reference across probe.[^1] Three fixes are about the same size; the unsafe MMIO fix is the least obvious logic change.[^2]

## NEED

No evidence found.

## ALTERNATIVE

No evidence found.

## References

[^1]: [Commit message](<https://github.com/torvalds/linux/commit/d5b6dc381db93ff2d1888f7d99c06e0bd85f4083>) — “\* tag 'scsi-fixes' of git://git.kernel.org/pub/scm/linux/kernel/git/jejb/scsi: scsi: ufs: core: Decouple CQ sweep from request iterator in MCQ scsi: ufs: core: Avoid unsafe MMIO reads in ufshcd\_mcq\_compl\_all\_cqes\_lock() scsi: ch: Do not keep references to data transfer element devices scsi: ufs: mediatek: Handle mPHY power-on failures scsi: qedi: Initialize callback state before registration scsi: ufs: core: Hold a clock reference across the probe”

[^2]: [Commit message](<https://github.com/torvalds/linux/commit/d5b6dc381db93ff2d1888f7d99c06e0bd85f4083>) — “Three of the fixes are about the same size, (ch, ufs decouble CQ and ufs avoid unsafe MMIO) but the unsafe MMIO is the least obvious logic change"”
