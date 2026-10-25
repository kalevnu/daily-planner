import { useState } from "react";
import type { CalendarEvent } from "../core/types";
import { datePart, timePart } from "../core/dates";
import { createRow, updateRow } from "../data/store";
import { LIST_COLORS, newEvent, removeEvent, removeOccurrence } from "./actions";
import { ColorDots, Field, ReminderPicker, RepeatPicker } from "./fields";

export type EventDraft = Partial<CalendarEvent> & { occurrenceDate?: string };

export function EventEditor({ draft, onClose }: { draft: EventDraft; onClose: () => void }) {
  const existing = draft.id ? (draft as CalendarEvent) : null;
  const [ev, setEv] = useState(() => ({ ...newEvent({}), ...draft }));
  const set = (patch: Partial<CalendarEvent>) => setEv((cur) => ({ ...cur, ...patch }));

  const allDay = !!ev.all_day;
  const startDate = datePart(ev.start);
  const endDate = datePart(ev.end);
  const startTime = timePart(ev.start) ?? "09:00";
  const endTime = timePart(ev.end) ?? "10:00";

  const setDates = (sd: string, st: string, ed: string, et: string) => {
    let start = allDay ? sd : `${sd}T${st}`;
    let end = allDay ? ed : `${ed}T${et}`;
    if (end < start) end = start;
    set({ start, end });
  };

  const save = async () => {
    const title = ev.title.trim() || "새 일정";
    const { occurrenceDate: _o, id, created_at: _c, updated_at: _u, deleted_at: _d, ...fields } = ev as EventDraft & CalendarEvent;
    if (existing && id) await updateRow("events", id, { ...fields, title });
    else await createRow("events", { ...newEvent({}), ...fields, title });
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
        }}
      >
        <input className="modal-title" autoFocus placeholder="일정 제목" value={ev.title} onChange={(e) => set({ title: e.target.value })} />

        <Field label="종일">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) =>
              e.target.checked
                ? set({ all_day: 1, start: startDate, end: endDate })
                : set({ all_day: 0, start: `${startDate}T${startTime}`, end: `${endDate}T${endTime}` })
            }
          />
        </Field>
        <Field label="시작">
          <input type="date" value={startDate} onChange={(e) => e.target.value && setDates(e.target.value, startTime, endDate < e.target.value ? e.target.value : endDate, endTime)} />
          {!allDay && <input type="time" value={startTime} onChange={(e) => e.target.value && setDates(startDate, e.target.value, endDate, endTime)} />}
        </Field>
        <Field label="종료">
          <input type="date" value={endDate} onChange={(e) => e.target.value && setDates(startDate, startTime, e.target.value, endTime)} />
          {!allDay && <input type="time" value={endTime} onChange={(e) => e.target.value && setDates(startDate, startTime, endDate, e.target.value)} />}
        </Field>
        <Field label="반복">
          <RepeatPicker rule={ev.rrule} startDate={startDate} onChange={(rrule) => set({ rrule })} />
        </Field>
        <Field label="알림">
          <ReminderPicker minutes={ev.remind_minutes} onChange={(remind_minutes) => set({ remind_minutes })} />
        </Field>
        <Field label="색상">
          <ColorDots colors={LIST_COLORS} value={ev.color} onChange={(color) => set({ color })} />
        </Field>
        <Field label="장소">
          <input value={ev.location} placeholder="장소" onChange={(e) => set({ location: e.target.value })} />
        </Field>
        <Field label="메모">
          <textarea rows={3} value={ev.note} placeholder="자세한 내용" onChange={(e) => set({ note: e.target.value })} />
        </Field>

        <div className="modal-actions">
          {existing && existing.rrule && draft.occurrenceDate && (
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                removeOccurrence(existing, draft.occurrenceDate!);
                onClose();
              }}
            >
              이 날만 삭제
            </button>
          )}
          {existing && (
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                removeEvent(existing);
                onClose();
              }}
            >
              {existing.rrule ? "반복 전체 삭제" : "삭제"}
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn btn-primary" onClick={save}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
