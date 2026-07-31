Option Explicit

Dim shell, fileSystem, sourceFolder, powerShellPath, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

sourceFolder = fileSystem.GetParentFolderName(WScript.ScriptFullName)
powerShellPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
command = Quote(powerShellPath) & " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & _
    Quote(fileSystem.BuildPath(sourceFolder, "install.ps1")) & " -PayloadPath " & _
    Quote(fileSystem.BuildPath(sourceFolder, "payload.zip"))

exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function
