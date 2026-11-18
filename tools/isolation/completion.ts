export interface NativeResult { kind: 'result'; exitCode: number; cleanup: boolean }

/** A zero test exit alone never establishes successful isolated validation. */
export function completionCode(code: number, native: NativeResult | undefined, windows: number, reason?: number): number {
  if (reason !== undefined) return reason
  const valid = native?.kind === 'result' && Number.isInteger(native.exitCode) && (native.exitCode >>> 0) === (code >>> 0) && native.cleanup === true
  return valid && (code !== 0 || (Number.isSafeInteger(windows) && windows > 0)) ? code : code === 0 ? 125 : code
}
