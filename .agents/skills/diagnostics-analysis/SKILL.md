---
name: diagnostics-analysis
description: Interpret bounded build, Electron or layout diagnostics without broad collection of private machine data.
---

Start from the observed failure and exact command/environment. Trace the responsible module and a
minimal reproduction. Read only relevant non-secret logs. Keep temporary output in ignored .local/diagnostics.
Do not dump process environments, recurse through user profiles or delete real state. Use controlled
fixtures and stop when the blocking question is answered. Return evidence and remaining uncertainty.
