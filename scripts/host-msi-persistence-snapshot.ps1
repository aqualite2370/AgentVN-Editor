param([ValidateSet('Snapshot','Verify')][string]$Action='Snapshot',
    [ValidateSet('en-US','zh-CN')][string]$Language='en-US',
    [ValidateSet('before-upgrade','after-repair','before-repair','before-uninstall','after-uninstall')][string]$Phase='before-upgrade',
    [string]$ReportRoot='D:\AgentVN\output\host-msi-continuation-20261018-02',
    [string]$WorkRoot='F:\AgentVN-QA-HostMSI-20261018-02',
    [string]$InstallLocalRoot='')
$ErrorActionPreference='Stop'
$root=$ReportRoot
$work=$WorkRoot
$utf8=New-Object Text.UTF8Encoding($false)
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
$active=@(Get-CimInstance Win32_Process|Where-Object {
    $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
    ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')
})
if($active.Count){throw 'Idle required for disk byte preservation checks'}
$destination=Join-Path $root ($Language+'\'+$Phase+'-'+$Action.ToLowerInvariant()+'.json')
if(Test-Path -LiteralPath $destination){throw 'Fresh preservation evidence required'}
$baselinePhase=switch($Phase){'after-uninstall'{'before-uninstall'} 'after-repair'{
    if(Test-Path -LiteralPath (Join-Path $root ($Language+'\before-repair-snapshot.json'))){'before-repair'}else{'before-upgrade'}
} default{'before-upgrade'}}
$baselineFile=Join-Path $root ($Language+'\'+$baselinePhase+'-snapshot.json')
$result=@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');action=$Action;phase=$Phase;files=@();error=$null}
try{
    if($Action -eq 'Snapshot'){
        if($Phase -notin @('before-upgrade','before-repair','before-uninstall')){throw 'Only pre-operation snapshot supported'}
        $sources=@()
        $roaming='C:\Users\1\AppData\Roaming\com.agentvn.editor'
        $local='C:\Users\1\AppData\Local\com.agentvn.editor'
        if(Test-Path -LiteralPath $roaming){
            $sources+=@(Get-ChildItem -LiteralPath $roaming -Recurse -File -Force|ForEach-Object {
                @{file=$_.FullName;relative=('Roaming\'+$_.FullName.Substring($roaming.Length+1))}
            })
        }
        if($InstallLocalRoot){
            if([IO.Path]::GetFullPath($InstallLocalRoot) -notin @('D:\agentvntest\AgentVN Editor\data',
                'F:\AgentVN-QA-NSISCross-20261018-01\installed-editor\data')){
                throw 'Exact authorized legacy data root required'
            }
            $legacyEntries=@((Get-Item -LiteralPath $InstallLocalRoot))+
                @(Get-ChildItem -LiteralPath $InstallLocalRoot -Recurse -Force)
            if(@($legacyEntries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){
                throw 'Linked legacy data'
            }
            $sources+=@($legacyEntries|Where-Object {!$_.PSIsContainer}|ForEach-Object {
                @{file=$_.FullName;relative=('InstallLocal\'+$_.FullName.Substring($InstallLocalRoot.Length+1))}
            })
        }
        foreach($relative in @('EBWebView\Default\Local Storage','EBWebView\Default\IndexedDB','EBWebView\Default\Session Storage')){
            $folder=Join-Path $local $relative
            if(Test-Path -LiteralPath $folder){
                $sources+=@(Get-ChildItem -LiteralPath $folder -Recurse -File -Force|ForEach-Object {
                    @{file=$_.FullName;relative=('Local\'+$_.FullName.Substring($local.Length+1))}
                })
            }
        }
        foreach($relative in @('EBWebView\Local State','EBWebView\Default\Preferences','EBWebView\Default\Secure Preferences')){
            $file=Join-Path $local $relative
            if(Test-Path -LiteralPath $file){$sources+=@{file=$file;relative=('Local\'+$relative)}}
        }
        foreach($source in $sources){
            if((Get-Item -LiteralPath $source.file).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked QA snapshot file'}
            $target=Join-Path $work ($Language+'\'+$Phase+'-data\'+$source.relative)
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
            if(Test-Path -LiteralPath $target){throw 'Snapshot collision'}
            Copy-Item -LiteralPath $source.file -Destination $target
            $hash=Sha $source.file
            if((Sha $target) -ne $hash){throw 'Snapshot changed'}
            $result.files+=@{source=$source.file;backup=$target;sha256=$hash}
        }
        if(!$result.files.Count){throw 'Empty data snapshot'}
    }else{
        $baseline=Get-Content -LiteralPath $baselineFile -Raw -Encoding UTF8|ConvertFrom-Json
        if($baseline.status -ne 'PASS' -or !$baseline.files.Count){throw 'No valid preservation baseline'}
        foreach($file in $baseline.files){
            $actual=Sha $file.source
            $result.files+=@{source=$file.source;sha256=$actual;expected=$file.sha256;match=($actual -eq $file.sha256)}
            if($actual -ne $file.sha256){throw "Persisted bytes changed: $($file.source)"}
        }
    }
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{[IO.File]::WriteAllText($destination,($result|ConvertTo-Json -Depth 12),$utf8)}
Write-Output "PASS: $Action $Phase, $($result.files.Count) real persistent file SHA checks"
