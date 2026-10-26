// Notion-style note editor. Markdown shortcuts turn into formatting as you
// type ("# " heading, "- " list, "[] " checkbox, "**bold**" ...), and "/"
// opens a block menu. The note is stored as Markdown.
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import type { Note } from "../core/types";
import { tidyMarkdown } from "../core/markdown";
import { updateRow } from "../data/store";

interface SlashItem {
  label: string;
  hint: string;
  keywords: string;
  run: (e: Editor) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  { label: "텍스트", hint: "", keywords: "text paragraph 텍스트 본문", run: (e) => e.chain().focus().setParagraph().run() },
  { label: "제목 1", hint: "#", keywords: "h1 heading 제목", run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { label: "제목 2", hint: "##", keywords: "h2 heading 제목", run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { label: "제목 3", hint: "###", keywords: "h3 heading 제목", run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { label: "체크리스트", hint: "[]", keywords: "todo task check 할일 체크", run: (e) => e.chain().focus().toggleTaskList().run() },
  { label: "글머리 목록", hint: "-", keywords: "bullet list 목록", run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: "번호 목록", hint: "1.", keywords: "number ordered list 번호", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: "인용", hint: ">", keywords: "quote 인용", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: "코드", hint: "```", keywords: "code 코드", run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { label: "구분선", hint: "---", keywords: "divider hr line 구분선", run: (e) => e.chain().focus().setHorizontalRule().run() },
];

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((i) => i.label.toLowerCase().includes(q) || i.keywords.toLowerCase().includes(q));
}

const MENU_MAX_HEIGHT = 260;

interface SlashState {
  query: string;
  from: number; // document position of the "/"
  top: number;
  left: number;
  maxHeight: number;
  index: number;
}

// The "/word" right before the caret, if the caret sits in a text block.
function findSlash(editor: Editor): Pick<SlashState, "query" | "from"> | null {
  const { $from, empty } = editor.state.selection;
  if (!empty || editor.isActive("codeBlock")) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const m = before.match(/(^|\s)\/([^\s/]{0,12})$/);
  if (!m) return null;
  return { query: m[2], from: $from.pos - m[2].length - 1 };
}

function getMarkdown(editor: Editor): string {
  return tidyMarkdown(editor.storage.markdown.getMarkdown() as string);
}

export function NoteEditor({ note, autoFocus }: { note: Note; autoFocus?: boolean }) {
  const [slash, setSlash] = useState<SlashState | null>(null);
  const slashRef = useRef<SlashState | null>(null);
  slashRef.current = slash;
  const wrap = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const lastSaved = useRef(note.content);

  const save = (editor: Editor) => {
    clearTimeout(timer.current);
    const md = getMarkdown(editor);
    if (md === lastSaved.current) return;
    lastSaved.current = md;
    updateRow("notes", note.id, { content: md });
  };

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "입력하거나 / 를 눌러 블록 추가" }),
      Markdown.configure({ html: false, tightLists: true, bulletListMarker: "-", breaks: true, transformPastedText: true }),
    ],
    content: note.content,
    autofocus: autoFocus && !note.content ? "end" : false,
    editorProps: {
      attributes: { class: "note-editor", spellcheck: "false" },
      handleKeyDown: (_view, event) => {
        const s = slashRef.current;
        if (!s) return false;
        const items = filterSlashItems(s.query);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const step = event.key === "ArrowDown" ? 1 : -1;
          setSlash({ ...s, index: (s.index + step + items.length) % Math.max(items.length, 1) });
          return true;
        }
        if ((event.key === "Enter" || event.key === "Tab") && items.length) {
          applySlash(items[s.index] ?? items[0]);
          return true;
        }
        if (event.key === "Escape") {
          setSlash(null);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => save(editor), 500);
      updateSlash(editor);
    },
    onSelectionUpdate: ({ editor }) => updateSlash(editor),
    onBlur: ({ editor }) => {
      save(editor);
      // Let a click on the slash menu land before it closes.
      setTimeout(() => setSlash(null), 150);
    },
  });

  function updateSlash(editor: Editor) {
    const found = findSlash(editor);
    if (!found) {
      if (slashRef.current) setSlash(null);
      return;
    }
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    const box = wrap.current?.getBoundingClientRect();
    const prev = slashRef.current;
    // Open below the caret, or above it when the small sticky window has more room there.
    const below = window.innerHeight - coords.bottom - 8;
    const above = coords.top - 8;
    const height = Math.min(MENU_MAX_HEIGHT, filterSlashItems(found.query).length * 31 + 10);
    const flip = below < height && above > below;
    const maxHeight = Math.max(80, Math.min(MENU_MAX_HEIGHT, flip ? above : below));
    setSlash({
      ...found,
      index: prev && prev.query === found.query ? prev.index : 0,
      top: (flip ? coords.top - Math.min(height, maxHeight) - 4 : coords.bottom + 4) - (box?.top ?? 0),
      left: Math.max(0, Math.min(coords.left - (box?.left ?? 0) - 4, (box?.width ?? 300) - 170)),
      maxHeight,
    });
  }

  function applySlash(item: SlashItem) {
    const s = slashRef.current;
    if (!editor || !s) return;
    editor.chain().focus().deleteRange({ from: s.from, to: editor.state.selection.from }).run();
    item.run(editor);
    setSlash(null);
  }

  // Take in changes made from another window while this one is not being edited.
  useEffect(() => {
    if (!editor || editor.isFocused || note.content === lastSaved.current) return;
    lastSaved.current = note.content;
    editor.commands.setContent(note.content, false);
  }, [editor, note.content]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const items = slash ? filterSlashItems(slash.query) : [];

  return (
    <div className="note-editor-wrap" ref={wrap} onClick={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}>
      <EditorContent editor={editor} />
      {slash && items.length > 0 && (
        <div className="slash-menu" style={{ top: slash.top, left: slash.left, maxHeight: slash.maxHeight }} onMouseDown={(e) => e.preventDefault()}>
          {items.map((item, i) => (
            <button key={item.label} className={i === slash.index ? "on" : ""} onMouseEnter={() => setSlash({ ...slash, index: i })} onClick={() => applySlash(item)}>
              <span>{item.label}</span>
              {item.hint && <kbd>{item.hint}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
