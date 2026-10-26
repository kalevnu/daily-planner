# End-to-end check of the installed app on a real Windows desktop (CI).
# Installs the NSIS build, drives it with real mouse/keyboard input and UI
# Automation, and checks windows (count, owner, z-order, topmost), the SQLite
# database and the registry. Screenshots go to $OutDir for review.
param(
  [Parameter(Mandatory)] [string] $Installer,
  [string] $OutDir = "e2e-out"
)

$ErrorActionPreference = "Stop"
# A script error is recorded as a failed check and the run goes on, so one
# broken step does not hide the results of the rest.
trap { Check "스크립트 오류 없음" $false "$($_.InvocationInfo.ScriptLineNumber): $_"; continue }
# Run in Korean time, as the user does; the briefing waits until 5 a.m. local.
Set-TimeZone -Id "Korea Standard Time"
New-Item -ItemType Directory -Force $OutDir | Out-Null
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  public struct RECT { public int L, T, R, B; }
  public static List<IntPtr> All() {
    var l = new List<IntPtr>();
    EnumWindows((h, p) => { l.Add(h); return true; }, IntPtr.Zero);
    return l; // top of the z-order first
  }
  public static string Title(IntPtr h) { var s = new StringBuilder(256); GetWindowText(h, s, 256); return s.ToString(); }
}
"@

$results = New-Object System.Collections.Generic.List[object]
function Check($name, [bool] $ok, $detail = "") {
  $results.Add([pscustomobject]@{ Check = $name; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Detail = "$detail" })
  Write-Host ("[{0}] {1} {2}" -f $(if ($ok) { "PASS" } else { "FAIL" }), $name, $detail)
}

function Shot($name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save((Join-Path $OutDir "$name.png"))
  # A small JPEG copy goes into the log too, so the shots can be read where
  # artifact downloads are not reachable.
  $small = New-Object System.Drawing.Bitmap $bmp, ([int]($b.Width * 0.6)), ([int]($b.Height * 0.6))
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq "image/jpeg"
  $params = New-Object System.Drawing.Imaging.EncoderParameters 1
  $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 55L
  $ms = New-Object System.IO.MemoryStream
  $small.Save($ms, $codec, $params)
  $b64 = [Convert]::ToBase64String($ms.ToArray())
  for ($i = 0; $i -lt $b64.Length; $i += 4000) { Write-Host "SHOT $name $($b64.Substring($i, [Math]::Min(4000, $b64.Length - $i)))" }
  $ms.Dispose(); $small.Dispose(); $g.Dispose(); $bmp.Dispose()
}

