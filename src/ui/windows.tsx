// Content of the secondary windows: the morning briefing, the "today" sticky
// and individual sticky notes.
import { useEffect, useState } from "react";
import { buildToday } from "../core/today";
import { formatDateKo, formatTimeKo, timePart } from "../core/dates";
import { getSetting, setSetting, updateRow } from "../data/store";
import { closeCurrent, openTodaySticky, setCurrentAlwaysOnTop, showMainWindow, trackGeometry, type WindowGeometry } from "../platform/desktop";
import { NOTE_COLORS, createNote, hideNote } from "./actions";
import { useTable, useToday } from "./hooks";
import { NoteEditor } from "./notes";
import { QuickAdd, TaskItem } from "./tasks";
import { TodayView } from "./TodayView";
import { Toasts } from "./toast";

export const TODAY_STICKY_GEOMETRY_KEY = "today_sticky_geom";
export const TODAY_STICKY_OPEN_KEY = "today_sticky_open";
export const DEFAULT_TODAY_STICKY: WindowGeometry = { x: null, y: null, width: 320, height: 420 };

export async function showTodaySticky() {
  const saved = await getSetting(TODAY_STICKY_GEOMETRY_KEY);
  await setSetting(TODAY_STICKY_OPEN_KEY, "1");
  await openTodaySticky(saved ? JSON.parse(saved) : DEFAULT_TODAY_STICKY);
}

export function BriefingWindow() {
  return (
    <div className="briefing">
      <div className="briefing-scroll">
        <TodayView briefing />
      </div>
      <footer className="briefing-foot">
        <button className="btn" onClick={() => showTodaySticky()}>
          📌 오늘 할 일 바탕화면에 띄우기
        </button>
        <button className="btn" onClick={() => showMainWindow("today")}>
          전체 보기
        </button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => closeCurrent()}>
          오늘 시작하기
        </button>
      </footer>
      <Toasts />
    </div>
  );
}

export function TodayStickyWindow() {
  const today = useToday();
  const tasks = useTable("tasks");
  const events = useTable("events");
  const lists = useTable("lists");
  const s = buildToday(tasks, events, today);
  const items = [...s.overdue, ...s.tasks];

  useEffect(() => {
    let off = () => {};
    trackGeometry((g) => setSetting(TODAY_STICKY_GEOMETRY_KEY, JSON.stringify(g))).then((f) => (off = f));
    return () => off();
  }, []);

  return (
    <div className="sticky sticky-today note-yellow">
      <div className="sticky-bar" data-tauri-drag-region>
        <span className="sticky-title" data-tauri-drag-region>
          오늘 할 일 · {formatDateKo(today)}
        </span>
        <button className="icon-btn" title="메인 창 열기" onClick={() => showMainWindow("today")}>
          ↗
        </button>
        <button
          className="icon-btn"
          title="닫기"
          onClick={async () => {
            await setSetting(TODAY_STICKY_OPEN_KEY, "0");
            await closeCurrent();
          }}
        >
          ✕
        </button>
      </div>
      <div className="sticky-body">
        {s.events.map((o) => (
          <div key={o.key} className="sticky-event">
            <i style={{ background: o.event.color }} />
            <span className="sticky-event-time">{timePart(o.start) ? formatTimeKo(timePart(o.start)!) : "종일"}</span>
            <span>{o.event.title}</span>
          </div>
        ))}
        <div className="task-list">
          {items.map((t) => (
            <TaskItem key={t.id} task={t} lists={lists} compact />
          ))}
          {s.doneToday.map((t) => (
            <TaskItem key={t.id} task={t} lists={lists} compact />
          ))}
        </div>
        {items.length === 0 && s.doneToday.length === 0 && <p className="empty">오늘 할 일이 없어요.</p>}
      </div>
      <QuickAdd defaults={{ due_date: today }} placeholder="오늘 할 일 추가" />
      <Toasts />
    </div>
  );
}

export function NoteWindow({ id }: { id: string }) {
  const notes = useTable("notes");
  const note = notes.find((n) => n.id === id);
  const [loaded, setLoaded] = useState(false);
  const [showColors, setShowColors] = useState(false);

  useEffect(() => {
    if (notes.length) setLoaded(true);
  }, [notes.length]);

  // The note was deleted or hidden from another window.
  useEffect(() => {
    if (loaded && (!note || !note.is_open)) closeCurrent();
  }, [loaded, note]);

  useEffect(() => {
    let off = () => {};
    trackGeometry((g) => updateRow("notes", id, { pos_x: g.x, pos_y: g.y, width: g.width, height: g.height })).then((f) => (off = f));
    return () => off();
  }, [id]);

  if (!note) return null;
  const pinned = !!note.is_pinned;

  return (
    <div className={`sticky note-${note.color}`}>
      <div className="sticky-bar" data-tauri-drag-region>
        <button className="icon-btn" title="새 메모" onClick={() => createNote("", true)}>
          +
        </button>
        <span className="spacer" data-tauri-drag-region />
        <div className="sticky-colors">
          <button className="icon-btn" title="색상" onClick={() => setShowColors(!showColors)}>
            ●
          </button>
          {showColors && (
            <div className="color-pop">
              {NOTE_COLORS.map((c) => (
                <button
                  key={c}
                  className={`note-swatch note-${c} ${c === note.color ? "on" : ""}`}
                  onClick={() => {
                    updateRow("notes", id, { color: c });
                    setShowColors(false);
                  }}
                  aria-label={c}
                />
              ))}
            </div>
          )}
        </div>
        <button
          className={`icon-btn ${pinned ? "on" : ""}`}
          title={pinned ? "항상 위 해제" : "항상 위에 고정"}
          onClick={async () => {
            await updateRow("notes", id, { is_pinned: pinned ? 0 : 1 });
            await setCurrentAlwaysOnTop(!pinned);
          }}
        >
          📌
        </button>
        <button className="icon-btn" title="바탕화면에서 내리기 (메모는 남아요)" onClick={() => hideNote(id)}>
          ✕
        </button>
      </div>
      <div className="sticky-body">
        <NoteEditor note={note} autoEdit />
      </div>
    </div>
  );
}
