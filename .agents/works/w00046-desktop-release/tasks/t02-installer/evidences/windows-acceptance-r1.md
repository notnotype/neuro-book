# w00046 t02 Windows 验收第 1 轮（2026-11-18，pc-notype，Windows 11，分支 feat/w00046-t02-t02-first-run）

## 第一部分：桌面快捷方式的 Windows 端口（desktop/src/bun/desktop-shortcut.ts，单独运行）

用专门的文件名 NeuroBook t02test.lnk 与一个假的 launcher.exe（所在文件夹名含弯引号、方括号与中文），对真实的桌面已知文件夹做：建、再建、删、再删、同名别人的快捷方式删与建。脚本 /tmp 下的 shortcut-check.ts，结束时删掉测试文件。

```
desktop folder: ok; target folder has curly apostrophe, brackets and Chinese
1 create when absent: {"ok":true,"outcome":"created"} exists=true in 2377 ms
   target matches launcher: true
2 create again: {"ok":true,"outcome":"present"} exists=true in 308 ms
3 remove ours: {"ok":true,"outcome":"removed"} exists=false in 318 ms
4 remove again: {"ok":true,"outcome":"absent"} exists=false in 222 ms
5 other target, ensure-absent: {"ok":true,"outcome":"kept-other"} exists=true in 344 ms
6 other target, ensure-present: {"ok":true,"outcome":"kept-other"} exists=true in 272 ms
   other target kept: true
RESULT ok
cleanup: test shortcut present=false
```

## 第二部分：装上的测试版里的首次启动向导

测试标识 io.github.notnotype.neurobook.t02test（装在自己的目录，不覆盖正式安装），状态根用 NBOOK_STATE_ROOT 指到测试目录（Setup 装完自动打开的那次也带着它），书架上一部作品。经 WebView2 的调试端口 9339 驱动页面，没有屏幕截图、没有系统鼠标键盘输入；“打开”按钮不点（会在开发者桌面上开资源管理器窗口）。
```
fresh state root with one work
wizard shown: step=1, focus on primary=true, progress="第 1 步，共 4 步：欢迎"
desktop frame: true; mood transition=0.28s
step 2: cards=["nbook:320","macos:320","eye-green:320","eye-sepia:320","nbook.theme-study.study:0"]
step 2: settings.json theme=macos appearance=dark; page appearance=dark
step 3 rows (state root from NBOOK_STATE_ROOT, so only the tray row): ["tray"]
step 4: state root shown matches=true; library shown=true
finished: wizard closed, record in user storage
shell.log: install-facts {"installed":true,"defaultStateRoot":false,"stateRoot":"C:\\Users\\notnotype\\nb-w00046\\t02\\state"}
reopened: wizard present=false
RESULT ok
```


- 第二步多出的 nbook.theme-study.study（内置插件 theme-study 的书房）没有缩略图：之后补上了（提交 772eb2f37），机检改为工作台的内置主题加书房。
- 状态根来自环境变量，按设计不碰快捷方式与开机自启，壳日志里没有 desktop.shortcut、desktop.login-item 的动作；第三步只有关窗去向一行。
- 收尾：删掉测试标识的安装目录与它的卸载登记（不跑它的卸载程序），桌面与开始菜单的 NeuroBook.lnk 指回正式安装（装测试版前记下的目标），开发者的状态根 %LOCALAPPDATA%\NeuroBook 的壳日志最后写入时间早于本次测试。
- 没验：缺省状态根下真实安装里关掉快捷方式后桌面上的那个被删、以及更新换上后再删一次（要用开发者真实的状态根，没有做）；端口与判定分别由第一部分与 desktop-shortcut.test.ts、shell.test.ts 覆盖。
