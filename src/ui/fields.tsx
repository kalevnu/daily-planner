import { useEffect, useState } from "react";
import { REMINDER_OPTIONS } from "../core/today";
import { parseLocal } from "../core/dates";
import { WEEKDAY_CODES, WEEKDAY_LABELS, describeRule, repeatPresets, ruleWeekdays, weeklyRule } from "../core/recurrence";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="field-control">{children}</div>
    </label>
  );
}

// Text input that saves on blur or Enter, so typing does not write every key.
export function CommitInput({
  value,
  onCommit,
  className,
  placeholder,
  autoFocus,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className={className}
      value={v}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function CommitTextarea({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea value={v} placeholder={placeholder} rows={3} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} />
  );
}

const CUSTOM = "__custom__";

export function RepeatPicker({ rule, startDate, onChange }: { rule: string | null; startDate: string; onChange: (r: string | null) => void }) {
  const presets = repeatPresets(startDate);
  const matched = presets.find((p) => p.rule === rule);
  const [custom, setCustom] = useState(!matched && !!rule);
  const value = custom ? CUSTOM : matched ? String(presets.indexOf(matched)) : CUSTOM;
  const days = ruleWeekdays(rule);

  return (
    <div className="repeat">
      <select
        value={value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
            onChange(weeklyRule(days.length ? days : [WEEKDAY_CODES[(parseLocal(startDate).getDay() + 6) % 7]]));
          } else {
            setCustom(false);
            onChange(presets[Number(e.target.value)].rule);
          }
        }}
      >
        {presets.map((p, i) => (
          <option key={i} value={i}>
            {p.label}
          </option>
        ))}
        <option value={CUSTOM}>{custom || !matched ? `요일 직접 선택${rule ? ` (${describeRule(rule)})` : ""}` : "요일 직접 선택"}</option>
      </select>
      {value === CUSTOM && (
        <div className="weekday-toggles">
          {WEEKDAY_CODES.map((code, i) => (
            <button
              key={code}
              type="button"
              className={`day-toggle ${days.includes(code) ? "on" : ""}`}
              onClick={() => {
                const next = days.includes(code) ? days.filter((d) => d !== code) : [...days, code];
                const ordered = WEEKDAY_CODES.filter((c) => next.includes(c));
                onChange(ordered.length ? weeklyRule(ordered) : null);
              }}
            >
              {WEEKDAY_LABELS[i]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReminderPicker({ minutes, onChange, disabled }: { minutes: number | null; onChange: (m: number | null) => void; disabled?: boolean }) {
  return (
    <select
      value={minutes == null ? "" : String(minutes)}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    >
      {REMINDER_OPTIONS.map((o) => (
        <option key={o.label} value={o.minutes == null ? "" : String(o.minutes)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ColorDots({ colors, value, onChange }: { colors: readonly string[]; value: string; onChange: (c: string) => void }) {
  return (
    <div className="color-dots">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          className={`color-dot ${c === value ? "on" : ""}`}
          style={{ background: c }}
          aria-label={c}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}
