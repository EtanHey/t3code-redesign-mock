// Seed only these demo threads' native disclosure memory before their first mount. Subsequent
// visitor toggles use the app's usual memory. This exposes commentary and image output on open.
import { RunId } from "@t3tools/contracts";
import { rememberTimelinePosition, readTimelinePosition } from "~/components/chat/timelineScrollAnchoring";

export function openDemoWork(threadId: string, options: { itemIds?: string[]; fromTop?: boolean; runNumbers?: number[] } = {}) {
  const key = `redesign-preview:${threadId}`;
  if (readTimelinePosition(key)) return;
  const itemIds = options.itemIds ?? [];
  rememberTimelinePosition(key, {
    rowId: `${threadId}-item-0`, offsetWithinRow: 0, scrollOffset: 0, atEnd: !options.fromTop,
    disclosures: {
      runs: new Set((options.runNumbers ?? [1]).map(n => RunId.make(`${threadId}-run-${n}`))),
      workGroups: new Set(itemIds.map(id => `work-group:${id}`)),
      attempts: new Set(),
      workGroupState: { scrollPositions: new Map(), expandedEntries: new Set(itemIds) },
    },
  }, false);
}
