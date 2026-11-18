// Disposable orphan fixture. The launch job, not process-name matching, must terminate it.
await new Promise(resolveWait => setTimeout(resolveWait, 60000))
export {}
