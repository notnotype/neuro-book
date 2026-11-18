# NeuroBook 桌面壳（Electrobun）

Windows 桌面版的主进程与壳自己的页面。行为合同是 [`runtime/desktop-shell`](../../../docs/specs/runtime/desktop-shell.md) 与 [`runtime/desktop-update`](../../../docs/specs/runtime/desktop-update.md)；流程与规则都在核心 [`src/desktop/`](../src/desktop/)（不依赖 Electrobun，`bun test src/desktop` 在 Linux 上用真实进程测），这里只把核心要的端口接到 Electrobun 2.0.6 上。

| 文件 | 作用 |
|---|---|
| `src/bun/index.ts` | 主进程：窗口、对话框、导航、桥、退出的拦截，WebView2 检查，接 Electrobun 的更新器 |
| `src/bun/preload.ts` | 产品窗口的预加载脚本：页面标题与新窗口请求经事件桥交给壳；无标题栏的窗口另定义能力标记 `__nbookDesktopFrame` |
| `src/bun/win32.ts` | 无标题栏的窗口经 `bun:ffi` 补窗口样式（最大化限在工作区）、按 DPI 设窗口图标、给产品窗口装最小尺寸的窗口过程 |
| `src/bun/min-size.c` | 产品窗口最小尺寸的窗口过程（子类化，`WM_GETMINMAXINFO` 抬高最小跟踪尺寸）；主进程运行时用 `bun:ffi` 的 `cc` 编译，写法上的约束在源码开头 |
| `src/views/shell/index.html` | 启动页与壳的对话框（同一页，按壳交来的状态显示） |
| `electrobun.config.ts`、`hutch.config.ts` | Electrobun 与 Hutch 的配置，版本固定 |
| `assets/neurobook.ico` | 应用图标（16–256，都从不带边框的 SVG 渲染），从 [`brand/logo/06-production/desktop/windows/`](../../../brand/logo/06-production/desktop/windows/) 复制，品牌那边重新生成后跟着换；嵌进程序与安装程序，也复制进包供窗口图标加载 |
| `scripts/build.ts` | 在仓库里把主进程打成 `bundle/main.js`，按发布清单组装载荷到 `payload/` |
| `scripts/build-variant.ts` | Windows 上把这个工程复制一份、放进做好的 `bundle/` 与 `payload/`、用 Hutch 构建一个变体（发布流水线与本机验证共用） |
| `scripts/portable.ts` | 从完整包 `stable-win-x64-NeuroBook.tar.zst` 打便携 zip |
| `scripts/smoke-windows.ts`、`scripts/smoke-update.ts`、`scripts/smoke/` | Windows 上安装版、便携版与自动更新的冒烟（在登录的桌面会话里跑） |

`bundle/` 是我们预打包的主进程，`build/` 与 `artifacts/` 是 Electrobun 自己的输出目录；分开放，免得 Electrobun 构建时清掉或覆盖预打包的文件。

## 构建

1. 仓库里（Linux 或 Windows 都行），在 `packages/neuro-book` 下：先 `bun run release:smoke`（仓库根）得到发布清单，再 `bun desktop/scripts/build.ts ../../dist/release/release-manifest.json`。只打主进程时不给清单。
2. Windows 上进 `desktop/`：清掉 `HTTPS_PROXY`、`HTTP_PROXY`（Hutch 0.29.0 设了它们下载必失败），`hutch install`，`hutch electrobun build --env=stable`。产物在 `artifacts/`：`Setup.zip`（无界面安装包）与更新文件。Hutch 每次构建都清空 `artifacts/`、文件名里没有标识与版本，要留几份产物时用 `scripts/build-variant.ts`，每份一个工程目录。Hutch 的版本固定在 `package.json` 的 `config.hutch`。
3. 便携包：`bun desktop/scripts/portable.ts <artifacts/stable-win-x64-NeuroBook.tar.zst> <输出目录>`，从完整包解压出应用目录、根目录放空文件 `NeuroBook.portable` 再打 zip（安装包里没有这个标记）。不从 `build/stable-win-x64/NeuroBook/` 打：stable 构建打完内层 tar 后会把它重建成解压器外壳。

更新源（`release.baseUrl`）缺省是 GitHub 最新 Release 的下载地址，构建进包里，装好之后改不了。自动更新的验收在第 2 步之前设两个环境变量：`NBOOK_UPDATE_BASE_URL` 指向本地更新源（与 Release 同样的文件布局），`NBOOK_DESKTOP_IDENTIFIER` 换一个应用标识，测试包装进另一个目录、不碰正式安装。测试版本不加构建参数：在独立的检出副本里同时改 `src/shared/product.ts` 的 `PRODUCT_VERSION` 与 `package.json` 的 `version`，在仓库根 `bun install` 刷新 `bun.lock`（不刷新时 `release:smoke` 报依赖与 bun.lock 不一致），从第 1 步开始构建。

`NBOOK_STATE_ROOT` 只收绝对路径：Electrobun 的启动器以安装里的 `app\bin` 为工作目录启动主进程，不传原来的工作目录。

窗口外框（desktop-shell 输出 10）：WebView2 主版本不低于 123 时窗口用 `titleBarStyle: "hiddenInset"`，页面画按钮、用 CSS `app-region` 标拖动区域；更旧的 WebView2 退回系统标题栏。升级 Electrobun 时复测：`hiddenInset` 的窗口最大化是否落在工作区（`win32.ts` 补样式所依赖的行为），以及沙箱页面里的 `app-region` 是否仍回 `HTCAPTION`（w00046 t03 的 `evidences/windows-frame-r1.txt` 与它的脚本）。最小尺寸（`min-size.c`）也要复测：Electrobun 有了 `minWidth`/`minHeight`（上游 PR blackboardsh/electrobun#478 那类接口）就改用它、删掉子类化；它若自己也换窗口过程，确认我们的过程仍在链上（w00046 t18 的 `evidences/min-size-probe-r1.txt`）。

`src/bun/` 只在 Hutch 构建的应用里运行，类型检查不覆盖它（`preload.ts`、`win32.ts` 例外，不依赖 Electrobun，纳入应用包的类型检查）（Electrobun 的类型由 Hutch 提供）；它的行为靠 Windows 上的实测把关，记录在 w00046 t08 的证据里。

## 发布流水线里的构建与冒烟

打标签发布时（`.github/workflows/release.yml`，流程见 [发布手册的“流水线”](../../../docs/standards/releasing.md#流水线)），壳与载荷在 ubuntu 上按发布清单做好，Windows 作业只跑 Hutch 与冒烟。三个变体各一份工程目录：

| 变体 | 输入 | 标识与更新源 | 用途 |
|---|---|---|---|
| 正式 | 标签提交 | 缺省 | 发布资产；安装版、便携版冒烟 |
| A′ | 与正式同一份 | 测试标识、本机更新源 | 更新冒烟的旧版本 |
| B′ | 标签提交加一个只在 runner 上的测试提交（补丁号加 1） | 同 A′ | 更新冒烟的新版本；构建时从本机更新源取 A′ 做补丁 |

冒烟经 WebView2 的远程调试端口驱动页面，关窗用 `WM_CLOSE`（与用户点关闭同一条路）；更新器换上后拉起的新版本不带调试端口，那一次按壳日志里页面交回的 `desktop.update.notice-shown` 取证。证据（日志、`version.json`、更新器结果、更新源请求记录、页面截图）作为作业产物上传。
