/** Per-product lifecycle. Registration is inert. Dependencies start first and
 * release last. A failed selection unwinds only the resources it acquired. */
export interface Capability {
  requires?: readonly string[]
  start(): () => void
}
export class CapabilityRuntime {
  private readonly definitions: ReadonlyMap<string, Capability>
  private readonly running = new Map<string, () => void>()
  constructor(definitions: Readonly<Record<string, Capability>>) {
    this.definitions = new Map(Object.entries(definitions))
  }
  get active(): readonly string[] { return [...this.running.keys()] }
  activate(selected: readonly string[]): void {
    const acquired: string[] = []
    const pending = new Set<string>()
    const start = (id: string): void => {
      if (this.running.has(id)) return
      const definition = this.definitions.get(id)
      if (!definition || pending.has(id)) throw new Error('Missing or cyclic capability: ' + id)
      pending.add(id)
      for (const dependency of definition.requires ?? []) start(dependency)
      this.running.set(id, definition.start())
      acquired.push(id)
      pending.delete(id)
    }
    try { selected.forEach(start) }
    catch (error) { this.release(acquired); throw error }
  }
  private release(ids: string[]): void {
    const errors: unknown[] = []
    for (const id of ids.reverse()) {
      const dispose = this.running.get(id)!
      this.running.delete(id)
      try { dispose() } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Capability disposal failed')
  }
  dispose(): void { this.release([...this.running.keys()]) }
}
