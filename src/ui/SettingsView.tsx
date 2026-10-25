import { useEffect, useState } from "react";
import { getSetting, setSetting } from "../data/store";
import { SHORTCUTS, isAutostartEnabled, notify, setAutostart } from "../platform/desktop";
import { isTauri } from "../platform/env";
import { BRIEFING_ENABLED_KEY, maybeShowBriefing } from "../background";
import { showTodaySticky } from "./windows";

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <button className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} />;
}

const shortcutLabel = (s: string) => s.replace("CommandOrControl", "Ctrl").replace(/\+/g, " + ");

export function SettingsView() {
  const [autostart, setAuto] = useState(false);
  const [briefing, setBriefing] = useState(true);

  useEffect(() => {
    isAutostartEnabled().then(setAuto);
    getSetting(BRIEFING_ENABLED_KEY).then((v) => setBriefing(v !== "0"));
  }, []);

  return (
    <div className="settings">
      <header className="page-head">
        <h1>설정</h1>
      </header>

      <div className="setting-row">
        <div>
          <div className="setting-name">컴퓨터를 켜면 자동으로 실행</div>
          <div className="setting-desc">로그인하면 트레이에서 조용히 시작해요. 출근 브리핑을 받으려면 켜 두세요.</div>
        </div>
        <Toggle
          on={autostart}
          disabled={!isTauri}
          onChange={async (v) => {
            await setAutostart(v);
            setAuto(await isAutostartEnabled());
          }}
        />
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-name">출근 브리핑</div>
          <div className="setting-desc">하루에 처음 실행될 때(새벽 5시 이후) 오늘 일정과 할 일을 보여줘요.</div>
        </div>
        <Toggle
          on={briefing}
          onChange={async (v) => {
            await setSetting(BRIEFING_ENABLED_KEY, v ? "1" : "0");
            setBriefing(v);
          }}
        />
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-name">지금 해 보기</div>
          <div className="setting-desc">각 기능이 어떻게 보이는지 바로 확인해요.</div>
        </div>
        <div className="button-row">
          <button className="btn" onClick={() => maybeShowBriefing(true)} disabled={!isTauri}>
            브리핑 열기
          </button>
          <button className="btn" onClick={() => showTodaySticky()}>
            오늘 할 일 스티커
          </button>
          <button className="btn" onClick={() => notify("알림 테스트", "알림이 이렇게 표시돼요.")}>
            알림 테스트
          </button>
        </div>
      </div>

      <h3 className="settings-sub">단축키 (어느 프로그램에서든 동작)</h3>
      <div className="shortcut-row">
        <kbd>{shortcutLabel(SHORTCUTS.newNote)}</kbd> 새 스티커 메모
      </div>
      <div className="shortcut-row">
        <kbd>{shortcutLabel(SHORTCUTS.briefing)}</kbd> 오늘 브리핑 열기
      </div>

      <h3 className="settings-sub">빠른 입력 문법</h3>
      <ul className="help-list">
        <li>
          <b>오늘 · 내일 · 모레 · 금요일 · 다음주 월요일 · 11월 3일 · 11/3</b> 날짜
        </li>
        <li>
          <b>3시 · 오후 3시 · 9시 30분 · 15:30 · 3시반</b> 시간 (시간을 쓰면 정각 알림이 켜져요)
        </li>
        <li>
          <b>!1 · !2 · !3</b> 우선순위 높음 · 보통 · 낮음
        </li>
        <li>
          <b>#업무</b> 목록 지정
        </li>
      </ul>

      <p className="muted small">데이터는 이 PC에만 저장돼요 (planner.db). PC↔폰 동기화는 2단계에서 추가될 예정이에요.</p>
    </div>
  );
}
