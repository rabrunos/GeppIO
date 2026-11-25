/** Fixed host chrome only. This is not part of the plugin SDK. */
export interface WindowControls { minimize(): Promise<boolean>; maximize(): Promise<boolean>; close(): Promise<boolean> }
export function validWindowControlRequest(actualURL: string, expectedURL: string, mainFrame: boolean, args: readonly unknown[]) {
  return mainFrame && actualURL === expectedURL && args.length === 0
}
