## 下载哪个

- **安装版**：`NeuroBook-win-x64-Setup.zip`。解压后运行里面的 `NeuroBook-Setup.exe`，装到当前用户下，不需要管理员权限。装好以后有新版本时会提示，同意后在后台下载，下次打开时换上。
- **便携版**：`NeuroBook-win-x64-portable.zip`。解压到任意目录直接运行，数据放在解压目录下的 `data\`。便携版不自动更新，有新版本时只提示并打开这个页面。
- **macOS（Apple Silicon，预览）**：`NeuroBook-macos-arm64.dmg`。打开后把 NeuroBook 拖进“应用程序”。只支持 M 系列芯片的 Mac；窗口用系统标题栏，开机自启、桌面快捷方式与磨砂背景这几项 Windows 专有的设置不生效。这一版的 Release 里没有它时，是 macOS 构建没成功，之后会补上。
- 其余文件（`.tar.zst`、`update*.json`、`.patch`）给自动更新用，不用下载。`SHA256SUMS` 是 Windows 文件的 SHA-256，`SHA256SUMS-macos` 是 macOS 文件的。

## 第一次运行

安装包没有代码签名。Windows 可能显示“Windows 已保护你的电脑”：点“更多信息”，再点“仍要运行”。

macOS 版也没有签名与公证，第一次打开会被拦下：在系统设置的“隐私与安全性”里点“仍要打开”，或在终端运行 `xattr -dr com.apple.quarantine /Applications/NeuroBook.app`。

## 回到旧版本

自动更新只升不降。要回到旧版本，先备份数据目录（安装版是 `%LOCALAPPDATA%\NeuroBook`，便携版是解压目录下的 `data\`），再从旧版本的页面下载重装：旧版本不一定读得了新版本写过的数据。