function Click([int] $x, [int] $y) {
  [W]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 120
  [W]::mouse_event(0x2, 0, 0, 0, [UIntPtr]::Zero)
  [W]::mouse_event(0x4, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 400
}

function Keys($text) { [System.Windows.Forms.SendKeys]::SendWait($text); Start-Sleep -Milliseconds 300 }

$AppPids = @()
function AppWindows {
  $z = 0
  foreach ($h in [W]::All()) {
    $z++
    $procId = 0
    [W]::GetWindowThreadProcessId($h, [ref] $procId) | Out-Null
    if ($AppPids -notcontains [int]$procId) { continue }
    $title = [W]::Title($h)
    if (-not $title) { continue }
    $r = New-Object W+RECT
    [W]::GetWindowRect($h, [ref] $r) | Out-Null
    $ex = [W]::GetWindowLongPtr($h, -20).ToInt64()
    $owner = [W]::GetWindow($h, 4)
    [pscustomobject]@{
      Hwnd = $h; Title = $title; Visible = [W]::IsWindowVisible($h); Owner = $owner; Z = $z
      Topmost = [bool]($ex -band 0x8); Tool = [bool]($ex -band 0x80); AppWin = [bool]($ex -band 0x40000)
      L = $r.L; T = $r.T; R = $r.R; B = $r.B
    }
  }
}
function Visible($title) { @(AppWindows | Where-Object { $_.Visible -and $_.Title -eq $title }) }
# The first matching window, or $null (indexing an empty result throws).
function First($title) { Visible $title | Select-Object -First 1 }
# Approximation of the shell's Alt+Tab rule: visible, not a tool window, and
# either unowned or explicitly marked as an app window.
function AltTabEntries { @(AppWindows | Where-Object { $_.Visible -and -not $_.Tool -and ($_.Owner -eq [IntPtr]::Zero -or $_.AppWin) }) }

$DbPath = Join-Path $env:APPDATA "com.kalevnu.dailyplanner\planner.db"
function Sql($query) {
  $py = "import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps(c.execute(sys.argv[2]).fetchall(), ensure_ascii=False))"
  $out = python -c $py $DbPath $query
  return ,($out | ConvertFrom-Json)
}

function Uia($hwnd, $name, [switch] $Like) {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($el in $all) {
    $n = $el.Current.Name
    if (($Like -and $n -like $name) -or (-not $Like -and $n -eq $name)) { return $el }
  }
  return $null
}
# Press a control through UI Automation (works even if another window covers
# it); fall back to a real mouse click.
function ClickEl($el) {
  try {
    $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Milliseconds 500
  } catch {
    $r = $el.Current.BoundingRectangle
    Click ([int]($r.X + $r.Width / 2)) ([int]($r.Y + $r.Height / 2))
  }
}

function Start-App {
  $p = Start-Process -FilePath $script:Exe -PassThru
  Start-Sleep -Seconds 20
  $script:AppPids = @(Get-Process | Where-Object { $_.Path -eq $script:Exe } | ForEach-Object { $_.Id })
  return $p
}
function Stop-App {
  Get-Process | Where-Object { $_.Path -eq $script:Exe } | Stop-Process -Force
  Start-Sleep -Seconds 3
}

# ---- install ----------------------------------------------------------------
Start-Process -FilePath $Installer -ArgumentList "/S" -Wait
$script:Exe = Get-ChildItem -Recurse -Filter "daily-planner.exe" -Path "$env:LOCALAPPDATA\Daily Planner", "$env:ProgramFiles\Daily Planner" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
Check "설치 파일로 설치됨" ([bool]$script:Exe) $script:Exe
if (-not $script:Exe) { $results | Format-Table -AutoSize | Out-String | Write-Host; exit 1 }

# ---- first run ----------------------------------------------------------------
Start-App | Out-Null
Shot "01-first-run"
Check "메인 창이 보임" ((Visible "Daily Planner").Count -eq 1)
if ((Get-Date).Hour -ge 5) {
  Check "첫 실행에 브리핑 창이 뜸" ((Visible "오늘 브리핑").Count -eq 1)
} else {
  Check "새벽 5시 전에는 브리핑이 안 뜸" ((Visible "오늘 브리핑").Count -eq 0) "local=$(Get-Date -Format HH:mm)"
}
$notes = Visible "메모"
Check "환영 메모 창이 정확히 1개" ($notes.Count -eq 1) "count=$($notes.Count)"
Check "DB: 메모 1개, 목록 2개" (((Sql "select count(*) from notes")[0][0] -eq 1) -and ((Sql "select count(*) from lists")[0][0] -eq 2))

$briefing = (First "오늘 브리핑")
if ($briefing) {
  $btn = Uia $briefing.Hwnd "오늘 시작하기"
  if ($btn) { ClickEl $btn }
  Start-Sleep -Seconds 1
  Check "브리핑 '오늘 시작하기'로 닫힘" ((Visible "오늘 브리핑").Count -eq 0)
}

# ---- restart: nothing duplicated --------------------------------------------
Stop-App
Start-App | Out-Null
Shot "02-restart"
Check "재시작 후에도 메모 창 1개" ((Visible "메모").Count -eq 1) "count=$((Visible '메모').Count)"
Check "같은 날 재시작하면 브리핑 안 뜸" ((Visible "오늘 브리핑").Count -eq 0)
Check "재시작 후 DB 메모 1개" ((Sql "select count(*) from notes")[0][0] -eq 1)

# ---- new notes with the global shortcut --------------------------------------
Keys "^%n"; Start-Sleep -Seconds 3
Keys "^%n"; Start-Sleep -Seconds 3
$notes = Visible "메모"
Check "Ctrl+Alt+N 두 번 → 메모 창 3개" ($notes.Count -eq 3) "count=$($notes.Count)"
$positions = @($notes | ForEach-Object { "$($_.L),$($_.T)" } | Sort-Object -Unique)
Check "새 메모가 겹치지 않고 비켜서 열림" ($positions.Count -eq $notes.Count) ($positions -join " ")

# ---- Notion-style editing in the newest note ---------------------------------
Keys "# Test{ENTER}{[}{]} milk{ENTER}eggs{ENTER}{ENTER}**bold** text"
Start-Sleep -Seconds 2
$content = (Sql "select content from notes order by created_at desc limit 1")[0][0]
Check "마크다운 입력이 서식으로 저장됨" ($content -eq "# Test`n`n- [ ] milk`n- [ ] eggs`n`n**bold** text") ($content -replace "`n", "\n")
Shot "03-markdown"

# ---- Alt+Tab treats all stickies as one ---------------------------------------
$entries = AltTabEntries
$stickyEntries = @($entries | Where-Object { $_.Title -eq "메모" -or $_.Title -eq "오늘 할 일" })
Check "메모 창은 Alt+Tab에 따로 나오지 않음" ($stickyEntries.Count -eq 0) (($entries | ForEach-Object Title) -join ", ")
Check "스티커 묶음이 Alt+Tab에 한 항목으로 나옴" (@($entries | Where-Object Title -eq "Daily Planner 메모").Count -eq 1)
$hostWin = @(AppWindows | Where-Object Title -eq "Daily Planner 메모")[0]
$owned = @(Visible "메모" | Where-Object { $_.Owner -eq $hostWin.Hwnd })
Check "모든 메모 창의 소유자가 묶음 창" ($owned.Count -eq (Visible "메모").Count)

$notepad = Start-Process notepad -PassThru
Start-Sleep -Seconds 3
$npHwnd = [W]::All() | Where-Object { [W]::IsWindowVisible($_) -and ([W]::Title($_) -like "*Notepad*" -or [W]::Title($_) -like "*메모장*") } | Select-Object -First 1
Check "비교용 메모장 실행" ([bool]$npHwnd)
$npRect = New-Object W+RECT
[W]::GetWindowRect($npHwnd, [ref] $npRect) | Out-Null
# Click the notepad title bar near its left edge, away from the stickies.
Click ($npRect.L + 60) ($npRect.T + 12)
Start-Sleep -Seconds 1
Shot "04-notepad-front"
# Alt+Tab once
[W]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 100
[W]::keybd_event(0x09, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 100
[W]::keybd_event(0x09, 0, 2, [UIntPtr]::Zero); Start-Sleep -Milliseconds 300
[W]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Seconds 2
Shot "05-after-alt-tab"
$fg = [W]::GetForegroundWindow()
$fgTitle = [W]::Title($fg)
Check "Alt+Tab 한 번으로 메모 묶음으로 돌아옴" ($fgTitle -eq "메모" -or $fgTitle -eq "Daily Planner 메모") "foreground=$fgTitle"
$order = [W]::All()
$npZ = $order.IndexOf($npHwnd)
$behind = @(Visible "메모" | Where-Object { $order.IndexOf($_.Hwnd) -gt $npZ })
Check "Alt+Tab 후 모든 메모가 메모장보다 앞에 있음" ($behind.Count -eq 0) "behind=$($behind.Count)"
Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force

# ---- close a note with its X button --------------------------------------------
$n = (First "메모")
Click ($n.R - 18) ($n.T + 18)
Start-Sleep -Seconds 2
Check "메모 X 버튼으로 창이 닫힘" ((Visible "메모").Count -eq 2) "count=$((Visible '메모').Count)"
Check "닫은 메모는 DB에 남고 열림 표시만 꺼짐" (((Sql "select count(*) from notes")[0][0] -eq 3) -and ((Sql "select count(*) from notes where is_open=1")[0][0] -eq 2))

# ---- today sticky and its pin ---------------------------------------------------
Keys "^%t"; Start-Sleep -Seconds 3
$briefing = (First "오늘 브리핑")
Check "Ctrl+Alt+T로 브리핑 열림" ([bool]$briefing)
if ($briefing) {
  $btn = Uia $briefing.Hwnd "*바탕화면에 띄우기*" -Like
  if ($btn) { ClickEl $btn }
  Start-Sleep -Seconds 3
}
$today = (First "오늘 할 일")
Check "오늘 할 일 스티커가 뜸" ([bool]$today)
if ($today) {
  Check "오늘 할 일 스티커는 기본으로 항상 위" $today.Topmost
  Check "오늘 할 일 스티커도 묶음 창 소유" ($today.Owner -eq $hostWin.Hwnd)
  Click ($today.R - 48) ($today.T + 18)
  Start-Sleep -Seconds 1
  $today = (First "오늘 할 일")
  Check "📌 누르면 항상 위 해제" (-not $today.Topmost)
  Check "고정 해제가 저장됨" ((Sql "select value from settings where id='today_sticky_pinned'")[0][0] -eq "0")
  Click ($today.R - 48) ($today.T + 18)
  Start-Sleep -Seconds 1
  Check "📌 다시 누르면 항상 위" ((First "오늘 할 일").Topmost)
}
$briefing = (First "오늘 브리핑")
if ($briefing) { $btn = Uia $briefing.Hwnd "오늘 시작하기"; if ($btn) { ClickEl $btn } }
Shot "06-today-sticky"

# ---- quick add in the main window -----------------------------------------------
$main = (First "Daily Planner")
Click ($main.L + 60) ($main.T + 160) # sidebar, never under a sticky
$input = Uia $main.Hwnd "*오늘 할 일 추가*" -Like
Check "메인 창의 빠른 입력란 찾음" ([bool]$input)
if ($input) { $input.SetFocus(); Start-Sleep -Milliseconds 300 }
$due = (Get-Date).AddMinutes(1)
Keys ("{0:HH}:{0:mm} e2e alarm {{!}}1{{ENTER}}" -f $due)
Start-Sleep -Seconds 2
$task = Sql "select title, due_date, due_time, priority, remind_minutes from tasks where title='e2e alarm'"
Check "빠른 입력으로 할 일 저장 (시간·우선순위·알림)" ($task.Count -eq 1 -and $task[0][2] -eq $due.ToString("HH:mm") -and $task[0][3] -eq 3 -and $task[0][4] -eq 0) ($task | ConvertTo-Json -Compress)
Shot "07-quick-add"

# ---- reminder notification -----------------------------------------------------------
# The reminder fires at the due minute; the main window checks every 30 s.
$wait = [int](($due - (Get-Date)).TotalSeconds) + 45
if ($wait -gt 0) { Start-Sleep -Seconds $wait }
Shot "08-notification"
$fired = (Sql "select value from settings where id='fired_reminders'")
Check "알림이 발송됨 (발송 기록)" ($fired.Count -eq 1 -and $fired[0][0] -like "*task:*") ($fired | ConvertTo-Json -Compress)

# ---- settings: autostart -----------------------------------------------------------
$main = (First "Daily Planner")
$nav = Uia $main.Hwnd "*설정"
if (-not $nav) { $nav = Uia $main.Hwnd "*설정*" -Like }
if ($nav) { ClickEl $nav }
Start-Sleep -Seconds 1
$toggle = Uia $main.Hwnd "자동 실행"
if ($toggle) { ClickEl $toggle }
Start-Sleep -Seconds 2
$run = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue
$entry = $run.PSObject.Properties | Where-Object { "$($_.Value)" -like "*daily-planner*" }
Check "자동 실행 켜면 시작 프로그램에 등록" ([bool]$entry) "$($entry.Value)"
Shot "09-settings"

# ---- closing the main window keeps the app in the tray ----------------------------
$main = (First "Daily Planner")
[W]::PostMessage($main.Hwnd, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null # WM_CLOSE
Start-Sleep -Seconds 2
Check "메인 창을 닫으면 숨겨지고 앱은 계속 실행" (((Visible "Daily Planner").Count -eq 0) -and (@(Get-Process | Where-Object { $_.Path -eq $script:Exe }).Count -gt 0))
Check "메인 창을 닫아도 메모는 그대로" ((Visible "메모").Count -eq 2)

Stop-App

$results | Format-Table -AutoSize | Out-String -Width 300 | Write-Host
$md = "| 검사 | 결과 | 내용 |`n| --- | --- | --- |`n" + (($results | ForEach-Object { "| $($_.Check) | $($_.Result) | $($_.Detail -replace '\|', '/') |" }) -join "`n")
Set-Content -Path (Join-Path $OutDir "results.md") -Value $md -Encoding utf8
if ($env:GITHUB_STEP_SUMMARY) { Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value "## Windows E2E`n`n$md" -Encoding utf8 }
if ($results | Where-Object Result -eq "FAIL") { exit 1 }
