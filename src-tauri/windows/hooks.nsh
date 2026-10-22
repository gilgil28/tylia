; Tylia's additions to Tauri's NSIS installer (bundle.windows.nsis.installerHooks; included
; before Tauri's pages are defined). See docs/ARCHITECTURE.md §5.19.
;
; - The finish page's "Create desktop shortcut" starts unticked, and silent / passive installs
;   don't add one.
; - The welcome page offers two options, both on by default and in passive / silent installs:
;   the `tylia` command (bin\tylia.cmd) on the user's PATH, and "Open in Tylia" in Explorer's
;   menu for folders and folder backgrounds.
; - Updates keep what was chosen before. Uninstalling removes both; the user's settings stay
;   unless they tick Tauri's "Delete the application data".

!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

; Consumed by the next MUI page Tauri inserts: the welcome page. Its text is shorter than
; MUI's default, to leave room for the options.
!define MUI_WELCOMEPAGE_TEXT "Setup will install Tylia for your user account; no administrator rights are needed.$\r$\n$\r$\nClick Next to continue."
!define MUI_PAGE_CUSTOMFUNCTION_SHOW TyliaWelcomeShow
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE TyliaWelcomeLeave

!define TYLIA_MENU_FOLDER "Software\Classes\Directory\shell\Tylia"
!define TYLIA_MENU_BACKGROUND "Software\Classes\Directory\Background\shell\Tylia"
; Set while the `tylia` command is on PATH, so an update knows whether to keep it there.
!define TYLIA_STATE_KEY "Software\Tylia"

Var TyliaPathBox
Var TyliaMenuBox
; "1" when the user unticked the option; empty (the default) means on.
Var TyliaNoPath
Var TyliaNoMenu
Var TyliaHadDesktopShortcut

Function TyliaWelcomeShow
  ; MUI's welcome text label reaches down to 175u and would cover the options. Shorten it
  ; to 96u (it ends at 141u). nsDialogs numbers the page's controls from 1200: image,
  ; title, text. (Its variable, $mui.WelcomePage.Text, is declared after this file.)
  FindWindow $0 "#32770" "" $HWNDPARENT
  GetDlgItem $1 $0 1202
  System::Call "*(i 0, i 0, i 195, i 96) p .r2"
  System::Call "user32::MapDialogRect(p r0, p r2)"
  System::Call "*$2(i, i, i .r3, i .r4)"
  System::Free $2
  System::Call "user32::SetWindowPos(p r1, p 0, i 0, i 0, i r3, i r4, i 0x16)"

  CreateFont $1 "$(^Font)" "$(^FontSize)"
  ${NSD_CreateCheckbox} 120u 150u 195u 10u "Add the tylia command to PATH"
  Pop $TyliaPathBox
  ${NSD_CreateCheckbox} 120u 164u 195u 10u "Add $\"Open in Tylia$\" to Explorer's folder menu"
  Pop $TyliaMenuBox
  ${If} $TyliaNoPath != 1
    ${NSD_Check} $TyliaPathBox
  ${EndIf}
  ${If} $TyliaNoMenu != 1
    ${NSD_Check} $TyliaMenuBox
  ${EndIf}
  SendMessage $TyliaPathBox ${WM_SETFONT} $1 1
  SendMessage $TyliaMenuBox ${WM_SETFONT} $1 1
  ; The welcome page's white (MUI_BGCOLOR, which isn't defined yet where this file is read).
  SetCtlColors $TyliaPathBox "" "FFFFFF"
  SetCtlColors $TyliaMenuBox "" "FFFFFF"
FunctionEnd

Function TyliaWelcomeLeave
  ${NSD_GetState} $TyliaPathBox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $TyliaNoPath ""
  ${Else}
    StrCpy $TyliaNoPath 1
  ${EndIf}
  ${NSD_GetState} $TyliaMenuBox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $TyliaNoMenu ""
  ${Else}
    StrCpy $TyliaNoMenu 1
  ${EndIf}
FunctionEnd

; Adds or removes $INSTDIR\bin in the user's PATH. NSIS strings stop at 1024 characters, so
; the edit is done by the .NET registry API, which keeps PATH a REG_EXPAND_SZ. The folder is
; passed in an environment variable, never quoted into the command.
!macro TyliaUserPath ACTION
  System::Call 'Kernel32::SetEnvironmentVariable(t "TYLIA_BIN", t "$INSTDIR\bin")'
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); $$p = [string]$$k.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); $$parts = @($$p -split ';' | Where-Object { $$_ -and $$_.TrimEnd('\') -ne $$env:TYLIA_BIN }); if ('${ACTION}' -eq 'add') { $$parts += $$env:TYLIA_BIN }; if ($$parts.Count) { $$k.SetValue('Path', ($$parts -join ';'), 'ExpandString') } else { $$k.DeleteValue('Path', $$false) }"`
  Pop $0
  ; Running Explorer and new consoles pick up the change.
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=500
!macroend

!macro TyliaMenuEntry KEY ARG
  WriteRegStr SHCTX "${KEY}" "" "Open in Tylia"
  WriteRegStr SHCTX "${KEY}" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "${KEY}\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "${ARG}"'
!macroend

!macro NSIS_HOOK_PREINSTALL
  ${If} ${FileExists} "$DESKTOP\${PRODUCTNAME}.lnk"
    StrCpy $TyliaHadDesktopShortcut 1
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Tauri adds a desktop shortcut to every silent or passive install (they skip the finish
  ; page with its unticked box), e.g. winget's. Leave the desktop as it was.
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    ${If} $TyliaHadDesktopShortcut != 1
      Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}

  ; An update (passive, no welcome page) keeps the earlier choice.
  ${If} $UpdateMode = 1
    ReadRegStr $0 SHCTX "${TYLIA_MENU_FOLDER}" ""
    ${If} $0 == ""
      StrCpy $TyliaNoMenu 1
    ${EndIf}
    ReadRegStr $0 SHCTX "${TYLIA_STATE_KEY}" "OnPath"
    ${If} $0 != 1
      StrCpy $TyliaNoPath 1
    ${EndIf}
  ${EndIf}

  ${If} $TyliaNoMenu != 1
    !insertmacro TyliaMenuEntry "${TYLIA_MENU_FOLDER}" "%V"
    !insertmacro TyliaMenuEntry "${TYLIA_MENU_BACKGROUND}" "%V"
  ${Else}
    DeleteRegKey SHCTX "${TYLIA_MENU_FOLDER}"
    DeleteRegKey SHCTX "${TYLIA_MENU_BACKGROUND}"
  ${EndIf}

  ${If} $TyliaNoPath != 1
    !insertmacro TyliaUserPath "add"
    WriteRegStr SHCTX "${TYLIA_STATE_KEY}" "OnPath" 1
  ${Else}
    !insertmacro TyliaUserPath "remove"
    DeleteRegValue SHCTX "${TYLIA_STATE_KEY}" "OnPath"
    DeleteRegKey /ifempty SHCTX "${TYLIA_STATE_KEY}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; The update's own uninstall step leaves both in place for the new version.
  ${If} $UpdateMode <> 1
    DeleteRegKey SHCTX "${TYLIA_MENU_FOLDER}"
    DeleteRegKey SHCTX "${TYLIA_MENU_BACKGROUND}"
    !insertmacro TyliaUserPath "remove"
    DeleteRegValue SHCTX "${TYLIA_STATE_KEY}" "OnPath"
    DeleteRegKey /ifempty SHCTX "${TYLIA_STATE_KEY}"
  ${EndIf}
!macroend
