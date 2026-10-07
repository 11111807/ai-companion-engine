# ============================================================
#  把 shot.mjs 生成的场景 HTML 渲染成 PNG，方便肉眼看排版。
#
#  为什么需要它：jsdom 测不出排版 —— 溢出、重叠、断行、字号、
#  按钮点不到，它一概看不见。所以断言全绿之后，还要真的看一眼。
#
#  用法：
#     node shot.mjs                      # 先生成 .preview/*.html
#     powershell -ExecutionPolicy Bypass -File shot.ps1
#
#  换浏览器就改下面这个路径（或者设 SHOT_BROWSER 环境变量）。
# ============================================================

$ErrorActionPreference = 'Stop'

$BROWSER = $env:SHOT_BROWSER
if (-not $BROWSER) {
  $candidates = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
  )
  $BROWSER = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $BROWSER -or -not (Test-Path $BROWSER)) {
  Write-Host '找不到浏览器。装 Edge/Chrome，或者设 SHOT_BROWSER 指向它的 exe。' -ForegroundColor Red
  exit 1
}

$DIR = Join-Path $PSScriptRoot '.preview'
if (-not (Test-Path $DIR)) {
  Write-Host '还没有 .preview 目录 —— 先跑 node shot.mjs' -ForegroundColor Yellow
  exit 1
}

# 尺寸从 sizes.txt 读（shot.mjs 写的），不用在这儿维护第二份
$sizes = @{}
if (Test-Path (Join-Path $DIR 'sizes.txt')) {
  foreach ($item in (Get-Content (Join-Path $DIR 'sizes.txt') -Raw).Trim() -split ';') {
    $parts = $item.Trim() -split '\s+'
    if ($parts.Count -ge 2) { $sizes[$parts[0]] = $parts[1] }
  }
}

$done = 0
foreach ($html in Get-ChildItem $DIR -Filter '*.html') {
  $name = $html.BaseName
  $size = if ($sizes.ContainsKey($name)) { $sizes[$name] } else { '390,900' }
  $png = Join-Path $DIR "$name.png"
  $url = 'file:///' + ($html.FullName -replace '\\', '/')
  & $BROWSER --headless=new --disable-gpu --hide-scrollbars `
    "--screenshot=$png" "--window-size=$size" $url 2>&1 | Out-Null
  if (Test-Path $png) { $done++; Write-Host "  $name.png  ($size)" }
  else { Write-Host "  $name 生成失败" -ForegroundColor Red }
}

Write-Host ''
Write-Host "生成了 $done 张 → $DIR" -ForegroundColor Green
