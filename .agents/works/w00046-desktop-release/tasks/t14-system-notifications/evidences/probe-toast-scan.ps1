# Read-only: top-level windows (class, process, name) of WebView2 / shell experience processes right after a notification was shown. No content of other apps is read beyond window class and process name.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [Windows.Automation.AutomationElement]::RootElement
foreach ($w in $root.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)) {
  $p = Get-Process -Id $w.Current.ProcessId -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -in "msedgewebview2", "ShellExperienceHost", "SearchHost", "StartMenuExperienceHost", "bun", "launcher", "explorer") {
    $n = $w.Current.Name; if ($p.ProcessName -eq "explorer" -and $w.Current.ClassName -ne "Windows.UI.Core.CoreWindow") { continue }
    "$($p.ProcessName) class=$($w.Current.ClassName) offscreen=$($w.Current.IsOffscreen) name=$(if ($n.Length -gt 40) { $n.Substring(0,40) } else { $n })"
  }
}
"scan-done"
