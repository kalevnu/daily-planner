import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Note } from "../core/types";
import { updateRow } from "../data/store";
import { NOTE_COLORS, createNote, hideNote, removeNote, showNote } from "./actions";
import { useTable } from "./hooks";
import { Checkbox } from "./tasks";

const CHECK_RE = /^(\s*)- \[( |x)\] ?(.*)$/;

export function toggleLine(content: string, index: number): string {
  const lines = content.split("\n");
  const m = lines[index]?.match(CHECK_RE);
  if (!m) return content;
  lines[index] = `${m[1]}- [${m[2] === "x" ? " " : "x"}] ${m[3]}`;
  return lines.join("\n");
}

// Renders note text. "- [ ] 할 일" lines become checkboxes, "- " lines bullets.
export function NoteContent({ content, onToggle }: { content: string; onToggle: (line: number) => void }) {
  if (!content.trim()) return <p className="note-placeholder">클릭해서 메모를 쓰세요. "- [ ] "로 시작하면 체크박스가 돼요.</p>;
  return (
    <div className="note-content">
      {content.split("\n").map((line, i) => {
        const m = line.match(CHECK_RE);
        if (m) {
          return (
            <div key={i} className={`note-check ${m[2] === "x" ? "done" : ""}`}>
              <Checkbox checked={m[2] === "x"} onChange={() => onToggle(i)} />
              <span>{m[3]}</span>
            </div>
          );
        }
        if (/^\s*- /.test(line)) return <div key={i} className="note-bullet">• {line.replace(/^\s*- /, "")}</div>;
        return <div key={i} className="note-line">{line || " "}</div>;
      })}
    </div>
  );
}

// Editable note body: shows rendered text, switches to a textarea on click,
// saves as you type (debounced) and when focus leaves.
export function NoteEditor({ note, autoEdit }: { note: Note; autoEdit?: boolean }) {
  const [editing, setEditing] = useState(!!autoEdit && !note.content);
  const [text, setText] = useState(note.content);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const ref = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);

  // Place the caret after a programmatic edit (checklist continuation).
  useLayoutEffect(() => {
    if (caret.current != null && ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [text]);

  useEffect(() => {
    if (!editing) setText(note.content);
  }, [note.content, editing]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length);
    }
  }, [editing]);

  const save = (v: string) => {
    clearTimeout(timer.current);
    if (v !== note.content) updateRow("notes", note.id, { content: v });
  };

  if (editing) {
    return (
      <textarea
        ref={ref}
        className="note-textarea"
        value={text}
        placeholder={'메모를 입력하세요.\n"- [ ] "로 시작하면 체크박스가 돼요.'}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => save(v), 600);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
          // Continue a checklist on Enter.
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            const el = e.currentTarget;
            const before = el.value.slice(0, el.selectionStart);
            const line = before.split("\n").pop() ?? "";
            const prefix = line.match(/^(\s*- \[[ x]\] |\s*- )/)?.[0];
            if (prefix) {
              e.preventDefault();
              const empty = line.trim() === prefix.trim();
              const next = empty
                ? before.slice(0, before.length - line.length) + el.value.slice(el.selectionEnd)
                : `${before}\n${prefix.replace("[x]", "[ ]")}${el.value.slice(el.selectionEnd)}`;
              caret.current = empty ? before.length - line.length : before.length + 1 + prefix.length;
              setText(next);
              save(next);
            }
          }
        }}
        onBlur={() => {
          save(text);
          setEditing(false);
        }}
      />
    );
  }
  return (
    <div className="note-view" onClick={(e) => (e.target as HTMLElement).closest(".check") || setEditing(true)}>
      <NoteContent content={note.content} onToggle={(i) => updateRow("notes", note.id, { content: toggleLine(note.content, i) })} />
    </div>
  );
}

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
        {notes.length === 0 && <p className="empty">아직 메모가 없어요. Ctrl+Alt+N으로 어디서든 새 메모를 띄울 수 있어요.</p>}
      </div>
    </div>
  );
}
