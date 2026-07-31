Option Explicit

Dim shell, fileSystem, launcherFolder, companionPath
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

launcherFolder = fileSystem.GetParentFolderName(WScript.ScriptFullName)
companionPath = fileSystem.BuildPath(launcherFolder, "after-effects-codex-chat.exe")

' Window style 0 keeps the console-subsystem companion invisible while it
' remains in the interactive After Effects desktop session.
shell.Run Chr(34) & companionPath & Chr(34), 0, False
