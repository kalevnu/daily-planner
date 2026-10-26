import type { Priority, Task } from "../core/types";
import { updateRow } from "../data/store";
import { useTable, useToday } from "./hooks";
import { pickForToday, removeTask, toggleTask, unpickFromToday } from "./actions";
import { CommitInput, CommitTextarea, Field, ReminderPicker, RepeatPicker } from "./fields";
import { Checkbox } from "./tasks";

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 0, label: "없음" },
  { value: 1, label: "낮음" },
  { value: 2, label: "보통" },
  { value: 3, label: "높음" },
];

export function TaskEditor({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const tasks = useTable("tasks");
  const lists = useTable("lists");
  const today = useToday();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;

  const set = (patch: Partial<Task>) => updateRow("tasks", task.id, patch);
  const onToday = task.today_pinned_on === today || task.due_date === today;

  return (
    <aside className="editor">
      <div className="editor-head">
        <Checkbox checked={task.status === "done"} onChange={() => toggleTask(task)} />
        <CommitInput className="editor-title" value={task.title} onCommit={(title) => title.trim() && set({ title: title.trim() })} />
        <button className="icon-btn" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>

      <div className="editor-body">
        <Field label="날짜">
          <input type="date" value={task.due_date ?? ""} onChange={(e) => set({ due_date: e.target.value || null, ...(e.target.value ? {} : { rrule: null }) })} />
          {task.due_date && (
            <button className="link-btn" onClick={() => set({ due_date: null, due_time: null, rrule: null, remind_minutes: null })}>
              지우기
            </button>
          )}
        </Field>
        <Field label="시간">
          <input
            type="time"
            value={task.due_time ?? ""}
            disabled={!task.due_date}
            onChange={(e) => set({ due_time: e.target.value || null, ...(e.target.value ? {} : { remind_minutes: null }) })}
          />
        </Field>
        <Field label="반복">
          {task.due_date ? (
            <RepeatPicker rule={task.rrule} startDate={task.due_date} onChange={(rrule) => set({ rrule })} />
          ) : (
            <span className="muted">날짜를 먼저 정하세요</span>
          )}
        </Field>
        <Field label="알림">
          <ReminderPicker minutes={task.remind_minutes} disabled={!task.due_time} onChange={(remind_minutes) => set({ remind_minutes })} />
        </Field>
        <Field label="우선순위">
          <div className="segmented">
            {PRIORITIES.map((p) => (
              <button key={p.value} className={`${task.priority === p.value ? "on" : ""} prio-btn-${p.value}`} onClick={() => set({ priority: p.value })}>
                {p.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="목록">
          <select value={task.list_id ?? ""} onChange={(e) => set({ list_id: e.target.value || null })}>
            <option value="">목록 없음</option>
            {[...lists]
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="메모">
          <CommitTextarea value={task.note} placeholder="자세한 내용" onCommit={(note) => set({ note })} />
        </Field>

        <div className="editor-actions">
          {task.due_date !== today &&
            (onToday ? (
              <button className="btn" onClick={() => unpickFromToday(task)}>
                오늘 할 일에서 빼기
              </button>
            ) : (
              <button className="btn" onClick={() => pickForToday(task)}>
                ☀ 오늘 할 일에 추가
              </button>
            ))}
          <button
            className="btn btn-danger"
            onClick={() => {
              removeTask(task);
              onClose();
            }}
          >
            삭제
          </button>
        </div>
      </div>
    </aside>
  );
}
