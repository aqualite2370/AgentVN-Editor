param([ValidateSet('menus','ordinary')][string]$Scope='menus')
$ErrorActionPreference='Stop'
$taskRun='D:\AgentVN\output\installed-layout-author-review-20261019-01'
$taskReceipt=Join-Path $taskRun $(if($Scope -eq 'ordinary'){'ordinary-download-retention.json'}else{'download-retention.json'})
if(Test-Path -LiteralPath $taskReceipt){throw 'Never overwrite retention evidence'}
$taskSaveFile=if($Scope -eq 'ordinary'){'ordinary-save-01\report.json'}else{'save-01\report.json'}
$taskSaved=Get-Content -LiteralPath (Join-Path $taskRun $taskSaveFile) -Raw -Encoding UTF8|ConvertFrom-Json
if($taskSaved.status -ne 'PASS'){throw 'Actual save evidence must pass'}
$taskPackage=$taskSaved.savedPackage
$taskSource=[IO.Path]::GetFullPath($taskPackage.original)
$taskRetained=[IO.Path]::GetFullPath($taskPackage.retained)
$taskRetainedDirectory=if($Scope -eq 'ordinary'){'F:\AgentVN\QA\Layout-Author-20261019-01\ordinary-story'}else{'F:\AgentVN\QA\Layout-Author-20261019-01'}
if([IO.Path]::GetDirectoryName($taskSource) -ne 'C:\Users\1\Downloads' -or
   [IO.Path]::GetDirectoryName($taskRetained) -ne $taskRetainedDirectory -or
   [IO.Path]::GetFileName($taskSource) -ne [IO.Path]::GetFileName($taskRetained) -or
   [IO.Path]::GetExtension($taskSource) -ne '.vnproj'){throw 'Exact generated-package boundary mismatch'}
foreach($taskPath in @($taskSource,$taskRetained)){
    $taskItem=Get-Item -LiteralPath $taskPath
    if($taskItem.PSIsContainer -or ($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Linked/non-file package refused'}
    if((Get-FileHash -LiteralPath $taskPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskPackage.sha256){throw 'Generated-package SHA changed'}
}
$taskResult=@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');source=$taskSource;
    retained=$taskRetained;sha256=$taskPackage.sha256;bytes=(Get-Item -LiteralPath $taskSource).Length;
    copyVerified=$true;sourceRemoved=$false;error=$null}
$taskUtf8=New-Object Text.UTF8Encoding($false)
function SaveReceipt{[IO.File]::WriteAllText($taskReceipt,($taskResult|ConvertTo-Json -Depth 5),$taskUtf8)}
SaveReceipt
try{
    Remove-Item -LiteralPath $taskSource
    if(Test-Path -LiteralPath $taskSource){throw 'Owned download still exists'}
    if((Get-FileHash -LiteralPath $taskRetained -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskPackage.sha256){throw 'Retained SHA changed'}
    $taskResult.sourceRemoved=$true;$taskResult.status='PASS'
}catch{$taskResult.status='FAILED';$taskResult.error=$_.Exception.Message;throw}
finally{SaveReceipt}
Write-Output ($taskResult|ConvertTo-Json -Depth 5)
