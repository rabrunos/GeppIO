/** Owner-authorized production roots only. Never load keys from a package, environment or profile. */
export interface PluginTrustEntry {
  keyId: string
  pluginId: 'geppio.workspace-essentials'
  publisher: string
  publicKey: string
  revoked: boolean
}
// Owner authorization: Issue #43 continuation, 2026-11-13. SPKI DER fingerprint independently
// recomputed and matched against the owner's external public-key file before pinning.
export const PLUGIN_TRUST: readonly Readonly<PluginTrustEntry>[] = Object.freeze([Object.freeze({
  keyId: 'afce9e671489882fa41e1dbed7b1c7280b96d06fbe1f6635f3c62c4ceff7bb04',
  pluginId: 'geppio.workspace-essentials',
  publisher: 'GeppIO (rabrunos)',
  publicKey: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAbEH4B4TkgXmPHnZtCFSvtIZUr8wERHciEKOnaxaGdBY=\n-----END PUBLIC KEY-----\n',
  revoked: false
})])
