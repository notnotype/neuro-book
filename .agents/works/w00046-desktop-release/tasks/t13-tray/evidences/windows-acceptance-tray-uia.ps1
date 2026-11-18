# Read-only UI Automation over the taskbar notification area and popup menus (no screen capture). Modes:
#   list              : names of tray buttons (taskbar + overflow window if present) containing the filter
#   invoke            : Invoke the first tray button whose name contains the filter
#   menu              : names of menu items in popup menus (class #32768) / any MenuItem on the desktop
#   click <name>      : Invoke the menu item with that name
param([string]$Mode = "list", [string]$Arg = "NeuroBook")
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [Windows.Automation.AutomationElement]::RootElement
function Find-All($scope, $typeName) {
  $cond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::$typeName)
  $scope.FindAll([Windows.Automation.TreeScope]::Descendants, $cond)
}
function Tray-Buttons {
  $out = @()
  foreach ($cls in "Shell_TrayWnd", "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland") {
    $w = $root.FindFirst([Windows.Automation.TreeScope]::Children, (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ClassNameProperty, $cls)))
    if ($w -ne $null) { foreach ($b in (Find-All $w "Button")) { $out += [pscustomobject]@{Class = $cls; Name = $b.Current.Name; Element = $b} } }
  }
  $out
}
function Open-Overflow {
  $toggle = Tray-Buttons | Where-Object { $_.Name -like "*显示隐藏的图标*" } | Select-Object -First 1
  if ($toggle -ne $null) { $toggle.Element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 900 }
}
function Find-Tray($filter) {
  $b = Tray-Buttons | Where-Object { $_.Name -like "*$filter*" } | Select-Object -First 1
  if ($b -eq $null) { Open-Overflow; $b = Tray-Buttons | Where-Object { $_.Name -like "*$filter*" -and $_.Class -ne "Shell_TrayWnd" } | Select-Object -First 1 }
  $b
}
function Menu-Items {
  $out = @()
  foreach ($w in $root.FindAll([Windows.Automation.TreeScope]::Children, (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ClassNameProperty, "#32768")))) { foreach ($m in (Find-All $w "MenuItem")) { $out += $m } }
  $out
}
switch ($Mode) {
  "diag" {
    Open-Overflow
    foreach ($cls in "Shell_TrayWnd", "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland") {
      $w = $root.FindFirst([Windows.Automation.TreeScope]::Children, (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ClassNameProperty, $cls)))
      if ($w -eq $null) { "$cls : window absent"; continue }
      $all = $w.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
      "$cls : descendants=$($all.Count) buttons=$((Find-All $w 'Button').Count)"
      foreach ($e in $all) { if ($e.Current.Name -match "uro|Book|book") { "  match: [$($e.Current.ControlType.ProgrammaticName)] $($e.Current.Name) class=$($e.Current.ClassName)" } }
    }
    "top-level classes: " + (($root.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.ClassName } | Sort-Object -Unique) -join ",")
  }
  "menuwin" {
    foreach ($w in $root.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)) {
      if ($w.Current.ClassName -eq "#32768") {
        "popup pid=$($w.Current.ProcessId) offscreen=$($w.Current.IsOffscreen) name=$($w.Current.Name)"
        foreach ($e in $w.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)) { "  [$($e.Current.ControlType.ProgrammaticName)] $($e.Current.Name)" }
      }
    }
    "popups-done"
  }
  "list" { $b = Find-Tray $Arg; if ($b -ne $null) { "$($b.Class): $($b.Name)" } else { "not-found" }; "buttons-total: $((Tray-Buttons).Count)" }
  "all" { Tray-Buttons | ForEach-Object { "$($_.Class): $($_.Name)" } }
  "invoke" {
    $b = Find-Tray $Arg
    if ($b -eq $null) { "no-button"; return }
    $p = $b.Element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern); $p.Invoke(); "invoked: $($b.Name)"
  }
  "menu" {
    foreach ($m in (Menu-Items)) { "menuitem: $($m.Current.Name)" }
  }
  "click" {
    $m = Menu-Items | Where-Object { $_.Current.Name -eq $Arg } | Select-Object -First 1
    if ($m -eq $null) { "no-menuitem"; return }
    $m.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke(); "clicked: $Arg"
  }
}
