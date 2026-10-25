import type { Occurrence, Task } from "../core/types";
import { datePart, diffDays, formatDateKo, formatTimeKo, timePart } from "../core/dates";
import { buildToday } from "../core/today";
import { useTable, useToday } from "./hooks";
import { EmptyLine, QuickAdd, Section, TaskItem } from "./tasks";

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "늦은 시간이에요";
  if (h < 12) return "좋은 아침이에요";
  if (h < 18) return "좋은 오후예요";
  return "좋은 저녁이에요";
}

export function EventRow({ occ, today, onOpen }: { occ: Occurrence; today: string; onOpen?: (o: Occurrence) => void }) {
  const ev = occ.event;
  const startTime = timePart(occ.start);
  const endTime = timePart(occ.end);
  const span = diffDays(occ.start, occ.end);
  let when: string;
  if (span > 0) when = `${span + 1}일 중 ${diffDays(occ.start, today) + 1}일째`;
  else if (ev.all_day || !startTime) when = "종일";
  else when = `${formatTimeKo(startTime)}${endTime ? ` – ${formatTimeKo(endTime)}` : ""}`;

  return (
    <div className="event-row" onClick={() => onOpen?.(occ)}>
      <span className="event-bar" style={{ background: ev.color }} />
      <div className="event-when">{when}</div>
      <div className="event-body">
        <div className="event-title">{ev.title}</div>
        {(ev.location || span > 0) && (
          <div className="event-sub">
            {span > 0 && `${formatDateKo(datePart(occ.start))} ~ ${formatDateKo(datePart(occ.end))}`}
            {span > 0 && ev.location && " · "}
            {ev.location}
          </div>
        )}
      </div>
    </div>
  );
}

interface TodayViewProps {
  onOpenTask?: (t: Task) => void;
  onOpenEvent?: (o: Occurrence) => void;
  selectedTaskId?: string | null;
  briefing?: boolean;
}

export function TodayView({ onOpenTask, onOpenEvent, selectedTaskId, briefing }: TodayViewProps) {
  const today = useToday();
  const tasks = useTable("tasks");
  const events = useTable("events");
  const lists = useTable("lists");
  const s = buildToday(tasks, events, today);

  const summary = [
    `일정 ${s.events.length}개`,
    `할 일 ${s.tasks.length}개`,
    ...(s.overdue.length ? [`밀린 일 ${s.overdue.length}개`] : []),
  ].join(" · ");

  return (
    <div className="today">
      <header className="page-head">
        <div className="eyebrow">{greeting()}</div>
        <h1>{formatDateKo(today)}</h1>
        <p className="summary">{summary}</p>
      </header>

      <Section title="오늘 일정" count={s.events.length}>
        {s.events.length ? (
          <div className="event-list">
            {s.events.map((o) => (
              <EventRow key={o.key} occ={o} today={today} onOpen={onOpenEvent} />
            ))}
          </div>
        ) : (
          <EmptyLine>오늘은 일정이 없어요.</EmptyLine>
        )}
      </Section>

      <Section title="오늘 할 일" count={s.tasks.length}>
        <QuickAdd defaults={{ due_date: today }} autoFocus={!briefing} placeholder="오늘 할 일 추가 (예: 3시 보고서 제출 !1)" />
        <div className="task-list">
          {s.tasks.map((t) => (
            <TaskItem key={t.id} task={t} lists={lists} onOpen={onOpenTask} selected={t.id === selectedTaskId} />
          ))}
        </div>
        {s.tasks.length === 0 && <EmptyLine>오늘 할 일을 추가해 보세요.</EmptyLine>}
      </Section>

      {s.overdue.length > 0 && (
        <Section title="밀린 일" count={s.overdue.length} tone="danger">
          <div className="task-list">
            {s.overdue.map((t) => (
              <TaskItem key={t.id} task={t} lists={lists} onOpen={onOpenTask} selected={t.id === selectedTaskId} showOverdueActions />
            ))}
          </div>
        </Section>
      )}

      {s.upcoming.length > 0 && (
        <Section title="이번 주 예정" count={s.upcoming.length} collapsible defaultOpen={!briefing}>
          <div className="task-list">
            {s.upcoming.map((t) => (
              <TaskItem key={t.id} task={t} lists={lists} onOpen={onOpenTask} selected={t.id === selectedTaskId} />
            ))}
          </div>
        </Section>
      )}

      {s.doneToday.length > 0 && (
        <Section title="오늘 완료" count={s.doneToday.length} collapsible defaultOpen={false}>
          <div className="task-list">
            {s.doneToday.map((t) => (
              <TaskItem key={t.id} task={t} lists={lists} onOpen={onOpenTask} selected={t.id === selectedTaskId} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
