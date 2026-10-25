import type { Task } from "../core/types";
import { addDays, formatDateKo, relativeDayKo } from "../core/dates";
import { compareTasks } from "../core/today";
import { useTable, useToday } from "./hooks";
import { EmptyLine, QuickAdd, Section, TaskItem } from "./tasks";

interface Props {
  onOpenTask: (t: Task) => void;
  selectedTaskId: string | null;
}

// Next 14 days grouped by date, then tasks without a date.
export function UpcomingView({ onOpenTask, selectedTaskId }: Props) {
  const today = useToday();
  const tasks = useTable("tasks").filter((t) => t.status === "todo");
  const lists = useTable("lists");
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i + 1));
  const undated = tasks.filter((t) => !t.due_date).sort(compareTasks);
  const later = tasks.filter((t) => t.due_date && t.due_date > days[days.length - 1]).sort(compareTasks);

  return (
    <div>
      <header className="page-head">
        <h1>예정</h1>
        <p className="summary">앞으로 2주 동안의 할 일</p>
      </header>
      <QuickAdd placeholder="할 일 추가 (예: 금요일 정산 #업무)" />
      {days.map((d) => {
        const items = tasks.filter((t) => t.due_date === d).sort(compareTasks);
        if (!items.length) return null;
        return (
          <Section key={d} title={`${relativeDayKo(d, today)} · ${formatDateKo(d)}`} count={items.length}>
            <div className="task-list">
              {items.map((t) => (
                <TaskItem key={t.id} task={t} lists={lists} onOpen={onOpenTask} selected={t.id === selectedTaskId} compact />
              ))}
            </div>
          </Section>
        );
      })}
      {later.length > 0 && (
        <Section title="그 이후" count={later.length} collapsible>
          <div className="task-list">
            {later.map((t) => (
              <TaskItem key={t.id} task={t} lists={lists} onOpen={onOpenTask} selected={t.id === selectedTaskId} />
            ))}
          </div>
        </Section>
      )}
      <Section title="날짜 없음" count={undated.length} collapsible>
        <div className="task-list">
          {undated.map((t) => (
            <TaskItem key={t.id} task={t} lists={lists} onOpen={onOpenTask} selected={t.id === selectedTaskId} />
          ))}
        </div>
        {undated.length === 0 && <EmptyLine>날짜 없는 할 일이 없어요.</EmptyLine>}
      </Section>
    </div>
  );
}

export function ListView({ listId, onOpenTask, selectedTaskId }: Props & { listId: string | null }) {
  const tasks = useTable("tasks").filter((t) => t.list_id === listId);
  const lists = useTable("lists");
  const list = lists.find((l) => l.id === listId);
  const todo = tasks.filter((t) => t.status === "todo").sort(compareTasks);
  const done = tasks
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));

  return (
    <div>
      <header className="page-head">
        <h1>
          {list && <i className="list-swatch" style={{ background: list.color }} />}
          {list?.name ?? "목록 없음"}
        </h1>
        <p className="summary">할 일 {todo.length}개</p>
      </header>
      <QuickAdd defaults={{ list_id: listId }} autoFocus />
      <div className="task-list">
        {todo.map((t) => (
          <TaskItem key={t.id} task={t} lists={lists} onOpen={onOpenTask} selected={t.id === selectedTaskId} />
        ))}
      </div>
      {todo.length === 0 && <EmptyLine>남은 할 일이 없어요.</EmptyLine>}
      {done.length > 0 && (
        <Section title="완료" count={done.length} collapsible defaultOpen={false}>
          <div className="task-list">
            {done.slice(0, 50).map((t) => (
              <TaskItem key={t.id} task={t} lists={lists} onOpen={onOpenTask} selected={t.id === selectedTaskId} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
