param([switch]$Elevated)
$ErrorActionPreference='Stop'
if(!$Elevated){
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated')|Out-Null
  return
}
$out='F:\testavn\Windows-Isolated-1985-20261116-03\temp-acl-audit.json'
if(Test-Path -LiteralPath $out){throw 'Preserve receipt'}
$rows=@()
foreach($p in @('F:\testavn\Windows-Isolated-1985-20261116-01\qa-temp',
 'F:\testavn\Windows-Isolated-1985-20261116-01\qa-temp\_MEI313282',
 'F:\testavn\Windows-Isolated-1985-20261116-01\qa-temp\_MEI313282\_asyncio.pyd')){
 try{$a=Get-Acl -LiteralPath $p
   $rows+=@{path=$p;owner=$a.Owner;access=$a.AccessToString;sddl=$a.Sddl}
 }catch{$rows+=@{path=$p;error=$_.Exception.ToString()}}
}
$r=@{identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name;rows=$rows;readOnly=$true;
 administrator=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)}
[IO.File]::WriteAllText($out,($r|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
