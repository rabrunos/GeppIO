# Reviewing a candidate

Start with the [control map](../architecture/security.md) and the actual diff. Identify the caller, asset, grant and lifetime at each changed boundary. Verify rejection before effects, and retention or reconciliation when a write may already have occurred.

- For filesystem and recovery changes, check bounded parsing, links and redirected ancestors, stale witnesses, conflicting revisions and uncertainty. Use disposable roots.
- For processes, distinguish the user's explicit first-party terminal from fixed Git operations. Review executable, arguments, environment, selected root and teardown.
- For plugins, follow identity from accepted bytes to active generation, broker and view. Check denial, cancellation, stale grants, quotas, package integrity and preserved user data. Discovery must never execute project code.
- Run the approved checksum-verified secret scanner on the intended diff and relevant Git history with redacted output. Review exact lockfile and bundled versions (including Monaco's embedded DOMPurify), the production and development graphs, shipped notices and license files. Run `pnpm audit` against the locked dependency graph. Record advisory IDs, affected versions, applicability, available fixes and outstanding decisions. Keep unavailable checks and known findings visible.
- For a consequential boundary change, obtain an independent bounded review using the diff and sanitized evidence. Keep credentials and user profiles outside the review inputs. Record the specific path, impact and check in the Issue.
- Require the source gate and relevant built Windows journeys, including applicable development/production differences. An existing prototype exception applies only to the versions, use and threats explicitly accepted. Keep unresolved risks visible before integration or distribution. Publication needs its own authority and artifact verification.

For native work, separately assess upstream advisories, dependencies, FFI, unsafe code and the chosen extension isolation model. Select and approve any new tools before installation.
