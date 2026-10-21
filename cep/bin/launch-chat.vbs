Option Explicit

Dim shell, fileSystem, launcherFolder, companionPath, processEnvironment, currentPath
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

' AE may still have the PATH from before Pi/Node was installed. Refresh only
' this child process environment; never modify the user's saved PATH.
Set processEnvironment = shell.Environment("PROCESS")
currentPath = processEnvironment("PATH")
processEnvironment("PATH") = shell.ExpandEnvironmentStrings(shell.Environment("USER")("PATH") & ";" & shell.Environment("SYSTEM")("PATH") & ";" & currentPath)

launcherFolder = fileSystem.GetParentFolderName(WScript.ScriptFullName)
companionPath = fileSystem.BuildPath(launcherFolder, "after-effects-codex-chat.exe")

' Window style 0 keeps the console-subsystem companion invisible while it
' remains in the interactive After Effects desktop session.
shell.Run Chr(34) & companionPath & Chr(34), 0, False
