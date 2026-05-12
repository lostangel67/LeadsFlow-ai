Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
' Pega o diretorio atual (onde o vbs esta)
strPath = objFSO.GetParentFolderName(WScript.ScriptFullName)

' Executa silenciosamente o comando do electron na mesma pasta, escapando e setando a pasta antes
objShell.CurrentDirectory = strPath
objShell.Run "cmd /c npx electron .", 0, False
