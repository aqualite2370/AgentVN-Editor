# One-session recovery. Preserve FAILED receipts; never repeat install operations.
$ErrorActionPreference='Stop'
$run='F:\AgentVN\QA\Editor-Upgrade-1924-20261025-02'
$state=Get-Content -LiteralPath (Join-Path $run 'protection.json') -Raw -Encoding UTF8|ConvertFrom-Json
$output=Join-Path $run 'recovery-02.json'
if(Test-Path -LiteralPath $output){throw 'Fresh recovery receipt required'}
if(@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match
    '^(agentvn-editor|AgentVN Dev|agentvn-player|creator-backend)\.exe$'}).Count){throw 'Product still active'}
function Sha($file){
    $s=[IO.File]::OpenRead($file);$h=[Security.Cryptography.SHA256]::Create()
    try{([BitConverter]::ToString($h.ComputeHash($s))).Replace('-','').ToLowerInvariant()}
    finally{$s.Dispose();$h.Dispose()}
}
function Id($directory){
    if(!(Test-Path -LiteralPath $directory)){return $null}
    $text=(& fsutil.exe file queryfileid $directory|Out-String)
    if($LASTEXITCODE -ne 0 -or $text -notmatch '0x[0-9a-fA-F]+'){throw 'Missing directory identity'}
    $Matches[0].ToLowerInvariant()
}
$result=@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');profiles=@();restoredMissingBytes=@();
  deletedUserFiles=0;downloads=@();error=$null;originalFailurePreserved=$true}
try{
    $roots=@('C:\Users\1\AppData\Roaming\com.agentvn.editor','C:\Users\1\AppData\Local\com.agentvn.editor',
        'C:\Users\1\AppData\Local\AgentVN\environment-cache')
    if($state.records.Count -ne 3){throw 'Expected exact three profiles'}
    # Restore every directory before verifying inventories, so a verification
    # error cannot strand the remaining user directories in held paths.
    foreach($record in $state.records){
        $index=[Array]::IndexOf($roots,[string]$record.original)
        if($index -lt 0 -or $record.held -cne ($record.original+'.qa-hold-editor-upgrade-1924-20261025-02') -or
            $record.retained -cne ($record.original+'.qa-tested-editor-upgrade-1924-20261025-02')){throw 'Unknown recovery target'}
        $created=Get-Content -LiteralPath (Join-Path $run ('created-'+$index+'.json')) -Raw|ConvertFrom-Json
        if(Test-Path -LiteralPath $record.held){
            if((Id $record.held) -cne $record.directoryId -or (Id $record.original) -cne $created.directoryId -or
                (Test-Path -LiteralPath $record.retained)){throw 'Held/QA identity differs'}
            [IO.Directory]::Move($record.original,$record.retained)
            [IO.Directory]::Move($record.held,$record.original)
        }
        if((Id $record.original) -cne $record.directoryId){throw 'Original directory not restored'}
        $result.profiles+=@{original=$record.original;directoryId=$record.directoryId;retained=$record.retained}
    }
    foreach($record in $state.records|Where-Object byteInventory){
        foreach($file in @($record.files)){
            $target=Join-Path $record.original $file.relative
            if(!(Test-Path -LiteralPath $target)){
                $source=Join-Path $record.retained $file.relative
                if((Sha $source) -cne $file.sha256){throw 'Missing original byte has no exact retained source'}
                $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
                Copy-Item -LiteralPath $source -Destination $target
                $result.restoredMissingBytes+=@{path=$target;source=$source;sha256=$file.sha256}
            }
            if((Sha $target) -cne $file.sha256){throw 'Restored original content differs'}
        }
    }
    foreach($row in $state.registry){
        if($row.path -cnotin @('Software\agentvn\AgentVN Editor','Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor')){
            throw 'Unknown registration'
        }
        $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($row.path)
        try{
            if($key.GetSubKeyNames().Count){throw 'Unexpected nested registration'}
            foreach($name in $key.GetValueNames()){if($name -cnotin @($row.values.name)){throw 'Unknown registry value'}}
            foreach($v in $row.values){$key.SetValue($v.name,$v.value,[Microsoft.Win32.RegistryValueKind]$v.kind)}
            foreach($v in $row.values){
                if($key.GetValue($v.name) -cne $v.value){throw 'Registry restore differs'}
            }
        }finally{$key.Dispose()}
    }
    foreach($link in $state.links){
        if((Sha $link.backup) -cne $link.sha256){throw 'Shortcut backup differs'}
        Copy-Item -LiteralPath $link.backup -Destination $link.path -Force
        if((Sha $link.path) -cne $link.sha256){throw 'Shortcut restore differs'}
    }
    foreach($file in $state.protectedFiles){if((Sha $file.path) -cne $file.sha256){throw 'Protected artifact differs'}}
    $raw=Get-Content -LiteralPath (Join-Path $run 'report.json') -Raw -Encoding UTF8|ConvertFrom-Json
    foreach($download in $raw.downloads){
        if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($download.source)) -cne 'C:\Users\1\Downloads'){
            throw 'Only exact recorded Downloads file permitted'
        }
        if((Sha $download.retained) -cne $download.sha256 -or (Sha $download.source) -cne $download.sha256){throw 'Download bytes differ'}
        Remove-Item -LiteralPath $download.source
        $result.downloads+=@{source=$download.source;retained=$download.retained;sha256=$download.sha256;removed=$true}
    }
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{
    $result.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
    [IO.File]::WriteAllText($output,($result|ConvertTo-Json -Depth 16),[Text.UTF8Encoding]::new($false))
}
$result|Select-Object status,@{n='restoredDirectories';e={$_.profiles.Count}},@{n='missingBytesRestored';e={$_.restoredMissingBytes.Count}}|ConvertTo-Json
