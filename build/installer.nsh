; 御园莓华 — character-themed installer pages (included by electron-builder before MUI2.nsh).
; Artwork: build/installerSidebar.bmp, uninstallerSidebar.bmp, installerHeader.bmp (scripts/installer-art.mjs).

; berry-cream colours for the header and the welcome / finish pages (MUI2 only sets defaults if undefined)
!define MUI_BGCOLOR "FFF5F7"
!define MUI_TEXTCOLOR "4B2C3E"

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "你好呀，我是御园莓华！"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "接下来我会住进你的电脑桌面——$\r$\n$\r$\n陪你聊天解闷，帮你记日程、待办和提醒，到点叫你休息喝水；复杂的电脑工作（写代码、整理文件、做调研）也可以交给我的「工坊」慢慢完成。$\r$\n$\r$\n每天记得来签到、喂我吃点心哦，我会一点点长大的～$\r$\n$\r$\n点击「下一步」，带我回家吧。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  Function MeihuaStartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_TITLE "安装完成啦！"
  !define MUI_FINISHPAGE_TITLE_3LINES
  !define MUI_FINISHPAGE_TEXT "莓华已经在桌面上等你了。$\r$\n$\r$\n· 右键点她：打开花环菜单（喂食、签到、聊天……）$\r$\n· 双击她：直接说话$\r$\n· 按住右键拖动：把她带到任何地方，用力甩出去她还会弹来弹去$\r$\n· 摸摸头、碰碰耳朵和尾巴，她都会有反应"
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "现在就和莓华见面"
  !define MUI_FINISHPAGE_RUN_FUNCTION "MeihuaStartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "要和莓华说再见了吗？"
  !define MUI_WELCOMEPAGE_TEXT "卸载只会移除程序本身。$\r$\n$\r$\n你们的聊天记录、她记住的事、日程待办和小窝里的养成进度都会留在这台电脑上，重新安装后，她依然会记得你。$\r$\n$\r$\n点击「下一步」继续。"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
