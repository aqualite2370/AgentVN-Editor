$ErrorActionPreference='Stop'
$root='D:\AgentVN\output\host-msi-continuation-20261018-02'
$file='D:\agentvntest\AgentVN Editor\build-versions.json'
$target='F:\AgentVN-QA-HostMSI-20261018-02\zh-CN\repair-fault\build-versions.json'
$receipt=Join-Path $root 'zh-CN\repair-fault.json'
$active=@(Get-CimInstance Win32_Process|Where-Object {
    $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
    ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')
})
if($active.Count){throw 'Idle required'}
if((Test-Path -LiteralPath $target) -or (Test-Path -LiteralPath $receipt)){throw 'Fresh fault injection required'}
$prep=Get-Content -LiteralPath (Join-Path $root 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
foreach($profile in $prep.profiles){if(!(Test-Path -LiteralPath $profile.held)){throw 'Original profile protection not held'}}
if([IO.Path]::GetFullPath($file) -ne 'D:\agentvntest\AgentVN Editor\build-versions.json' -or
    [IO.Path]::GetFullPath($target) -ne 'F:\AgentVN-QA-HostMSI-20261018-02\zh-CN\repair-fault\build-versions.json'){throw 'Unsafe fault target'}
$hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
if($hash -ne 'c990aec0b05368eba767fdecaf45ebd918cc34518c03e99994cd5ac02300024a'){throw 'Unexpected resource identity'}
$null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target))
Move-Item -LiteralPath $file -Destination $target
if((Test-Path -LiteralPath $file) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash){throw 'Fault staging did not preserve exact original'}
$result=@{status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');scope='CONTROLLED_MISSING_INSTALLED_FILE_FOR_REAL_MSI_REPAIR_NOT_NATURAL_PRODUCT_FAILURE';
    path=$file;preservedOriginal=$target;sha256=$hash;originalAbsent=$true;deletedFiles=0}
[IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding($false)))
Write-Output 'PASS: exact installed version resource retained on F; missing-file repair precondition verified'
