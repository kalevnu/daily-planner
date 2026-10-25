import { useEffect, useState } from "react";

interface Toast {
  id: number;
  message: string;
  undo?: () => void;
}

let toasts: Toast[] = [];
let nextId = 1;
const subscribers = new Set<(t: Toast[]) => void>();

function publish() {
  subscribers.forEach((s) => s(toasts));
}

// Shows a short message at the bottom. Deletions offer "되돌리기" instead of a
// confirmation dialog.
export function showToast(message: string, undo?: () => void) {
  const toast = { id: nextId++, message, undo };
  toasts = [...toasts.slice(-2), toast];
  publish();
  setTimeout(() => dismiss(toast.id), 5000);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  publish();
}

export function Toasts() {
  const [items, setItems] = useState<Toast[]>(toasts);
  useEffect(() => {
    subscribers.add(setItems);
    return () => void subscribers.delete(setItems);
  }, []);
  return (
    <div className="toasts" role="status">
      {items.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.message}</span>
          {t.undo && (
            <button
              className="toast-undo"
              onClick={() => {
                t.undo!();
                dismiss(t.id);
              }}
            >
              되돌리기
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
