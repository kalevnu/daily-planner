import { useEffect, useRef, useState } from "react";
import type { Task } from "../core/types";
import { dropIndex, moveId } from "../core/order";
import { reorderTasks } from "./actions";

interface Drag {
  id: string;
  from: number;
  to: number;
  dy: number;
  size: number; // height of the dragged row plus the gap below it
}

const THRESHOLD = 5; // px of movement before a press becomes a drag

// A task list whose rows can be dragged up and down. A plain click still
// opens the task; the checkbox and other buttons keep working.
export function SortableTaskList({ tasks, renderItem }: { tasks: Task[]; renderItem: (t: Task) => React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Order shown right after a drop, until the saved order comes back.
  const [pending, setPending] = useState<string[] | null>(null);

  const ids = tasks.map((t) => t.id);
  const key = ids.join(",");
  useEffect(() => {
    if (pending && (pending.join(",") === key || pending.length !== ids.length)) setPending(null);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const shown = pending && pending.every((id) => byId.has(id)) ? pending.map((id) => byId.get(id)!) : tasks;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, textarea, a")) return;
    const rows = Array.from(box.current?.children ?? []) as HTMLElement[];
    const rects = rows.map((r) => r.getBoundingClientRect());
    const from = shown.findIndex((t) => t.id === id);
    if (from < 0 || rects.length !== shown.length) return;
    const mids = rects.map((r) => r.top + r.height / 2);
    const gap = rects.length > 1 ? Math.max(0, (rects[1]?.top ?? 0) - (rects[0]?.bottom ?? 0)) : 0;
    const size = rects[from].height + gap;
    const startY = e.clientY;
    const row = e.currentTarget;
    const pointer = e.pointerId;
    let current: Drag | null = null;

    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (!current && Math.abs(dy) < THRESHOLD) return;
      if (!current) {
        try {
          row.setPointerCapture(pointer);
        } catch {
          // The pointer may already be gone; the window listeners still work.
        }
      }
      ev.preventDefault();
      current = { id, from, size, dy, to: dropIndex(mids, from, mids[from] + dy) };
      setDrag(current);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!current) return;
      // The press was a drag, so the click that follows must not open the task.
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      const done = current;
      current = null;
      setDrag(null);
      if (done.to === done.from) return;
      const next = moveId(
        shown.map((t) => t.id),
        done.id,
        done.to,
      );
      setPending(next);
      reorderTasks(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // How far each row is pushed while another row is dragged across it.
  const offset = (i: number): number => {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.size;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return drag.size;
    return 0;
  };

  return (
    <div className={`task-list sortable ${drag ? "sorting" : ""}`} ref={box}>
      {shown.map((t, i) => (
        <div
          key={t.id}
          className={`sortable-row ${drag?.id === t.id ? "dragging" : ""}`}
          data-task-id={t.id}
          style={offset(i) ? { transform: `translateY(${offset(i)}px)` } : undefined}
          onPointerDown={(e) => onPointerDown(e, t.id)}
        >
          {renderItem(t)}
        </div>
      ))}
    </div>
  );
}
