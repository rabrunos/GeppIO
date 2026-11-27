/** English dictionary for the native host, generated from the Electron reference catalogues.
 * pt-BR strings are the keys (the reference's own convention). `messages` wins over
 * `appMessages`, as in `src/geppio/src/renderer/src/workbench/Locale.tsx`.
 * Run `node --experimental-strip-types tools/native-i18n.ts` to regenerate, or with `--check`
 * to fail on drift. */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { appMessages } from '../src/geppio/src/renderer/src/workbench/app-messages.ts'
import { messages } from '../src/geppio/src/renderer/src/workbench/messages.ts'

export const DICTIONARY = 'native/crates/geppio/assets/i18n/en.json'

export function dictionary(): string {
  const merged: Record<string, string> = { ...appMessages, ...messages }
  const sorted = Object.fromEntries(Object.keys(merged).sort().map(key => [key, merged[key]!]))
  return JSON.stringify(sorted, null, 1) + '\n'
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1]!)).href) {
  const path = resolve(DICTIONARY), text = dictionary()
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== text) { console.error(`${DICTIONARY} is stale; run tools/native-i18n.ts`); process.exit(1) }
    console.log('native i18n dictionary is current')
  } else {
    writeFileSync(path, text)
    console.log(`wrote ${DICTIONARY} (${Object.keys(JSON.parse(text)).length} entries)`)
  }
}
