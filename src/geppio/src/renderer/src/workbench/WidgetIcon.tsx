import { AdjustmentsHorizontalIcon, ChartBarIcon, ClockIcon, ClipboardDocumentListIcon, CodeBracketIcon, DocumentTextIcon, FolderIcon, QueueListIcon, Squares2X2Icon } from '@heroicons/react/24/outline'
import type { WidgetType } from '../../../shared/workbench/model.ts'

/** Bundled host artwork only. Manifest v1 does not acquire an icon field. */
export function WidgetIcon({ type, category }: { type?: WidgetType; category?: string }) {
  const Icon = type ? ({ summary: ChartBarIcon, chart: ChartBarIcon, queue: QueueListIcon, library: FolderIcon, notes: ClipboardDocumentListIcon, activity: ClockIcon, properties: AdjustmentsHorizontalIcon }[type.fixture ?? ''] ?? Squares2X2Icon)
    : category === 'all' ? Squares2X2Icon : category === 'Indicadores' ? ChartBarIcon : category === 'Organização' ? QueueListIcon : category === 'Anotações' ? ClipboardDocumentListIcon : category === 'Desenvolvimento' ? CodeBracketIcon : DocumentTextIcon
  return <Icon className="icon" strokeWidth="1.8" aria-hidden="true" />
}
