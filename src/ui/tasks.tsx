import { useState } from "react";
import type { Task, TaskList } from "../core/types";
import { formatTimeKo, relativeDayKo } from "../core/dates";
import { describeRule } from "../core/recurrence";
import { parseQuickAdd } from "../core/quickParse";
import { addTask, moveTaskTo, moveToTomorrow, toggleTask } from "./actions";
import { useTable, useToday } from "./hooks";

const PRIORITY_LABEL = ["", "낮음", "보통", "높음"];

export function Checkbox({ checked, onChange, color }: { checked: boolean; onChange: () => void; color?: string }) {
  return (
    <button
      className={`check ${checked ? "checked" : ""}`}
      style={color ? ({ "--check-color": color } as React.CSSProperties) : undefined}
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
    >
      {checked && (
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

interface TaskItemProps {
  task: Task;
  lists: TaskList[];
  onOpen?: (t: Task) => void;
  selected?: boolean;
  showOverdueActions?: boolean;
  compact?: boolean;
}

export function TaskItem({ task, lists, onOpen, selected, showOverdueActions, compact }: TaskItemProps) {
  const today = useToday();
  const list = lists.find((l) => l.id === task.list_id);
  const done = task.status === "done";
  const overdue = !done && task.due_date != null && task.due_date < today;

  const meta: React.ReactNode[] = [];
  if (task.due_date && !compact) {
    meta.push(
      <span key="due" className={overdue ? "meta-overdue" : ""}>
        {relativeDayKo(task.due_date, today)}
      </span>,
    );
  }
  if (task.due_time) meta.push(<span key="time">{formatTimeKo(task.due_time)}</span>);
  if (task.rrule) meta.push(<span key="rep">↻ {describeRule(task.rrule)}</span>);
  if (list && !compact) {
    meta.push(
      <span key="list" className="meta-list">
        <i style={{ background: list.color }} />
        {list.name}
      </span>,
    );
  }

  return (
    <div
      className={`task ${done ? "done" : ""} ${selected ? "selected" : ""} ${compact ? "compact" : ""} prio-${task.priority}`}
      onClick={() => onOpen?.(task)}
    >
      <Checkbox checked={done} onChange={() => toggleTask(task)} />
      <div className="task-body">
        <div className="task-title">
          {task.priority > 0 && <span className={`flag flag-${task.priority}`} title={`우선순위 ${PRIORITY_LABEL[task.priority]}`} />}
          {task.title}
        </div>
        {meta.length > 0 && <div className="task-meta">{meta}</div>}
      </div>
      {showOverdueActions && !done && (
        <div className="task-actions">
          <button className="chip" onClick={(e) => (e.stopPropagation(), moveTaskTo(task, today))}>
            오늘로
          </button>
          <button className="chip" onClick={(e) => (e.stopPropagation(), moveToTomorrow(task))}>
            내일로
          </button>
        </div>
      )}
    </div>
  );
}

interface QuickAddProps {
  defaults?: Partial<Task>;
  placeholder?: string;
  autoFocus?: boolean;
}

// One-line input. Understands "내일 3시", "금요일", "!1", "#목록".
export function QuickAdd({ defaults, placeholder, autoFocus }: QuickAddProps) {
  const [text, setText] = useState("");
  const today = useToday();
  const lists = useTable("lists");
  const parsed = text.trim() ? parseQuickAdd(text, today, lists) : null;

  const submit = async () => {
    if (!parsed?.title) return;
    await addTask({
      ...defaults,
      title: parsed.title,
      due_date: parsed.due_date ?? defaults?.due_date ?? null,
      due_time: parsed.due_time,
      priority: parsed.priority,
      list_id: parsed.list_id ?? defaults?.list_id ?? null,
      remind_minutes: parsed.due_time ? 0 : null,
    });
    setText("");
  };

  const hint: string[] = [];
  if (parsed?.due_date) hint.push(relativeDayKo(parsed.due_date, today));
  if (parsed?.due_time) hint.push(formatTimeKo(parsed.due_time));
  if (parsed?.priority) hint.push(`우선순위 ${PRIORITY_LABEL[parsed.priority]}`);
  if (parsed?.list_id) hint.push(lists.find((l) => l.id === parsed.list_id)?.name ?? "");

  return (
    <div className="quick-add">
      <span className="quick-add-plus">+</span>
      <input
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder ?? "할 일 추가 (예: 내일 3시 보고서 제출 !1)"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
          if (e.key === "Escape") setText("");
        }}
      />
      {hint.length > 0 && <span className="quick-add-hint">{hint.join(" · ")}</span>}
    </div>
  );
}

export function Section({
  title,
  count,
  children,
  collapsible,
  defaultOpen = true,
  tone,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  tone?: "danger";
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${tone ? `section-${tone}` : ""}`}>
      <h3 className={collapsible ? "clickable" : ""} onClick={() => collapsible && setOpen(!open)}>
        {collapsible && <span className={`caret ${open ? "open" : ""}`}>›</span>}
        {title}
        {count != null && <span className="count">{count}</span>}
      </h3>
      {open && children}
    </section>
  );
}

export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}
