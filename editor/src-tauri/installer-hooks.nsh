; Close processes from an older AgentVN Editor before NSIS overwrites sidecars.
; Ignore taskkill exit codes: the process may already be closed.
!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "AgentVN Editor.exe"'
  Pop $0
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "agentvn-editor.exe"'
  Pop $0
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "creator-backend.exe"'
  Pop $0
  Sleep 800
!macroend
