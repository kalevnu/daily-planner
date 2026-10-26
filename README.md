# Daily Planner

출근하면 오늘 할 일과 일정을 먼저 보여주는 개인용 데스크톱 일정 관리 앱입니다.
할 일, 캘린더, 바탕화면 스티커 메모, 알림을 한 프로그램에서 다룹니다.

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 출근 브리핑 | 하루에 처음 실행될 때(새벽 5시 이후) 오늘 일정, 오늘 할 일, 밀린 일을 한 창에 보여줍니다. 밀린 일은 "오늘로 / 내일로" 버튼으로 바로 옮길 수 있습니다. |
| 오늘 할 일 스티커 | 오늘 할 일을 항상 위에 떠 있는 작은 스티커로 띄우고, 거기서 바로 체크하거나 추가합니다. |
| 스티커 메모 | 바탕화면에 붙는 메모 창. `- [ ] ` 로 시작하는 줄은 체크박스가 됩니다. 위치·크기·색상·항상 위 설정이 저장됩니다. |
| 할 일 | 날짜·시간·우선순위·목록·메모·알림, 반복(매일 / 평일 / 매주 요일 / 매월 / 매년). 반복 할 일은 체크하면 다음 날짜로 넘어갑니다. |
| 캘린더 | 월·주·일 보기. 빈 칸을 끌어서 기간 일정을 만들고, 일정을 끌어서 옮깁니다. 할 일도 날짜에 함께 표시됩니다. |
| 알림 | Windows 알림 센터로 일정·할 일 알림 (정각, 5분·10분·30분·1시간·1일 전). |
| 빠른 입력 | `내일 오후 3시 보고서 제출 !1 #업무` 처럼 한 줄로 날짜·시간·우선순위·목록을 지정합니다. |
| 트레이·자동 시작 | 창을 닫아도 트레이에서 계속 실행됩니다. 설정에서 "컴퓨터를 켜면 자동으로 실행"을 켜면 로그인 때 조용히 시작해 브리핑만 띄웁니다. |

### 단축키 (어느 프로그램에서든 동작)

- `Ctrl + Alt + N` 새 스티커 메모
- `Ctrl + Alt + T` 오늘 브리핑 열기

## 설치 (Windows)

1. GitHub 저장소의 **Actions** 탭에서 가장 최근의 성공한 `build` 실행을 엽니다.
2. 아래쪽 **Artifacts** 의 `DailyPlanner-windows-installer` 를 내려받아 압축을 풉니다.
3. `Daily Planner_x.y.z_x64-setup.exe` 를 실행합니다.

데이터는 `%APPDATA%\com.kalevnu.dailyplanner\planner.db` (SQLite) 한 파일에 저장됩니다. 이 파일을 복사해 두면 백업이 됩니다.

## 개발

필요한 것: Node.js 22, Rust (stable), Windows에서는 WebView2 (Windows 10/11에 기본 포함).

```bash
npm install
npm run tauri dev     # 데스크톱 앱으로 실행
npm run dev           # 브라우저에서 화면만 확인 (localStorage에 저장)
npm test              # 핵심 로직 테스트
npx tauri build       # 설치 파일 만들기
```

### 구조

```
src/core/       화면과 무관한 로직 (모바일 앱과 공유 예정)
  types.ts        데이터 모델 (모든 행에 동기화용 id/updated_at/deleted_at)
  recurrence.ts   반복 규칙 (iCalendar RRULE)
  today.ts        오늘 요약, 반복 할 일 완료, 알림 계산
  quickParse.ts   한 줄 빠른 입력 해석
src/data/       저장소 (데스크톱: SQLite, 브라우저: localStorage) + 창 간 변경 알림
src/platform/   Tauri 창·알림·자동 시작·단축키 래퍼
src/ui/         React 화면
src/background.ts  메인 창에서 도는 작업 (브리핑, 알림, 창 복원, 단축키, 트레이)
src-tauri/      Rust 쪽 (트레이, 창 닫기 → 트레이로, 플러그인 등록)
```

모든 창은 같은 페이지를 열고 주소의 `#` 뒤 경로로 화면을 고릅니다 (`#/briefing`, `#/today-sticky`, `#/note/<id>`).
메인 창은 닫아도 숨겨질 뿐이라 알림과 브리핑이 계속 동작합니다.

## 로드맵

1. **PC MVP** (현재) — 브리핑, 할 일, 캘린더, 스티커 메모, 알림
2. **동기화** — Supabase 로그인과 PC↔클라우드 동기화 (데이터 구조는 이미 대비됨)
3. **모바일 앱** — React Native(Expo)로 `src/core` 를 공유
4. **다듬기** — Google·Outlook 캘린더 연동, 통계, Mac 버전
