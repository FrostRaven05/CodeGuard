# Read-only WM_NCHITTEST probes against the disposable Electron test window.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CodeGuardTitlebarProbe {
    [DllImport("user32.dll")]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam,
        IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
}
'@
[CodeGuardTitlebarProbe]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
$codeguardHandle = [IntPtr]::new([long]$env:CODEGUARD_PROBE_HANDLE)
$codeguardPoints = Get-Content -LiteralPath $env:CODEGUARD_PROBE_POINTS -Raw | ConvertFrom-Json
$codeguardResults = foreach ($codeguardPoint in $codeguardPoints) {
    $codeguardPacked = (([long]$codeguardPoint.y -band 65535) -shl 16) -bor ([long]$codeguardPoint.x -band 65535)
    $codeguardHit = [UIntPtr]::Zero
    $codeguardSent = [CodeGuardTitlebarProbe]::SendMessageTimeout($codeguardHandle, 132, [IntPtr]::Zero,
        [IntPtr]::new($codeguardPacked), 2, 2000, [ref]$codeguardHit)
    if ($codeguardSent -eq [IntPtr]::Zero) { throw 'Disposable window hit test timed out.' }
    [PSCustomObject]@{ name = $codeguardPoint.name; hit = $codeguardHit.ToUInt64() }
}
ConvertTo-Json -InputObject @($codeguardResults) -Compress
