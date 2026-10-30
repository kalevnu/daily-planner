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
[System.TimeZoneInfo]::ClearCachedData() # so Get-Date in this process follows
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

# Press, move in small steps, release: a real mouse drag.
function Drag([int] $x1, [int] $y1, [int] $x2, [int] $y2) {
  [W]::SetCursorPos($x1, $y1) | Out-Null
  Start-Sleep -Milliseconds 150
  [W]::mouse_event(0x2, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 150
  for ($i = 1; $i -le 20; $i++) {
    [W]::SetCursorPos([int]($x1 + ($x2 - $x1) * $i / 20), [int]($y1 + ($y2 - $y1) * $i / 20)) | Out-Null
    Start-Sleep -Milliseconds 30
  }
  Start-Sleep -Milliseconds 250
  [W]::mouse_event(0x4, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 800
}

function Keys($text) { [System.Windows.Forms.SendKeys]::SendWait($text); Start-Sleep -Milliseconds 300 }
# SendKeys cannot type Korean on the runner's English layout; paste it instead.
function Paste($text) { Set-Clipboard -Value $text; Start-Sleep -Milliseconds 200; Keys "^v" }

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
$env:PYTHONIOENCODING = "utf-8"
# Rows as an array of arrays, even for one row or one column (PowerShell
# likes to unwrap those).
function Sql($query) {
  # ASCII-escaped JSON, so Korean survives the runner's console code page.
  $py = "import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps({'rows': c.execute(sys.argv[2]).fetchall()}))"
  $out = python -c $py $DbPath $query
  $rows = @(($out | ConvertFrom-Json).rows)
  return ,@($rows | ForEach-Object { ,@($_) })
}
function Cell($query) { $r = Sql $query; if ($r.Count) { $r[0][0] } else { $null } }
# A point inside a control's rectangle that no always-on-top sticky covers.
function ClearPoint($rect) {
  $covers = @(AppWindows | Where-Object { $_.Visible -and $_.Topmost })
  $y = [int]($rect.Y + $rect.Height / 2)
  for ($x = [int]($rect.X + 12); $x -lt $rect.X + $rect.Width - 12; $x += 20) {
    $hit = $covers | Where-Object { $x -ge $_.L -and $x -le $_.R -and $y -ge $_.T -and $y -le $_.B }
    if (-not $hit) { return @($x, $y) }
  }
  return @([int]($rect.X + $rect.Width / 2), $y)
}

# The WebView builds its accessibility tree lazily, so look a few times.
function Uia($hwnd, $name, [switch] $Like) {
  for ($try = 0; $try -lt 8; $try++) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($el in $all) {
      $n = $el.Current.Name
      if (($Like -and $n -like $name) -or (-not $Like -and $n -eq $name)) { return $el }
    }
    Start-Sleep -Milliseconds 750
  }
  return $null
}
# 학사일정 items are drawn with a Hanyang-blue left edge (#0e4a84). WebView2
# does not put calendar items in the UI Automation tree, so count those pixels
# in the main window instead.
function AcademicPixels($win) {
  $w = $win.R - $win.L; $h = $win.B - $win.T
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($win.L, $win.T, 0, 0, $bmp.Size)
  $n = 0
  for ($y = 120; $y -lt $h; $y += 3) {
    for ($x = 0; $x -lt $w; $x += 3) {
      $c = $bmp.GetPixel($x, $y)
      if ([Math]::Abs($c.R - 14) -lt 20 -and [Math]::Abs($c.G - 74) -lt 20 -and [Math]::Abs($c.B - 132) -lt 20) { $n++ }
    }
  }
  $g.Dispose(); $bmp.Dispose()
  return $n
}
# Window list for the log: title, z-order, topmost and owner.
function DumpWindows($label) {
  Write-Host "--- windows: $label"
  AppWindows | Where-Object Visible | ForEach-Object { Write-Host ("  z={0} '{1}' topmost={2} owner={3} hwnd={4} [{5},{6},{7},{8}]" -f $_.Z, $_.Title, $_.Topmost, $_.Owner, $_.Hwnd, $_.L, $_.T, $_.R, $_.B) }
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
  # A fresh runner can take a while to bring WebView2 up: wait for the first
  # sticky or briefing window (up to 90 s), then a little more to settle.
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    $script:AppPids = @(Get-Process | Where-Object { $_.Path -eq $script:Exe } | ForEach-Object { $_.Id })
    if ((Visible "메모").Count -gt 0 -or (Visible "오늘 브리핑").Count -gt 0) { break }
  }
  Write-Host "  app up after $($i + 1)s"
  Start-Sleep -Seconds 5
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
Check "DB: 메모 1개, 목록 2개" (((Cell "select count(*) from notes") -eq 1) -and ((Cell "select count(*) from lists") -eq 2))

$briefing = (First "오늘 브리핑")
if ($briefing) {
  $btn = Uia $briefing.Hwnd "오늘 시작하기"
  if ($btn) { ClickEl $btn }
  Start-Sleep -Seconds 2
  Check "브리핑 '오늘 시작하기'로 닫힘" ((Visible "오늘 브리핑").Count -eq 0) "button found=$([bool]$btn)"
}

# ---- restart: nothing duplicated --------------------------------------------
Stop-App
Start-App | Out-Null
Shot "02-restart"
Check "재시작 후에도 메모 창 1개" ((Visible "메모").Count -eq 1) "count=$((Visible '메모').Count)"
Check "같은 날 재시작하면 브리핑 안 뜸" ((Visible "오늘 브리핑").Count -eq 0)
Check "재시작 후 DB 메모 1개" ((Cell "select count(*) from notes") -eq 1)

# ---- new notes with the global shortcut --------------------------------------
Keys "^%n"; Start-Sleep -Seconds 3
Keys "^%n"; Start-Sleep -Seconds 3
$notes = Visible "메모"
Check "Ctrl+Alt+N 두 번 → 메모 창 3개" ($notes.Count -eq 3) "count=$($notes.Count)"
$positions = @($notes | ForEach-Object { "$($_.L),$($_.T)" } | Sort-Object -Unique)
Check "새 메모가 겹치지 않고 비켜서 열림" ($positions.Count -eq $notes.Count) ($positions -join " ")

# ---- Notion-style editing in the newest note ---------------------------------
Keys "# Test{ENTER}{[}{]} milk{ENTER}eggs{ENTER}{ENTER}**bold** text"
for ($i = 0; $i -lt 10; $i++) {
  Start-Sleep -Seconds 1
  $content = Cell "select content from notes order by created_at desc limit 1"
  Write-Host "  saved so far: $($content -replace "`n", '\n')"
  if ($content -like "*bold*") { break }
}
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
Check "닫은 메모는 DB에 남고 열림 표시만 꺼짐" (((Cell "select count(*) from notes") -eq 3) -and ((Cell "select count(*) from notes where is_open=1") -eq 2))

# ---- today sticky and its pin ---------------------------------------------------
Keys "^%d"; Start-Sleep -Seconds 3
$briefing = (First "오늘 브리핑")
Check "Ctrl+Alt+D로 브리핑 열림" ([bool]$briefing)
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
  DumpWindows "before unpin"
  $pin = Uia $today.Hwnd "항상 위 해제"
  Check "📌 버튼 찾음" ([bool]$pin)
  if ($pin) { ClickEl $pin }
  Start-Sleep -Seconds 1
  DumpWindows "after unpin"
  $today = (First "오늘 할 일")
  Check "📌 누르면 항상 위 해제" (-not $today.Topmost)
  Check "고정 해제가 저장됨" ((Cell "select value from settings where id='today_sticky_pinned'") -eq "0")
  $stillOnTop = @(Visible "메모" | Where-Object Topmost)
  Check "오늘 할 일만 해제되고 고정된 메모는 그대로 항상 위" ($stillOnTop.Count -eq (Visible "메모").Count) "topmost notes=$($stillOnTop.Count)/$((Visible '메모').Count)"
  $pin = Uia $today.Hwnd "항상 위에 고정"
  if ($pin) { ClickEl $pin }
  Start-Sleep -Seconds 1
  DumpWindows "after re-pin"
  Check "📌 다시 누르면 항상 위" ((First "오늘 할 일").Topmost)
  Check "다시 고정이 저장됨" ((Cell "select value from settings where id='today_sticky_pinned'") -eq "1")
  # The same the other way round: a note's pin is its own.
  $note = (First "메모")
  $pin = Uia $note.Hwnd "항상 위 해제"
  if ($pin) { ClickEl $pin }
  Start-Sleep -Seconds 1
  DumpWindows "after note unpin"
  Check "메모 📌 해제해도 오늘 할 일은 항상 위 유지" ((First "오늘 할 일").Topmost)
  Check "메모 📌 해제가 저장됨" ((Cell "select count(*) from notes where is_open=1 and is_pinned=0") -eq 1)
  $pin = Uia $note.Hwnd "항상 위에 고정"
  if ($pin) { ClickEl $pin }
  Start-Sleep -Seconds 1
  Check "메모 📌 다시 고정" (@(Visible "메모" | Where-Object Topmost).Count -eq (Visible "메모").Count)
}
$briefing = (First "오늘 브리핑")
if ($briefing) { $btn = Uia $briefing.Hwnd "오늘 시작하기"; if ($btn) { ClickEl $btn } }
Shot "06-today-sticky"

# ---- quick add in the main window -----------------------------------------------
$main = (First "Daily Planner")
Click ($main.L + 60) ($main.B - 60) # empty sidebar bottom, never under a sticky
$input = Uia $main.Hwnd "*할 일 추가*" -Like
Check "메인 창의 빠른 입력란 찾음" ([bool]$input)
# Click a part of the input no sticky covers, so the keys land in it.
function FocusInput { if ($input) { $pt = ClearPoint $input.Current.BoundingRectangle; Click $pt[0] $pt[1]; Start-Sleep -Milliseconds 500 } }
function WaitRows($query) { $r = $null; for ($i = 0; $i -lt 10; $i++) { Start-Sleep -Seconds 1; $r = Sql $query; if ($r.Count) { return ,$r }; }; return ,@() }
FocusInput
$due = (Get-Date).AddMinutes(1)
Keys ("{0:HH}:{0:mm} e2e alarm {{!}}1{{ENTER}}" -f $due)
$task = WaitRows "select title, due_date, due_time, priority, remind_minutes from tasks where title='e2e alarm'"
Check "빠른 입력으로 할 일 저장 (시간·우선순위·알림)" ($task.Count -eq 1 -and $task[0][2] -eq $due.ToString("HH:mm") -and $task[0][3] -eq 3 -and $task[0][4] -eq 0) ($task | ConvertTo-Json -Compress)
# "M월 d일까지 ..." keeps the whole title and takes the date.
$dl = (Get-Date).AddDays(5)
FocusInput
Paste ("{0}월 {1}일까지 e2e 마감 보고서" -f $dl.Month, $dl.Day)
Keys "{ENTER}"
$t2 = WaitRows "select title, due_date from tasks where title like '%e2e 마감%'"
Check "'10월 31일까지 …' 식 입력에서 제목이 온전하고 날짜가 잡힘" ($t2.Count -eq 1 -and $t2[0][0] -eq "e2e 마감 보고서" -and $t2[0][1] -eq $dl.ToString("yyyy-MM-dd")) ($t2 | ConvertTo-Json -Compress)
Shot "07-quick-add"

# ---- today sticky: tap a task to edit it right there -----------------------------
$today = (First "오늘 할 일")
if ($today) {
  $item = Uia $today.Hwnd "*e2e alarm*" -Like
  Check "오늘 할 일 스티커에 새 할 일이 보임" ([bool]$item)
  if ($item) { ClickEl $item } # a text element has no Invoke, so this falls back to a real click
  Start-Sleep -Seconds 1
  Check "스티커에서 항목을 누르면 그 자리에서 편집 화면" ([bool](Uia $today.Hwnd "우선순위"))
  Shot "07a-sticky-edit"
  # The editor's own 닫기 sits below the sticky bar's; press that one.
  $closes = @([System.Windows.Automation.AutomationElement]::FromHandle($today.Hwnd).FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.Name -eq "닫기" })
  $closes | ForEach-Object { Write-Host ("  닫기 at y={0} x={1}" -f $_.Current.BoundingRectangle.Y, $_.Current.BoundingRectangle.X) }
  $editorClose = $closes | Where-Object { $_.Current.BoundingRectangle.Y -gt $today.T + 30 } | Select-Object -First 1
  if ($editorClose) {
    $r = $editorClose.Current.BoundingRectangle
    Click ([int]($r.X + $r.Width / 2)) ([int]($r.Y + $r.Height / 2))
  }
  Start-Sleep -Seconds 1
  Check "편집 닫으면 목록으로 돌아옴" (-not (Uia $today.Hwnd "우선순위")) "close buttons=$($closes.Count)"
}

# ---- list sticky: one list on the desktop, deadlines in a column on the right ----
# Click a control at a spot no sticky covers (UIA Invoke is not offered for text).
function ClickClear($el) { $pt = ClearPoint $el.Current.BoundingRectangle; Click $pt[0] $pt[1]; Start-Sleep -Milliseconds 500 }
# What UI Automation sees in a window, for the log.
function UiaDump($hwnd, $label) {
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $names = @($all | ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -First 25)
    Write-Host ("--- uia {0}: {1} elements; names: {2}" -f $label, $all.Count, ($names -join " | "))
  } catch { Write-Host "--- uia ${label}: $_" }
}
$main = (First "Daily Planner")
$nav = Uia $main.Hwnd "업무" # the sidebar entry comes first in the tree
Check "사이드바에 '업무' 목록" ([bool]$nav)
if ($nav) { ClickClear $nav }
$btn = Uia $main.Hwnd "*바탕화면에 띄우기*" -Like
Check "목록 화면에 '바탕화면에 띄우기' 버튼" ([bool]$btn)
if ($btn) { ClickEl $btn }
Start-Sleep -Seconds 4
$ls = (First "업무")
Check "업무 스티커가 뜸" ([bool]$ls)
if ($ls) {
  Check "업무 스티커는 항상 위, 묶음 창 소유" ($ls.Topmost -and ($ls.Owner -eq $hostWin.Hwnd))
  DumpWindows "list sticky"
  UiaDump $ls.Hwnd "list sticky, fresh"
  Click ($ls.L + 60) ($ls.T + 12) # its title bar: the window is active from here on
  Start-Sleep -Seconds 1
  UiaDump $ls.Hwnd "list sticky, after click"
  # The quick-add input sits along the bottom edge of the sticky.
  Click ([int](($ls.L + $ls.R) / 2)) ($ls.B - 26)
  Start-Sleep -Milliseconds 500
  Paste "내일 e2e 목록 할 일"
  Keys "{ENTER}"
  $t3 = WaitRows "select t.title, t.due_date, l.name from tasks t join lists l on l.id = t.list_id where t.title = 'e2e 목록 할 일'"
  Check "스티커에서 추가한 할 일이 업무 목록에 내일 마감으로 저장" ($t3.Count -eq 1 -and $t3[0][1] -eq (Get-Date).AddDays(1).ToString("yyyy-MM-dd") -and $t3[0][2] -eq "업무") ($t3 | ConvertTo-Json -Compress)
  Start-Sleep -Seconds 1
  UiaDump $ls.Hwnd "list sticky, after add"
  Check "마감일이 스티커 오른쪽 열에 '내일'로 표시" ([bool](Uia $ls.Hwnd "내일"))
  # A second task without a deadline sorts below the dated one; drag it to the top.
  Click ([int](($ls.L + $ls.R) / 2)) ($ls.B - 26)
  Start-Sleep -Milliseconds 500
  Paste "e2e 끌어올릴 일"
  Keys "{ENTER}"
  $null = WaitRows "select id from tasks where title = 'e2e 끌어올릴 일'"
  Start-Sleep -Seconds 1
  $workTodo = "select title, sort_order from tasks where status = 'todo' and deleted_at is null and list_id = (select id from lists where name = '업무')"
  Write-Host "  업무 before drag: $(Sql $workTodo | ConvertTo-Json -Compress)"
  $row = Uia $ls.Hwnd "e2e 끌어올릴 일"
  Check "스티커에 끌어올릴 할 일이 보임" ([bool]$row)
  if ($row) {
    $r = $row.Current.BoundingRectangle
    $x = [int]($r.X + 20); $y = [int]($r.Y + $r.Height / 2)
    Write-Host "  drag from $x,$y to $x,$($ls.T + 36) (sticky top $($ls.T))"
    Drag $x $y $x ($ls.T + 36)
    $order = Sql "$workTodo order by sort_order"
    Write-Host "  업무 after drag: $($order | ConvertTo-Json -Compress)"
    Check "끌어서 맨 위로 올린 순서가 저장됨" ($order.Count -ge 2 -and $order[0][0] -eq "e2e 끌어올릴 일" -and -not ($order | Where-Object { $null -eq $_[1] })) ($order | ConvertTo-Json -Compress)
    $top = Uia $ls.Hwnd "e2e 끌어올릴 일"
    $listed = Uia $ls.Hwnd "e2e 목록 할 일"
    Check "스티커에서도 맨 위에 보임" ($top -and $listed -and $top.Current.BoundingRectangle.Y -lt $listed.Current.BoundingRectangle.Y)
    Check "끌고 난 뒤 편집 화면이 열리지 않음" (-not (Uia $ls.Hwnd "반복"))
  }
  Shot "07c-list-sticky"
  $flagQuery = "select value from settings where id = 'list_sticky:' || (select id from lists where name = '업무')"
  Check "업무 스티커 열림 상태가 저장됨" ("$(Cell $flagQuery)" -like '*"open":true*') "$(Cell $flagQuery)"
  Click ($ls.R - 18) ($ls.T + 16) # ✕ at the right end of the bar
  Start-Sleep -Seconds 2
  Check "✕로 닫으면 창이 사라지고 열림 표시가 꺼짐" ((-not (First "업무")) -and ("$(Cell $flagQuery)" -like '*"open":false*')) "$(Cell $flagQuery)"
}

# ---- calendar: the wheel rolls the month grid, no scrollbar ---------------------
$nav = Uia $main.Hwnd "*캘린더*" -Like
if ($nav) { ClickEl $nav }
Start-Sleep -Seconds 2
Check "캘린더가 이번 달 제목으로 열림" ([bool](Uia $main.Hwnd (Get-Date -Format "yyyy년 M월")))
[W]::SetCursorPos($main.L + 900, $main.T + 450) | Out-Null # grid, clear of the stickies
for ($i = 0; $i -lt 5; $i++) { [W]::mouse_event(0x0800, 0, 0, [uint32]::MaxValue - 119, [UIntPtr]::Zero); Start-Sleep -Milliseconds 250 } # 5 notches down
Start-Sleep -Seconds 1
Check "휠 5칸이면 다음 달로 넘어감" ([bool](Uia $main.Hwnd ((Get-Date).AddMonths(1).ToString("yyyy년 M월"))))
Shot "07b-calendar-wheel"

# ---- 학사일정: bundled on first run, shown with 🎓, can be hidden --------------------
$academic = Cell "select count(*) from events where id like 'hyu-grad:%' and deleted_at is null"
Check "학사일정이 처음 실행에 들어감 (90개 이상)" ([int]$academic -ge 90) "count=$academic synced=$(Cell "select value from settings where id='academic_synced_at'")"
# The bundled items run to Feb 2027; the grid shows next month by now.
$hasItems = (Get-Date) -lt [datetime]"2027-01-15"
$main = First "Daily Planner"
$shown = AcademicPixels $main
$toggle = Uia $main.Hwnd "🎓 학사일정"
Check "캘린더에 🎓 학사일정 버튼" ([bool]$toggle)
if ($toggle) {
  ClickEl $toggle
  Start-Sleep -Seconds 1
  $hidden = AcademicPixels $main
  Check "버튼을 누르면 숨김이 저장됨" ((Cell "select value from settings where id='academic_hidden'") -eq "1")
  if ($hasItems) { Check "숨기면 학사일정 막대가 사라짐" ($shown -gt 100 -and $hidden * 4 -lt $shown) "blue px shown=$shown hidden=$hidden" }
  Shot "07d-academic-hidden"
  ClickEl $toggle
  Start-Sleep -Seconds 1
  $again = AcademicPixels $main
  Check "다시 보이기가 저장됨" ((Cell "select value from settings where id='academic_hidden'") -eq "0")
  if ($hasItems) { Check "다시 누르면 학사일정 막대가 보임" ($again * 2 -gt $shown) "blue px again=$again" }
}
Shot "07e-academic"
$nav = Uia $main.Hwnd "*오늘*" -Like
if ($nav) { ClickEl $nav }
Start-Sleep -Seconds 1

# ---- reminder notification -----------------------------------------------------------
# The reminder fires at the due minute; the main window checks every 30 s.
$wait = [int](($due - (Get-Date)).TotalSeconds) + 45
if ($wait -gt 0) { Start-Sleep -Seconds $wait }
Shot "08-notification"
$fired = "$(Cell "select value from settings where id='fired_reminders'")"
Check "알림이 발송됨 (발송 기록)" ($fired -like "*task:*") $fired

# ---- settings: autostart -----------------------------------------------------------
$main = (First "Daily Planner")
$nav = Uia $main.Hwnd "*설정"
if (-not $nav) { $nav = Uia $main.Hwnd "*설정*" -Like }
if ($nav) { ClickEl $nav }
Start-Sleep -Seconds 1
$toggle = Uia $main.Hwnd "자동 실행"
if ($toggle) { ClickEl $toggle }
Start-Sleep -Seconds 2
# The entry lands in HKLM when the app runs elevated (as on CI) and in HKCU
# on a normal PC; both start it at login.
$entry = foreach ($hive in "HKCU", "HKLM") {
  $run = Get-ItemProperty "${hive}:\Software\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue
  $run.PSObject.Properties | Where-Object { "$($_.Value)" -like "*daily-planner*" } | ForEach-Object { "$hive $($_.Name) = $($_.Value)" }
}
Check "자동 실행 켜면 시작 프로그램에 등록" ([bool]$entry) "$entry"

# ---- settings: the briefing shortcut can be changed and the new key works -------
$change = Uia $main.Hwnd "오늘 브리핑 열기 단축키 바꾸기"
Check "설정에 브리핑 단축키 '바꾸기' 버튼" ([bool]$change)
# The stickies cover this part of the settings page, so bring the main window
# to the front with a click on the empty part of its sidebar (below the lists,
# above the taskbar: the window is taller than the runner's screen) and press
# the button through UIA; the field that appears takes the focus by itself.
Click ($main.L + 60) ($main.T + 520)
Start-Sleep -Milliseconds 500
Check "메인 창이 앞에 옴" ([W]::GetForegroundWindow() -eq $main.Hwnd) "foreground=$([W]::Title([W]::GetForegroundWindow()))"
if ($change) { ClickEl $change }
$field = Uia $main.Hwnd "오늘 브리핑 열기 단축키 입력"
Check "바꾸기를 누르면 키 입력란이 나타남" ([bool]$field)
Keys "^%b" # taken by the recording page, not a global shortcut yet
Start-Sleep -Seconds 1
UiaDump $main.Hwnd "settings after key"
$saved = $null
for ($i = 0; $i -lt 5 -and $saved -ne "CommandOrControl+Alt+B"; $i++) { Start-Sleep -Seconds 1; $saved = Cell "select value from settings where id='shortcut_briefing'" }
if ($saved -ne "CommandOrControl+Alt+B") {
  # SendKeys did not get through; press the keys with scan codes, as a keyboard does.
  Write-Host "SendKeys did not record; trying keybd_event"
  [W]::keybd_event(0x11, 0x1D, 0, [UIntPtr]::Zero); [W]::keybd_event(0x12, 0x38, 0, [UIntPtr]::Zero)
  [W]::keybd_event(0x42, 0x30, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [W]::keybd_event(0x42, 0x30, 2, [UIntPtr]::Zero)
  [W]::keybd_event(0x12, 0x38, 2, [UIntPtr]::Zero); [W]::keybd_event(0x11, 0x1D, 2, [UIntPtr]::Zero)
  Start-Sleep -Seconds 1
  UiaDump $main.Hwnd "settings after keybd_event"
  for ($i = 0; $i -lt 5 -and $saved -ne "CommandOrControl+Alt+B"; $i++) { Start-Sleep -Seconds 1; $saved = Cell "select value from settings where id='shortcut_briefing'" }
}
Check "눌러서 바꾼 단축키가 저장됨" ($saved -eq "CommandOrControl+Alt+B") "$saved"
Check "설정에 새 단축키가 표시됨" ([bool](Uia $main.Hwnd "Ctrl + Alt + B"))
foreach ($b in (Visible "오늘 브리핑")) { [W]::PostMessage($b.Hwnd, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
Start-Sleep -Seconds 1
Keys "^%d"; Start-Sleep -Seconds 2
Check "예전 키(Ctrl+Alt+D)로는 더 이상 안 열림" ((Visible "오늘 브리핑").Count -eq 0)
Keys "^%b"; Start-Sleep -Seconds 3
Check "새 키(Ctrl+Alt+B)로 브리핑 열림" ((Visible "오늘 브리핑").Count -eq 1)
foreach ($b in (Visible "오늘 브리핑")) { [W]::PostMessage($b.Hwnd, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
Start-Sleep -Seconds 1
Shot "08a-shortcut"

# ---- settings: update check (no release to find on CI, so any answer counts) ----
$btn = Uia $main.Hwnd "업데이트 확인"
Check "설정에 '업데이트 확인' 버튼" ([bool]$btn)
if ($btn) { ClickEl $btn }
$status = $null
for ($i = 0; $i -lt 20 -and -not $status; $i++) {
  Start-Sleep -Seconds 1
  foreach ($pat in "최신 버전이에요*", "새 버전*", "업데이트 확인 실패*") { $status = Uia $main.Hwnd $pat -Like; if ($status) { break } }
}
Check "업데이트 확인이 답을 줌" ([bool]$status) $(if ($status) { $status.Current.Name } else { "" })

# ---- settings: 학사일정 새로 받기 (whether the school site answers CI is not ours to
# test, so either answer counts; the detail tells which) ---------------------------
$btn = Uia $main.Hwnd "지금 새로 받기"
Check "설정에 '지금 새로 받기' 버튼" ([bool]$btn)
if ($btn) { ClickEl $btn }
$status = $null
for ($i = 0; $i -lt 30 -and -not $status; $i++) {
  Start-Sleep -Seconds 1
  foreach ($pat in "*개 확인*", "새로 받기 실패*") { $status = Uia $main.Hwnd $pat -Like; if ($status) { break } }
}
$after = Cell "select count(*) from events where id like 'hyu-grad:%' and deleted_at is null"
Check "학사일정 새로 받기가 답을 주고 일정이 남아 있음" ([bool]$status -and [int]$after -ge 80) "$(if ($status) { $status.Current.Name }) count=$after"
Shot "09-settings"

# ---- closing the main window keeps the app in the tray ----------------------------
$main = (First "Daily Planner")
[W]::PostMessage($main.Hwnd, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null # WM_CLOSE
Start-Sleep -Seconds 2
Check "메인 창을 닫으면 숨겨지고 앱은 계속 실행" (((Visible "Daily Planner").Count -eq 0) -and (@(Get-Process | Where-Object { $_.Path -eq $script:Exe }).Count -gt 0))
Check "메인 창을 닫아도 메모는 그대로" ((Visible "메모").Count -eq 2)

Stop-App

# ---- upgrade: a database made by 0.4 (no tasks.sort_order) is brought up to date ----
$before = Cell "select count(*) from tasks where deleted_at is null"
$py = "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('ALTER TABLE tasks DROP COLUMN sort_order'); c.execute('PRAGMA user_version = 1'); c.commit()"
python -c $py $DbPath
$cols = @(Sql "select name from pragma_table_info('tasks')" | ForEach-Object { $_[0] })
Check "옛 버전 DB 흉내: sort_order 열 없음, 버전 1" (-not ($cols -contains "sort_order") -and (Cell "PRAGMA user_version") -eq 1) "columns=$($cols -join ',')"
Start-App | Out-Null
Start-Sleep -Seconds 3
$cols = @(Sql "select name from pragma_table_info('tasks')" | ForEach-Object { $_[0] })
Check "업데이트한 앱이 열을 더하고 DB 버전을 2로 올림" (($cols -contains "sort_order") -and (Cell "PRAGMA user_version") -eq 2) "columns=$($cols -join ',') version=$(Cell 'PRAGMA user_version')"
Check "예전 할 일이 그대로 남음" ((Cell "select count(*) from tasks where deleted_at is null") -eq $before) "before=$before"
Stop-App

$results | Format-Table -AutoSize | Out-String -Width 300 | Write-Host
$md = "| 검사 | 결과 | 내용 |`n| --- | --- | --- |`n" + (($results | ForEach-Object { "| $($_.Check) | $($_.Result) | $($_.Detail -replace '\|', '/') |" }) -join "`n")
Set-Content -Path (Join-Path $OutDir "results.md") -Value $md -Encoding utf8
if ($env:GITHUB_STEP_SUMMARY) { Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value "## Windows E2E`n`n$md" -Encoding utf8 }
if ($results | Where-Object Result -eq "FAIL") { exit 1 }
