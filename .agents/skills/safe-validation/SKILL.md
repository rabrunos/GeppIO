---
name: safe-validation
description: Run and interpret project checks and manual smoke without changing owner state or publishing.
---

Select direct checks for changed behavior and negative paths for changed boundaries. Use pnpm test,
pnpm check and pnpm test:desktop as applicable. Dependency resolution, full typecheck, build and real
Windows runtime are different evidence. Label pass/fail/blocked/not_run accurately. Use temporary data.
Give only necessary owner smoke with preconditions and expected outcomes. Never deploy as a test.
