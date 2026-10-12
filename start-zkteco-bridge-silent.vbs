Set WshShell = CreateObject("WScript.Shell")
strPath = WshShell.CurrentDirectory & "\start-zkteco-bridge-silent.bat"
If Not CreateObject("Scripting.FileSystemObject").FileExists(strPath) Then
    strPath = "C:\Users\ESSU LOLI\OneDrive\Documents\Capstone\E-comply\start-zkteco-bridge-silent.bat"
End If
WshShell.Run Chr(34) & strPath & Chr(34), 0, False
Set WshShell = Nothing
