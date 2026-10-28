import { updateRow } from "../data/store";
import { NOTE_COLORS, createNote, hideNote, removeNote, showNote } from "./actions";
import { useTable } from "./hooks";
import { NoteEditor } from "./NoteEditor";

export function NotesView() {
  const notes = useTable("notes").sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return (
    <div>
      <header className="page-head row">
        <div>
          <h1>메모</h1>
          <p className="summary">바탕화면에 띄운 메모 {notes.filter((n) => n.is_open).length}개 · 전체 {notes.length}개</p>
        </div>
        <button className="btn btn-primary" onClick={() => createNote("", true)}>
          + 새 스티커 메모
        </button>
      </header>
      <div className="note-grid">
        {notes.map((n) => (
          <div key={n.id} className={`note-card note-${n.color}`}>
            <div className="note-card-bar">
              <div className="note-colors">
                {NOTE_COLORS.map((c) => (
                  <button key={c} className={`note-swatch note-${c} ${c === n.color ? "on" : ""}`} onClick={() => updateRow("notes", n.id, { color: c })} aria-label={c} />
                ))}
              </div>
              <span className="spacer" />
              {n.is_open ? (
                <button className="chip" title="바탕화면에서 내리기 (메모는 남아요)" onClick={() => hideNote(n.id)}>
                  내리기
                </button>
              ) : (
                <button className="chip" title="바탕화면에 스티커로 띄우기" onClick={() => showNote(n)}>
                  띄우기
                </button>
              )}
              <button className="icon-btn" onClick={() => removeNote(n)} aria-label="삭제">
                🗑
              </button>
            </div>
            <NoteEditor note={n} />
          </div>
        ))}
        {notes.length === 0 && <p className="empty">아직 메모가 없어요. 단축키(기본 Ctrl+Alt+N)로 어디서든 새 메모를 띄울 수 있어요.</p>}
      </div>
    </div>
  );
}
