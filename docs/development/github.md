# Git, versioning and acceptance

Use the relevant GitHub Issue for the agreement, continued work and evidence. Check the branch, HEAD, index, worktree, origin URLs and actual remote base. Preserve the owner's work and Git history.

## Assign the target

Check package.json, integrated history and concurrent Issue reservations. Record the unused target and scope in the Issue before the first tracked edit. Local iterations share their target. Every later delivered application-source batch advances the version, even when correcting an unaccepted delivery. Keep abandoned assignments reserved. Read-only work and machine setup need no version bump. The root package owns the version and CHANGELOG.md records integrated effects.

## Integrate the verified change

1. Review the actual changed files, including deletions and new entry points. Run the relevant unit, build, desktop, dependency and secret checks. Record the platform, exact commands, failures and limitations.
2. Stage intended paths only. Inspect the staged diff and run `git diff --cached --check`. Verify canonical name `rabrunos/GeppIO`, GitHub ID `1409287329`, both origin URLs and the expected remote ancestry on `main`. Stop on divergence or unknown outcomes.
3. Under [Issue #22](https://github.com/rabrunos/GeppIO/issues/22), commit and push completed, validated in-scope changes to verified `origin/main`. Preserve any explicit do-not-commit or do-not-push instruction across continuations. Use the exact bracketed target in the commit subject and delivery report.
4. Link the exact commit and CI jobs in the active Issue. Keep manual acceptance open until observed. Use normal pushes only. A release, Issue closure, deployment or repository settings change needs separate authority.

The Windows workflow exercises the application. The separate Ubuntu secret scan covers Git history. See the [test guide](testing.md) for entry points and the [security review](security-review.md) for candidate checks.
