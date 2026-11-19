# Nomad Terminal - pieni paikallinen palvelin ilman asennuksia (Windows PowerShell).
# Tarjoilee laskurin (verkkoon\index.html), valittaa /yf/* -haut Yahoo Financeen ja
# tekee tekoalyanalyysin talla koneella olevalla Claudella (/ai/*), ilman API-avaimia.
# Claude saa kayttaa vain verkkohakua; sivu lahettaa vain tunnuksen ja yhtion nimen,
# itse kehote on tiedostossa analyysi-prompt.txt.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$htmlPath = Join-Path $root 'verkkoon\index.html'
$promptPath = Join-Path $here 'analyysi-prompt.txt'
$utf8 = New-Object Text.UTF8Encoding $false

# --- Claude Code tall koneella ---
$claude = $null
foreach ($c in @(
    (Get-Command claude.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source),
    (Get-Command claude.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source),
    (Join-Path $env:USERPROFILE '.local\bin\claude.exe'),
    # Claude-tyopoytasovelluksen mukana tuleva Claude Code (uusin versio)
    (Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Claude-Data\*\claude-code\*\*\claude.exe') -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName))) {
  if ($c -and (Test-Path $c)) { $claude = $c; break }
}
$jobs = @{}

$listener = $null
foreach ($p in 5180..5190) {
  try {
    $l = New-Object Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l; $port = $p; break
  } catch { }
}
if (-not $listener) { Write-Host 'Vapaata porttia ei loytynyt (5180-5190).'; exit 1 }

$url = "http://localhost:$port/"
Write-Host ''
Write-Host "  Nomad Terminal on kaynnissa: $url"
if ($claude) { Write-Host "  Tekoalyanalyysi: Claude ($claude)" } else { Write-Host '  Tekoalyanalyysi: Claudea ei loytynyt, analyysit ohitetaan.' }
Write-Host '  Pida tama ikkuna auki. Sulje ikkuna, kun haluat lopettaa.'
Write-Host ''
Start-Process $url

function Send-Json($res, [int]$status, $obj) {
  $b = $utf8.GetBytes(($obj | ConvertTo-Json -Compress -Depth 4))
  $res.StatusCode = $status
  $res.ContentType = 'application/json; charset=utf-8'
  $res.Headers.Add('Cache-Control', 'no-store')
  $res.ContentLength64 = $b.Length
  $res.OutputStream.Write($b, 0, $b.Length)
}

function Stop-Jobs {
  foreach ($k in @($jobs.Keys)) {
    $j = $jobs[$k]
    if (-not $j.Proc.HasExited) { try { & taskkill.exe /PID $j.Proc.Id /T /F | Out-Null } catch { } }
    $jobs.Remove($k)
  }
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    $path = $req.Url.PathAndQuery
    if ($path.StartsWith('/ai/')) {
      # Vain tama sivu: oma otsake (muut sivustot eivat voi lahettaa sita) ja oikea Origin.
      $origin = $req.Headers['Origin']
      if ($req.Headers['X-Nomad'] -ne '1' -or ($origin -and $origin -ne "http://localhost:$port")) {
        Send-Json $res 403 @{ error = 'forbidden' }
      } elseif ($req.Url.AbsolutePath -eq '/ai/ping') {
        Send-Json $res 200 @{ ok = [bool]$claude }
      } elseif ($req.Url.AbsolutePath -eq '/ai/start' -and $req.HttpMethod -eq 'POST') {
        $ticker = [string]$req.QueryString['ticker']
        $name = [regex]::Replace([string]$req.QueryString['name'], "[^\p{L}\p{N} .,&'()\-]", '')
        if ($name.Length -gt 100) { $name = $name.Substring(0, 100) }
        if (-not $claude) {
          Send-Json $res 503 @{ error = 'Claude Code is not installed on this computer.' }
        } elseif ($ticker -notmatch '^[A-Za-z0-9.\-^=]{1,20}$') {
          Send-Json $res 400 @{ error = 'bad ticker' }
        } else {
          Stop-Jobs  # uusi haku korvaa edellisen analyysin
          $id = [guid]::NewGuid().ToString('N')
          $dir = Join-Path $env:TEMP "nomad-ai\$id"
          New-Item -ItemType Directory -Path $dir -Force | Out-Null
          $today = (Get-Date).ToString('dddd, MMMM d, yyyy', [Globalization.CultureInfo]::InvariantCulture)
          if (-not $name) { $name = $ticker }
          $prompt = [IO.File]::ReadAllText($promptPath, $utf8)
          $prompt = $prompt.Replace('{{TODAY}}', "Today is $today.").Replace('{{NAME}}', $name)
          $prompt = $prompt.Replace('{{TICKER}}', $ticker.ToUpper()).Replace('{{LASTYEAR}}', [string]((Get-Date).Year - 1))
          [IO.File]::WriteAllText((Join-Path $dir 'prompt.txt'), $prompt, $utf8)
          # Vain verkkohaku sallittu; tyohakemistona tyhja valiaikaiskansio.
          $cmd = "/d /s /c `"`"$claude`" -p --output-format text --allowedTools `"WebSearch WebFetch`" " +
                 "--disallowedTools `"Bash Edit Write Read Glob Grep NotebookEdit Task`" " +
                 "< prompt.txt > out.txt 2> err.txt`""
          $proc = Start-Process -FilePath cmd.exe -ArgumentList $cmd -WorkingDirectory $dir -WindowStyle Hidden -PassThru
          $jobs[$id] = @{ Proc = $proc; Dir = $dir }
          Send-Json $res 200 @{ id = $id }
        }
      } elseif ($req.Url.AbsolutePath -eq '/ai/result') {
        $id = [string]$req.QueryString['id']
        $j = $jobs[$id]
        if (-not $j) {
          Send-Json $res 404 @{ error = 'unknown job' }
        } elseif (-not $j.Proc.HasExited) {
          Send-Json $res 202 @{ status = 'running' }
        } else {
          $out = Join-Path $j.Dir 'out.txt'
          $text = if (Test-Path $out) { [IO.File]::ReadAllText($out, $utf8) } else { '' }
          if ($j.Proc.ExitCode -eq 0 -and $text.Trim()) {
            Send-Json $res 200 @{ text = $text }
          } else {
            $err = Join-Path $j.Dir 'err.txt'
            $msg = if (Test-Path $err) { [IO.File]::ReadAllText($err, $utf8).Trim() } else { '' }
            if (-not $msg) { $msg = $text.Trim() }
            if ($msg.Length -gt 400) { $msg = $msg.Substring(0, 400) }
            Send-Json $res 500 @{ error = "Claude: $msg" }
          }
          $jobs.Remove($id)
          try { Remove-Item -Recurse -Force $j.Dir } catch { }
        }
      } else {
        Send-Json $res 404 @{ error = 'not found' }
      }
    } elseif ($path.StartsWith('/yf/')) {
      $target = 'https://query2.finance.yahoo.com' + $path.Substring(3)
      $r = Invoke-WebRequest -Uri $target -UseBasicParsing -TimeoutSec 20 `
        -UserAgent 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' -Headers @{ Accept = 'application/json' }
      $bytes = $r.RawContentStream.ToArray()
      $res.ContentType = 'application/json; charset=utf-8'
      $res.Headers.Add('Cache-Control', 'no-store')
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $bytes = [IO.File]::ReadAllBytes($htmlPath)
      $res.ContentType = 'text/html; charset=utf-8'
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch [System.Net.WebException] {
    # Yahoon oma virhe (esim. 404 tuntemattomalle tunnukselle) valitetaan sellaisenaan.
    try {
      $er = $_.Exception.Response
      if ($er) {
        $res.StatusCode = [int]$er.StatusCode
        # PS 5.1 lukee virhevastauksen jo valmiiksi ErrorDetailsiin; virta on silloin tyhja.
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
          $b = [Text.Encoding]::UTF8.GetBytes($_.ErrorDetails.Message)
        } else {
          $ms = New-Object IO.MemoryStream
          $er.GetResponseStream().CopyTo($ms)
          $b = $ms.ToArray()
        }
        $res.ContentType = 'application/json; charset=utf-8'
        $res.OutputStream.Write($b, 0, $b.Length)
      } else {
        $res.StatusCode = 502
      }
    } catch { }
  } catch {
    try {
      $res.StatusCode = 502
      $res.ContentType = 'application/json; charset=utf-8'
      $msg = [Text.Encoding]::UTF8.GetBytes('{"error":"upstream"}')
      $res.OutputStream.Write($msg, 0, $msg.Length)
    } catch { }
  } finally {
    try { $res.Close() } catch { }
  }
}
