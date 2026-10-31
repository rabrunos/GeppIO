import type { SessionDraft } from './model.ts'
import type { SessionSlot, WorkbenchSnapshot } from './model.ts'
import { LIMITS } from './model.ts'

/** Presentation navigation and library metadata do not edit a format. This
 * consumes canonical intentions, never a viewport-projected DOM snapshot. */
export function formatSignature(snapshot: WorkbenchSnapshot, slots: readonly SessionSlot[] = []) {
  const { views, bars, chrome } = snapshot.organization
  return JSON.stringify({ reference: snapshot.reference, placements: snapshot.placements, views, bars, chrome, slots })
}

/** A gesture owns one before/after pair; intermediate solver frames never enter history. */
export class EditHistory {
  private undoStack: SessionDraft[] = []
  private redoStack: SessionDraft[] = []
  private gesture: SessionDraft | null = null
  get canUndo() { return this.undoStack.length > 0 && !this.gesture }
  get canRedo() { return this.redoStack.length > 0 && !this.gesture }
  get active() { return this.gesture !== null }
  begin(before: SessionDraft) { if (!this.gesture) this.gesture = structuredClone(before) }
  finish(after: SessionDraft) {
    const before = this.gesture; this.gesture = null
    if (before) this.record(before, after)
  }
  abort() { const before = this.gesture; this.gesture = null; return before && structuredClone(before) }
  record(before: SessionDraft, after: SessionDraft) {
    if (JSON.stringify(before) === JSON.stringify(after)) return
    this.undoStack.push(structuredClone(before)); this.redoStack = []
    if (this.undoStack.length > LIMITS.history) this.undoStack.shift()
  }
  undo(current: SessionDraft) {
    if (!this.canUndo) return null
    this.redoStack.push(structuredClone(current)); return structuredClone(this.undoStack.pop()!)
  }
  redo(current: SessionDraft) {
    if (!this.canRedo) return null
    this.undoStack.push(structuredClone(current)); return structuredClone(this.redoStack.pop()!)
  }
  clear() { this.undoStack = []; this.redoStack = []; this.gesture = null }
}
