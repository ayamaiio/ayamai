$ErrorActionPreference = 'SilentlyContinue'
# Emulator discovery: resolve real executables from Start Menu shortcuts and known
# install locations, then map each to the ROM folders it can open.
$known = @(
  @{ key='retroarch';   name='RetroArch';   systems=@('NES','SNES','Gameboy','Gameboy Color','GBA','N64','Sega MasterSystem','Sega Game Gear','Sega Saturn','TurboGrafx-16','Wonderswan','Wonderswan Color','Neo Geo Pocket Color','Atari 2600') },
  @{ key='pcsx2';       name='PCSX2';       systems=@('PS2') },
  @{ key='ppsspp';      name='PPSSPP';      systems=@('PSP') },
  @{ key='mgba';        name='mGBA';        systems=@('GBA','Gameboy','Gameboy Color') },
  @{ key='project64';   name='Project64';   systems=@('N64') },
  @{ key='eden';        name='Eden';        systems=@('Switch') },
  @{ key='shadps4';     name='shadPS4';     systems=@('PS4') },
  @{ key='dolphin';     name='Dolphin';     systems=@('GameCube & Wii','Wii') },
  @{ key='rpcs3';       name='RPCS3';       systems=@('PS3') },
  @{ key='cemu';        name='Cemu';        systems=@('Wii U') },
  @{ key='duckstation'; name='DuckStation'; systems=@('PS1') },
  @{ key='melonds';     name='melonDS';     systems=@('DS','3DS') },
  @{ key='citra';       name='Citra';       systems=@('3DS') },
  @{ key='azahar';      name='Azahar';      systems=@('3DS') },
  @{ key='mesen';       name='Mesen';       systems=@('NES','Mesen') },
  @{ key='snes9x';      name='Snes9x';      systems=@('SNES') },
  @{ key='xemu';        name='xemu';        systems=@('Xbox') },
  @{ key='xenia';       name='Xenia';       systems=@('Xbox 360') },
  @{ key='flycast';     name='Flycast';     systems=@('Dreamcast','Neo Geo CD') },
  @{ key='redream';     name='Redream';     systems=@('Dreamcast') },
  @{ key='scummvm';     name='ScummVM';     systems=@('MS-DOS') },
  @{ key='ares';        name='ares';        systems=@('SNES','N64') }
)

# Exact name beats prefix; a name merely *containing* the key is almost always a
# false positive ("credential" contains "eden"). Higher score wins.
function Score-Name([string]$base, [string]$key) {
  if ($base -eq $key) { return 3 }
  if ($base -like "$key*") { return 2 }
  if ($base -like "*$key*" -and $base -notmatch 'credential|uninstall|website|update|crash|setup|helper') { return 1 }
  return 0
}

$shell = New-Object -ComObject WScript.Shell
$best = @{}

function Consider([string]$path, [string]$via) {
  if (-not $path -or -not (Test-Path $path)) { return }
  $base = [IO.Path]::GetFileNameWithoutExtension($path).ToLower()
  foreach ($k in $known) {
    $score = Score-Name $base $k.key
    if ($score -eq 0) { continue }
    if ($score -eq 1) { continue }        # contains-only is too loose for a launcher
    if (-not $best.ContainsKey($k.key) -or $best[$k.key].score -lt $score) {
      $best[$k.key] = @{ path=$path; score=$score; via=$via }
    }
  }
}

$menus = @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs", 'C:\ProgramData\Microsoft\Windows\Start Menu\Programs')
foreach ($menu in $menus) {
  Get-ChildItem $menu -Filter *.lnk -Recurse | ForEach-Object {
    Consider ($shell.CreateShortcut($_.FullName).TargetPath) 'shortcut'
  }
}

foreach ($root in @('C:\Program Files','C:\Program Files (x86)',"$env:LOCALAPPDATA\Programs",'Z:\Emulators','Z:\Games','Z:\Programming','C:\RetroArch-Win64')) {
  Get-ChildItem $root -Filter *.exe -Recurse -Depth 3 | ForEach-Object { Consider $_.FullName 'scan' }
}

$result = foreach ($k in $known) {
  if ($best.ContainsKey($k.key)) {
    [pscustomobject]@{ key=$k.key; name=$k.name; exe=$best[$k.key].path; via=$best[$k.key].via; systems=$k.systems }
  }
}

New-Item -ItemType Directory -Force -Path 'Y:\ayamai\state' | Out-Null
$result | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 'Y:\ayamai\state\emulators.json'
Write-Output "wrote $($result.Count) emulators"
$result | Select-Object name, via, exe | Format-Table -AutoSize
