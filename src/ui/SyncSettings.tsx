import { useEffect, useState } from "react";
import { getSyncStatus, saveServerConfig, serverConfig, signIn, signOut, signUp, syncNow, watchSyncStatus, type SyncStatus } from "../data/cloud";

function useSyncStatus(): SyncStatus {
  const [s, setS] = useState(getSyncStatus);
  useEffect(() => watchSyncStatus(setS), []);
  return s;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;

// Server address and public key, for builds that do not carry them.
function ServerForm({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  useEffect(() => {
    serverConfig().then((c) => {
      setUrl(c.url);
      setKey(c.key);
    });
  }, []);
  return (
    <div className="sync-form">
      <input type="text" placeholder="서버 주소 (https://....supabase.co)" aria-label="동기화 서버 주소" value={url} onChange={(e) => setUrl(e.target.value)} />
      <input type="text" placeholder="공개 키 (anon / publishable)" aria-label="동기화 공개 키" value={key} onChange={(e) => setKey(e.target.value)} />
      <div className="button-row">
        <button
          className="btn"
          disabled={!url.trim() || !key.trim()}
          onClick={async () => {
            await saveServerConfig(url, key);
            onSaved();
          }}
        >
          서버 저장
        </button>
      </div>
    </div>
  );
}

export function SyncSettings() {
  const s = useSyncStatus();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editServer, setEditServer] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const signedIn = s.phase === "idle" || s.phase === "syncing" || s.phase === "error";
  let desc = "같은 계정으로 로그인한 PC끼리 할 일·일정·메모·목록이 자동으로 맞춰져요.";
  if (s.phase === "unconfigured") desc = "동기화 서버(Supabase) 주소와 공개 키를 넣어 주세요.";
  if (s.phase === "syncing") desc = `${s.email} · 동기화 중...`;
  if (s.phase === "idle") desc = `${s.email} · ${s.lastSyncedAt ? `${when(s.lastSyncedAt)} 동기화됨` : "곧 동기화해요"}`;
  if (s.phase === "error") desc = `${s.email} · 동기화 실패: ${s.error}`;

  return (
    <>
      <h3 className="settings-sub">PC 간 동기화</h3>
      <div className="setting-row">
        <div>
          <div className="setting-name">{signedIn ? "동기화 켜짐" : "동기화 꺼짐"}</div>
          <div className="setting-desc" role="status" aria-label="동기화 상태">
            {desc}
          </div>
        </div>
        <div className="button-row">
          {signedIn && (
            <>
              <button className="btn" disabled={s.phase === "syncing"} onClick={() => syncNow()}>
                지금 동기화
              </button>
              <button className="btn" onClick={() => act(signOut)}>
                로그아웃
              </button>
            </>
          )}
          {!signedIn && s.phase !== "unconfigured" && (
            <button className="link-btn" onClick={() => setEditServer((v) => !v)}>
              서버 바꾸기
            </button>
          )}
        </div>
      </div>

      {(s.phase === "unconfigured" || (editServer && !signedIn)) && <ServerForm onSaved={() => setEditServer(false)} />}

      {s.phase === "signed-out" && (
        <form
          className="sync-form"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => signIn(email, password));
          }}
        >
          <input type="email" placeholder="이메일" aria-label="동기화 이메일" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="비밀번호 (6자 이상)" aria-label="동기화 비밀번호" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="button-row">
            <button className="btn btn-primary" type="submit" disabled={busy || !email || !password}>
              로그인
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy || !email || !password}
              onClick={() =>
                act(async () => {
                  const ok = await signUp(email, password);
                  if (!ok) setMessage("가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.");
                })
              }
            >
              처음이면 가입
            </button>
          </div>
          <div className="setting-desc">두 번째 PC부터는 같은 이메일과 비밀번호로 로그인만 하면 돼요. 이 PC에 있던 내용은 계정에 합쳐져요.</div>
        </form>
      )}
      {message && (
        <p className="shortcut-problem" role="alert">
          {message}
        </p>
      )}
    </>
  );
}
