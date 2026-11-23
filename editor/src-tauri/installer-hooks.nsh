; Let the current installation commit its WebView state and release sidecars.
; Never force-kill Chromium: localStorage writes may still be renderer-local.
!ifndef AGENTVN_UPGRADE_HELPER
  !define AGENTVN_UPGRADE_HELPER "${__FILEDIR__}\installer-close-for-upgrade.ps1"
!endif
!macro NSIS_HOOK_PREINSTALL
  InitPluginsDir
  File "/oname=$PLUGINSDIR\agentvn-close-for-upgrade.ps1" "${AGENTVN_UPGRADE_HELPER}"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\agentvn-close-for-upgrade.ps1" -InstallDirectory "$INSTDIR"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "$1"
    MessageBox MB_OK|MB_ICONEXCLAMATION "AgentVN Editor 未能安全关闭。请完成保存或确认，手动关闭编辑器后重试安装。$\r$\n$\r$\n$1" /SD IDOK
    Abort
  ${EndIf}
!macroend
