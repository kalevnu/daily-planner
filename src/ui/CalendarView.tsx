import { useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import koLocale from "@fullcalendar/core/locales/ko";
import type { DateSelectArg, EventClickArg, EventDropArg, EventInput } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import type { CalendarEvent, Task } from "../core/types";
import { addDays, datePart, toDateStr, toDateTimeStr } from "../core/dates";
import { expandEvents } from "../core/recurrence";
import { updateRow } from "../data/store";
import { useTable } from "./hooks";
import { EventEditor, type EventDraft } from "./EventEditor";

interface Props {
  onOpenTask: (t: Task) => void;
}

// FullCalendar treats an all-day end date as exclusive; ours is inclusive.
function toFcEnd(ev: { all_day: number }, end: string) {
  return ev.all_day ? addDays(end, 1) : end;
}

function fromFcRange(start: Date, end: Date | null, allDay: boolean) {
  if (allDay) {
    const s = toDateStr(start);
    return { start: s, end: end ? addDays(toDateStr(end), -1) : s };
  }
  const s = toDateTimeStr(start);
  return { start: s, end: end ? toDateTimeStr(end) : toDateTimeStr(new Date(start.getTime() + 3600000)) };
}

export function CalendarView({ onOpenTask }: Props) {
  const events = useTable("events");
  const tasks = useTable("tasks");
  const lists = useTable("lists");
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);

  const fcEvents = useMemo<EventInput[]>(() => {
    if (!range) return [];
    const occ = expandEvents(events, range.from, range.to).map<EventInput>((o) => ({
      id: o.key,
      title: o.event.title,
      start: o.start,
      end: toFcEnd(o.event, o.end),
      allDay: !!o.event.all_day,
      backgroundColor: o.event.color,
      borderColor: o.event.color,
      editable: !o.event.rrule,
      extendedProps: { kind: "event", eventId: o.event.id, date: datePart(o.start) },
    }));
    const taskItems = tasks
      .filter((t) => t.due_date && t.due_date >= range.from && t.due_date <= range.to)
      .map<EventInput>((t) => {
        const color = lists.find((l) => l.id === t.list_id)?.color ?? "#64748b";
        return {
          id: `task:${t.id}`,
          title: `${t.status === "done" ? "✓" : "○"} ${t.title}`,
          start: t.due_time ? `${t.due_date}T${t.due_time}` : t.due_date!,
          allDay: !t.due_time,
          classNames: ["fc-task", t.status === "done" ? "fc-task-done" : ""],
          textColor: color,
          backgroundColor: "transparent",
          borderColor: "transparent",
          extendedProps: { kind: "task", taskId: t.id },
        };
      });
    return [...occ, ...taskItems];
  }, [events, tasks, lists, range]);

  const onSelect = (arg: DateSelectArg) => {
    const r = fromFcRange(arg.start, arg.end, arg.allDay);
    setDraft({ start: r.start, end: r.end, all_day: arg.allDay ? 1 : 0 });
    arg.view.calendar.unselect();
  };

  const onClick = (arg: EventClickArg) => {
    const p = arg.event.extendedProps;
    if (p.kind === "task") {
      const t = tasks.find((x) => x.id === p.taskId);
      if (t) onOpenTask(t);
      return;
    }
    const ev = events.find((e) => e.id === p.eventId);
    if (ev) setDraft({ ...ev, occurrenceDate: p.date });
  };

  const onMove = (arg: EventDropArg | EventResizeDoneArg) => {
    const p = arg.event.extendedProps;
    const allDay = arg.event.allDay;
    if (p.kind === "task") {
      const start = arg.event.start!;
      updateRow("tasks", p.taskId, { due_date: toDateStr(start), due_time: allDay ? null : toDateTimeStr(start).slice(11) });
      return;
    }
    const r = fromFcRange(arg.event.start!, arg.event.end, allDay);
    updateRow("events", p.eventId, { start: r.start, end: r.end, all_day: allDay ? 1 : 0 } as Partial<CalendarEvent>);
  };

  return (
    <div className="calendar">
      <div className="calendar-hint">빈 칸을 끌어서 기간 일정을 만들고, 일정을 끌어서 날짜를 옮길 수 있어요.</div>
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        locale={koLocale}
        initialView="dayGridMonth"
        headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay" }}
        height="100%"
        selectable
        editable
        dayMaxEvents={4}
        nowIndicator
        scrollTime="08:00:00"
        events={fcEvents}
        select={onSelect}
        eventClick={onClick}
        eventDrop={onMove}
        eventResize={onMove}
        datesSet={(arg) => {
          const from = toDateStr(arg.start);
          const to = addDays(toDateStr(arg.end), -1);
          if (from !== range?.from || to !== range?.to) setRange({ from, to });
        }}
      />
      {draft && <EventEditor draft={draft} onClose={() => setDraft(null)} />}
    </div>
  );
}
