# First-party interactive Terminal — alpha.40 / Issue #47

## Ownership

`main/terminal.ts` owns one persistent native `node-pty` session per app window. Windows uses
the OS ConPTY implementation, preferring the existing Program Files PowerShell 7 executable,
otherwise System32 Windows PowerShell. The initial directory is the actual OS user home, unrelated
to illustrative project metadata or Explorer grants. `-NoLogo -NoProfile` avoids executing a user
profile. The fixed `-NoExit -Command` launch configuration sets the existing PSReadLine module to
`SaveNothing` with `HistorySavePath NUL` before the first prompt: no owner history is loaded or saved.
Configuration failure exits with a real failure rather than silently enabling history. No user/project
command, build, task or saved history is automatically submitted. Shell commands run
with the application's actual OS privileges and can affect the machine like ordinary PowerShell.

`shared/terminal.ts` defines five fixed typed operations and bounded state/output contracts.
`main/terminal-bridge.ts` binds calls to the exact window WebContents/main frame/app URL. No path,
executable, arguments, environment, channel or plugin identity is accepted from the renderer.
Session UUIDs are generation-bound; input/resize require running state. Repeated Start during
starting/running/closing is idempotent. Restart is explicit after exit/failure/close. Real shell
exit codes are distinct from user termination. A failed command inside a running shell does not
become a process-exit failure or project diagnostic.

`renderer/terminal/session.ts` owns one xterm emulator, parsed screen, bounded scrollback and DOM,
independently of `TerminalView`. One Editor/Widgets adapter attaches that DOM at a time; temporarily
unmounted DOM and continuous output remain session-owned. No partial raw ANSI replay is used to
reconstruct a view. Changing modes, placement, collapse or theme never spawns or kills a process.
Live font/screen measurements and ResizeObserver derive rows/columns without addon-fit, using
public terminal dimensions/DOM. Resize changes the existing PTY. Ctrl+C goes through native input;
selection/Copy/Ctrl+Shift+C and native Ctrl+V paste use the emulator. Copy uses a synchronous
user-initiated native copy event; the global browser-permission denial is unchanged. OSC 52 clipboard writes are
explicitly consumed without effect. No URL opener, HTML surface or clipboard-read bridge is added.

## Presentations

The essential `host:terminal` catalog widget is single-view, eligible in Main and Bottom. Placement
is explicit through ordinary host commands; individual gestures require Edit. No saved composition
is automatically changed. Essential packaging/distribution remains provisional, as for Files & Editor.

Editor has a direct terminal in the existing Bottom surface with the same region splitter and
collapse/reveal path. Widgets Bottom content remains mounted/inert behind that presentation; Workers
are independent. `Mostrar Terminal` and the contextual status item reveal/focus the direct view,
without inserting a widget. Explicit Bottom resizing/reveal retains existing host chrome persistence;
switching modes alone writes no confirmed geometry, bar or document bytes. Showing Terminal does
not automatically Start it. A nonzero-exit indicator reveals the preserved output and Restart action.

## Budgets and teardown

Native output retains the most recent 262,144 UTF-16 units. Cursor reads carry at most 32,768 units
and report a gap explicitly. The renderer polls with only one outstanding read and waits for xterm's
write callback before the next page; this bounds the transport/parser queue instead of accumulating
unacknowledged IPC output events. An overrun resets the parser and displays loss feedback. This is
a conservative lossy overflow strategy, not lossless logging or crash restoration. xterm retains at
most 2,000 scrollback lines; resize is clamped to 2–500 columns / 1–200 rows. Input is capped at 8,192
units per call/renderer pending buffer and 65,536 units per second in Core. Excess input is refused,
not silently queued. Natural terminal output and command memory/CPU remain subject to OS resources;
there is no hostile-process resource sandbox.

Explicit Close cancels a pending Start or kills the running PTY and waits for its exit callback.
Main-frame navigation, renderer loss, actual window closure and application shutdown revoke/kill
the native owner. A canceled document-close decision leaves the window and shell alive. node-pty
owns ConPTY handles and attached-console teardown. Detached processes deliberately launched outside
the console are not a general job-management guarantee. No public Worker/process SDK, cross-plugin
grants, durable history, multiple profiles, SSH, tasks or per-command diagnostics are implemented.

## Dependencies and runtime

Owner approval: [Issue #47 decision](https://github.com/rabrunos/GeppIO/issues/47#issuecomment-6882178786).
Exact runtime packages: `@xterm/xterm@6.0.0` (MIT), `node-pty@1.1.0` (MIT); sole added transitive
package `node-addon-api@7.1.1` (MIT). The lock records registry integrity; [license notices](../legal/terminal-dependencies.txt)
are retained in source. Retain their bundled LICENSE
files and node-pty third-party notices/binaries when distributing a future app. No telemetry client,
network service or other deliberate dependency is introduced. No source was copied from VS Code.

node-pty is explicitly external in Main's small Rollup configuration; xterm is bundled only into the
renderer. A built `out/main/index.cjs` resolves the complete installed production node-pty package,
including its `lib`, workers, prebuilds and license files. `out/` alone is not a distributable app.
There is still no installer/packager/release workflow in this repository. A future packager must
retain/unpack native binaries and helper files and test that artifact separately.

The Windows x64 1.1.0 package includes Node-API prebuilds. With Electron 44.6.0 / Node 24.21.0 /
ABI 149 / Node-API 10, the selected prebuild loads and spawns real ConPTY in the built production
application without C++ compilation or an Electron-specific rebuild tool. `pnpm rebuild node-pty`
runs the reviewed prebuild check and postinstall preparation; it does not claim source compilation.
The exact install scripts are allowlisted. No @electron/rebuild, addon-fit, compiler or native-build
dependency was adopted. Unsupported/missing prebuilds or a later incompatible Electron must be
re-evaluated before adding tooling; do not install extra packages silently. Linux uses the same
interface but compilation, packaging and physical runtime validation are outside this delivery.

Primary references: [node-pty](https://github.com/microsoft/node-pty),
[xterm 6](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0),
[Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules).
