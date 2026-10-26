import { useEffect, useState } from "react";
import type { Task, TaskList } from "../core/types";
import { buildToday } from "../core/today";
import { createRow, deleteRow, listAll, updateRow } from "../data/store";
import { onAppEvent } from "../platform/desktop";
import { LIST_COLORS } from "./actions";
import { CalendarView } from "./CalendarView";
import { EventEditor, type EventDraft } from "./EventEditor";
import { useTable, useToday } from "./hooks";
import { NotesView } from "./notes";
import { SettingsView } from "./SettingsView";
import { TaskEditor } from "./TaskEditor";
import { ListView, UpcomingView } from "./TaskListViews";
import { Toasts } from "./toast";
import { TodayView } from "./TodayView";

type View = "today" | "upcoming" | "calendar" | "notes" | "settings" | `list:${string}`;

function NavItem({ active, icon, label, count, onClick }: { active: boolean; icon: string; label: string; count?: number; onClick: () => void }) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {!!count && <span className="nav-count">{count}</span>}
    </button>
  );
}

function ListNavItem({ list, active, count, onClick }: { list: TaskList; active: boolean; count: number; onClick: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);
  if (editing) {
    return (
      <input
        className="nav-input"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim()) updateRow("lists", list.id, { name: name.trim() });
          setEditing(false);
        }}
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (e.target as HTMLInputElement).blur()}
      />
    );
  }
  return (
    <div className={`nav-item list-item ${active ? "active" : ""}`} onClick={onClick} onDoubleClick={() => setEditing(true)} title="더블클릭해서 이름 바꾸기">
      <span className="nav-icon">
        <i className="list-dot" style={{ background: list.color }} />
      </span>
      <span className="nav-label">{list.name}</span>
      {!!count && <span className="nav-count">{count}</span>}
      <button
        className="nav-del"
        title="목록 삭제 (할 일은 '목록 없음'으로 이동)"
        onClick={async (e) => {
          e.stopPropagation();
          for (const t of await listAll("tasks")) if (t.list_id === list.id) await updateRow("tasks", t.id, { list_id: null });
          await deleteRow("lists", list.id);
        }}
      >
        ✕
      </button>
    </div>
  );
}

export function App() {
  const [view, setView] = useState<View>("today");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [newList, setNewList] = useState<string | null>(null);
  const today = useToday();
  const tasks = useTable("tasks");
  const events = useTable("events");
  const lists = [...useTable("lists")].sort((a, b) => a.sort_order - b.sort_order);
  const summary = buildToday(tasks, events, today);

  useEffect(() => {
    let off = () => {};
    onAppEvent("navigate", (v) => setView(v as View)).then((f) => (off = f));
    return () => off();
  }, []);

  const openTask = (t: Task) => setTaskId(t.id);
  const go = (v: View) => {
    setView(v);
    setTaskId(null);
  };
  const todoCount = (listId: string) => tasks.filter((t) => t.list_id === listId && t.status === "todo").length;

  let content: React.ReactNode;
  if (view === "today") {
    content = <TodayView onOpenTask={openTask} onOpenEvent={(o) => setEventDraft({ ...o.event, occurrenceDate: o.start.slice(0, 10) })} selectedTaskId={taskId} />;
  } else if (view === "upcoming") {
    content = <UpcomingView onOpenTask={openTask} selectedTaskId={taskId} />;
  } else if (view === "calendar") {
    content = <CalendarView onOpenTask={openTask} />;
  } else if (view === "notes") {
    content = <NotesView />;
  } else if (view === "settings") {
    content = <SettingsView />;
  } else {
    const id = view.slice(5);
    content = <ListView key={id} listId={id === "none" ? null : id} onOpenTask={openTask} selectedTaskId={taskId} />;
  }

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-mark">◐</span> Daily Planner
        </div>
        <NavItem active={view === "today"} icon="☀" label="오늘" count={summary.tasks.length + summary.overdue.length} onClick={() => go("today")} />
        <NavItem active={view === "upcoming"} icon="▤" label="예정" count={summary.upcoming.length} onClick={() => go("upcoming")} />
        <NavItem active={view === "calendar"} icon="▦" label="캘린더" onClick={() => go("calendar")} />
        <NavItem active={view === "notes"} icon="✎" label="메모" onClick={() => go("notes")} />

        <div className="nav-heading">
          목록
          <button className="nav-add" title="목록 추가" onClick={() => setNewList("")}>
            +
          </button>
        </div>
        {lists.map((l) => (
          <ListNavItem key={l.id} list={l} active={view === `list:${l.id}`} count={todoCount(l.id)} onClick={() => go(`list:${l.id}`)} />
        ))}
        {newList != null && (
          <input
            className="nav-input"
            autoFocus
            placeholder="새 목록 이름"
            value={newList}
            onChange={(e) => setNewList(e.target.value)}
            onBlur={async () => {
              if (newList.trim()) {
                const l = await createRow("lists", { name: newList.trim(), color: LIST_COLORS[lists.length % LIST_COLORS.length], sort_order: lists.length });
                go(`list:${l.id}`);
              }
              setNewList(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setNewList(null);
            }}
          />
        )}
        <NavItem active={view === "list:none"} icon="○" label="목록 없음" onClick={() => go("list:none")} />

        <span className="spacer" />
        <NavItem active={view === "settings"} icon="⚙" label="설정" onClick={() => go("settings")} />
      </nav>

      <main className={`content ${view === "calendar" ? "content-wide" : ""}`}>{content}</main>

      {taskId && <TaskEditor taskId={taskId} onClose={() => setTaskId(null)} />}
      {eventDraft && <EventEditor draft={eventDraft} onClose={() => setEventDraft(null)} />}
      <Toasts />
    </div>
  );
}
