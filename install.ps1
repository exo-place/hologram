# Hologram quickstart installer (Windows PowerShell)
# Usage: irm https://exo.place/hologram/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$Repo = "https://github.com/exo-place/hologram"
$Dest = if ($env:HOLOGRAM_DIR) { $env:HOLOGRAM_DIR } else { "hologram" }

# ── Helpers ────────────────────────────────────────────────────────────────────
function Ok($msg)   { Write-Host "✓ $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }
function Ask($label, $hint = "") {
  if ($hint) { Write-Host "? $label " -NoNewline; Write-Host $hint -ForegroundColor DarkGray -NoNewline }
  else        { Write-Host "? $label" -NoNewline }
  Write-Host " " -NoNewline
}

$Interactive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected

# ── Dependencies ───────────────────────────────────────────────────────────────
$HasGit = [bool](Get-Command git -ErrorAction SilentlyContinue)

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Host "Installing Bun..."
  powershell -c "irm bun.sh/install.ps1 | iex"
  # Reload PATH
  $env:PATH = [Environment]::GetEnvironmentVariable("PATH", "User") + ";" + $env:PATH
}
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Fail "Bun installation failed — try installing manually: https://bun.sh"
}
Ok "Bun $(bun --version)"

# ── Clone / update ─────────────────────────────────────────────────────────────
if ($HasGit -and (Test-Path "$Dest\.git")) {
  Write-Host "Updating existing install in .\$Dest"
  git -C $Dest pull --ff-only
} elseif ($HasGit) {
  Write-Host "Cloning hologram into .\$Dest"
  git clone $Repo $Dest
} else {
  Write-Host "git not found — downloading archive..."
  $ZipUrl = "$Repo/archive/refs/heads/master.zip"
  $TmpZip = Join-Path $env:TEMP "hologram.zip"
  $TmpDir = Join-Path $env:TEMP "hologram-extract"
  Invoke-WebRequest $ZipUrl -OutFile $TmpZip
  Expand-Archive $TmpZip -DestinationPath $TmpDir -Force
  Move-Item (Join-Path $TmpDir "hologram-master") $Dest
  Remove-Item $TmpZip, $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
Set-Location $Dest

# ── Install + build ────────────────────────────────────────────────────────────
bun install --frozen-lockfile
bun run build
Ok "Built"

# ── Configure ──────────────────────────────────────────────────────────────────
if (Test-Path ".env") {
  Write-Host ".env already exists — skipping configuration"
} else {
  $DiscordToken = ""
  $DiscordAppId = ""
  $GoogleKey    = ""

  if ($Interactive) {
    Write-Host ""
    Write-Host "Configure hologram" -ForegroundColor White -NoNewline
    Write-Host " (press Enter to skip any field)" -ForegroundColor DarkGray
    Write-Host ""

    Ask "Google AI API key" "(free at aistudio.google.com/api-keys):"
    $GoogleKey = Read-Host

    Ask "Discord bot token" "(optional — skip for web-only mode):"
    $DiscordToken = Read-Host

    if ($DiscordToken) {
      Ask "Discord application ID" "(discord.com/developers/applications):"
      $DiscordAppId = Read-Host
    }
  } else {
    Write-Host "Non-interactive mode — creating .env with empty values." -ForegroundColor DarkGray
    Write-Host "Edit .env before running hologram." -ForegroundColor DarkGray
  }

  @"
# Hologram configuration
# Full reference: .env.example

DISCORD_TOKEN=$DiscordToken
DISCORD_APP_ID=$DiscordAppId

DEFAULT_MODEL=google:gemini-3-flash-preview
GOOGLE_GENERATIVE_AI_API_KEY=$GoogleKey
"@ | Set-Content .env -Encoding UTF8

  Ok ".env created"
}

# ── Optional: desktop / startup integration ───────────────────────────────────
if ($Interactive) {
  Write-Host ""
  Ask "Add to Start Menu and start on login?" "(y/N):"
  $AddStartup = Read-Host
  if ($AddStartup -match '^[Yy]') {
    $AbsDest  = (Resolve-Path ".").Path
    $BunBin   = (Get-Command bun).Source
    $WshShell = New-Object -ComObject WScript.Shell

    # Start Menu shortcut
    $StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Hologram.lnk"
    $Shortcut  = $WshShell.CreateShortcut($StartMenu)
    $Shortcut.TargetPath       = $BunBin
    $Shortcut.Arguments        = "start"
    $Shortcut.WorkingDirectory = $AbsDest
    $Shortcut.Description      = "Hologram — Discord RP bot and web chat"
    $Shortcut.Save()

    # Startup folder (run at login)
    $StartupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\Hologram.lnk"
    Copy-Item $StartMenu $StartupDir -Force

    Ok "Start Menu shortcut + startup entry added"
  }
}

# ── Done ───────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "hologram is ready!" -ForegroundColor Green
Write-Host ""
Write-Host "  cd $Dest"
Write-Host "  Start:  " -NoNewline; Write-Host "bun start" -ForegroundColor White -NoNewline; Write-Host "         (production)" -ForegroundColor DarkGray
Write-Host "  Dev:    " -NoNewline; Write-Host "bun run dev" -ForegroundColor White -NoNewline; Write-Host "       (watch + hot reload)" -ForegroundColor DarkGray
Write-Host "  Web UI: " -NoNewline; Write-Host "http://localhost:3000" -ForegroundColor Cyan
Write-Host ""

$envContent = Get-Content .env -Raw
if ($envContent -notmatch 'GOOGLE_GENERATIVE_AI_API_KEY=.+' -and
    $envContent -notmatch 'ANTHROPIC_API_KEY=.+' -and
    $envContent -notmatch 'OPENAI_API_KEY=.+') {
  Write-Host "  Add at least one LLM API key to .env before starting." -ForegroundColor DarkGray
  Write-Host "  See .env.example for all supported providers." -ForegroundColor DarkGray
  Write-Host ""
}
