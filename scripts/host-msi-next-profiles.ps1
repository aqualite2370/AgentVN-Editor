param([ValidateSet('clean-zh','cross-en','cross-zh')][string]$Label='clean-zh')
$ErrorActionPreference='Stop'
$root='D:\AgentVN\output\host-msi-next-20261018-01'
$work='F:\AgentVN-QA-HostMSINext-20261018-01'
$prep=Get-Content -LiteralPath (Join-Path $root 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
$destination=Join-Path $root ($Label+'-blank-profiles.json')
if(Test-Path -LiteralPath $destination){throw 'Do not overwrite profile phase'}
if($prep.status -ne 'PASS' -or $prep.verifiedOriginalFiles -ne 55){throw 'Original protection required'}
$active=@(Get-CimInstance Win32_Process|Where-Object {
    $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
    ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')
})
if($active.Count){throw 'Idle required'}
$result=@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');label=$Label;profiles=@();error=$null}
try{
    foreach($row in $prep.profiles){
        $expected='C:\Users\1\AppData\'+$row.kind+'\com.agentvn.'+$row.app
        $target=Join-Path $work ('previous-profiles-'+$Label+'\'+$row.kind+'\com.agentvn.'+$row.app)
        if($row.original -ne $expected -or
            [IO.Path]::GetFullPath($target) -ne ($work+'\previous-profiles-'+$Label+'\'+$row.kind+'\com.agentvn.'+$row.app)){
            throw 'Exact profile boundary mismatch'}
        if(!(Test-Path -LiteralPath $row.held) -or (Test-Path -LiteralPath $target)){throw 'Held profile missing/target collision'}
        $checks=@()
        if(Test-Path -LiteralPath $row.original){
            $items=@((Get-Item -LiteralPath $row.original))+@(Get-ChildItem -LiteralPath $row.original -Recurse -Force)
            if(@($items|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Linked QA profile'}
            foreach($file in $items|Where-Object {!$_.PSIsContainer}){
                $checks+=@{relative=$file.FullName.Substring($row.original.Length+1);
                    sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
            }
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
            Move-Item -LiteralPath $row.original -Destination $target
            foreach($file in $checks){
                if((Get-FileHash -LiteralPath (Join-Path $target $file.relative) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256){
                    throw 'Retained profile byte mismatch'}
            }
        }
        $result.profiles+=@{original=$row.original;retained=$target;checks=$checks;defaultPathAbsent=(!(Test-Path -LiteralPath $row.original))}
    }
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{[IO.File]::WriteAllText($destination,($result|ConvertTo-Json -Depth 10),(New-Object Text.UTF8Encoding($false)))}
Write-Output "PASS: blank defaults for $Label, prior QA profiles retained on F; original four profiles still held"
