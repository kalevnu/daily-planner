import { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import koLocale from "@fullcalendar/core/locales/ko";
import type { DateSelectArg, DatesSetArg, EventClickArg, EventDropArg, EventInput } from "@fullcalendar/core";
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

// The month view is a rolling six-week grid that the mouse wheel moves a
// week at a time, with no scrollbar; prev/next and 오늘 still jump by month.
const MONTH_VIEW = "dayGridRolling";
const VIEWS = [
  { id: MONTH_VIEW, label: "월" },
  { id: "timeGridWeek", label: "주" },
  { id: "timeGridDay", label: "일" },
];
const WHEEL_STEP = 80; // px of wheel travel per week
const WHEEL_COOLDOWN = 160; // ms between steps, so a flick does not fly off

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

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const firstOfMonth = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1);
const monthTitle = (key: string) => `${key.slice(0, 4)}년 ${Number(key.slice(5, 7))}월`;

// The month that owns most of the visible days names the rolling grid.
export function dominantMonth(start: Date, end: Date): string {
  const days = new Map<string, number>();
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const k = monthKey(d);
    days.set(k, (days.get(k) ?? 0) + 1);
  }
  return [...days.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

export function CalendarView({ onOpenTask }: Props) {
  const events = useTable("events");
  const tasks = useTable("tasks");
  const lists = useTable("lists");
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [viewId, setViewId] = useState(MONTH_VIEW);
  const [title, setTitle] = useState("");
  const [month, setMonth] = useState(monthKey(new Date()));
  const calRef = useRef<FullCalendar>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const wheel = useRef({ acc: 0, last: 0 });
  const api = () => calRef.current?.getApi();

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

  // Wheel over the month grid rolls it by weeks. A native listener so the
  // default scroll can be stopped (React's wheel handler is passive).
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const cal = api();
      if (!cal || cal.view.type !== MONTH_VIEW) return;
      e.preventDefault();
      const w = wheel.current;
      const delta = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      if (Math.sign(delta) !== Math.sign(w.acc)) w.acc = 0;
      w.acc += delta;
      const now = Date.now();
      if (Math.abs(w.acc) < WHEEL_STEP || now - w.last < WHEEL_COOLDOWN) return;
      cal.incrementDate({ weeks: Math.sign(w.acc) });
      w.acc = 0;
      w.last = now;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onDates = (arg: DatesSetArg) => {
    const from = toDateStr(arg.start);
    const to = addDays(toDateStr(arg.end), -1);
    if (from !== range?.from || to !== range?.to) setRange({ from, to });
    setViewId(arg.view.type);
    if (arg.view.type === MONTH_VIEW) {
      const m = dominantMonth(arg.start, arg.end);
      setMonth(m);
      setTitle(monthTitle(m));
    } else {
      setTitle(arg.view.title);
    }
  };

  const go = (dir: -1 | 1) => {
    const cal = api();
    if (!cal) return;
    if (cal.view.type === MONTH_VIEW) {
      const d = firstOfMonth(month);
      cal.gotoDate(new Date(d.getFullYear(), d.getMonth() + dir, 1));
    } else if (dir < 0) cal.prev();
    else cal.next();
  };

  const today = () => {
    const cal = api();
    if (!cal) return;
    if (cal.view.type === MONTH_VIEW) cal.gotoDate(firstOfMonth(monthKey(new Date())));
    else cal.today();
  };

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
      <div className="calendar-hint">
        {viewId === MONTH_VIEW ? "휠을 굴리면 주 단위로 넘어가요. " : ""}빈 칸을 끌어서 기간 일정을 만들고, 일정을 끌어서 날짜를 옮길 수 있어요.
      </div>
      <div className="calendar-toolbar">
        <div className="button-row">
          <button className="btn" onClick={() => go(-1)} aria-label="이전">
            ‹
          </button>
          <button className="btn" onClick={() => go(1)} aria-label="다음">
            ›
          </button>
          <button className="btn" onClick={today}>
            오늘
          </button>
        </div>
        <h2 className="calendar-title">{title}</h2>
        <div className="button-row seg">
          {VIEWS.map((v) => (
            <button key={v.id} className={`btn ${viewId === v.id ? "on" : ""}`} onClick={() => api()?.changeView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div className="calendar-body" ref={wrap}>
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          locale={koLocale}
          initialView={MONTH_VIEW}
          initialDate={firstOfMonth(monthKey(new Date()))}
          views={{ [MONTH_VIEW]: { type: "dayGrid", duration: { weeks: 6 }, dateIncrement: { weeks: 1 } } }}
          headerToolbar={false}
          height="100%"
          selectable
          editable
          dayMaxEvents={4}
          nowIndicator
          scrollTime="08:00:00"
          dayCellContent={(arg) => (arg.date.getDate() === 1 ? `${arg.date.getMonth() + 1}월 1일` : `${arg.date.getDate()}일`)}
          dayCellClassNames={(arg) => (arg.view.type === MONTH_VIEW && monthKey(arg.date) !== month ? ["fc-day-dim"] : [])}
          events={fcEvents}
          select={onSelect}
          eventClick={onClick}
          eventDrop={onMove}
          eventResize={onMove}
          datesSet={onDates}
        />
      </div>
      {draft && <EventEditor draft={draft} onClose={() => setDraft(null)} />}
    </div>
  );
}
