import { parseSelection, suites, incompatible } from './plan.ts'
import { runIsolation } from './controller.ts'

if (process.argv.slice(2).join(' ') === '--help') {
  console.log('Isolated trusted local Electron smokes: pnpm test:isolated <suite> [--dev|--scale125]')
  console.log('desktop-core is tools/desktop-smoke.ts, not the complete public test:desktop gate.')
  for (const suite of Object.keys(suites)) console.log(suite + (incompatible[suite] ? ': unavailable — ' + incompatible[suite] : ''))
  console.log('Visible debugging: set GEPPIO_TEST_VISIBLE=1 explicitly and invoke an original public command. This may move focus/show windows.')
} else {
  try { process.exitCode = await runIsolation(parseSelection(process.argv.slice(2))) }
  catch (failure) { console.error('ISOLATION_REFUSED:', failure instanceof Error ? failure.message : 'UNKNOWN'); process.exitCode = 125 }
}
