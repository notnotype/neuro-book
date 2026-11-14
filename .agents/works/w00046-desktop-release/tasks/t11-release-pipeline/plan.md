# t11 打标签自动发布流水线：实施计划

修订记录：r1 交 omp 设计审查（23 条：阻断 4、重要 17、次要 2），本稿是 r2，逐条处理见 [design-review-r1-omp-disposition.txt](evidences/design-review-r1-omp-disposition.txt)。

## Context

打 `v<产品版本>` 标签后，GitHub Actions 依次门禁、构建与冒烟、发 npm、发 GitHub Release。依据：[桌面发行提案](../../../../../docs/proposals/desktop-distribution.md) 的 4.5、4.8 与第五节的“发布”“回滚”，以及 [ADR 0051](../../../../../docs/adr/0051-desktop-shell-electrobun-tag-release.md) 决定 7。还要兑现下面这些里写着“发布流水线的 Windows 作业”的 Smoke：

- [`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md)：安装版与便携版各跑一遍；
- [`runtime/desktop-update`](../../../../../docs/specs/runtime/desktop-update.md)：场景 1、2；有了上一个正式的桌面版本以后，另用它到本次版本跑一遍场景 1；
- t10 计划“验证”一节交下来的发布完成门禁（更新器的取法、两种查询串、保存 `version.json` 里的更新源与请求、应答头，见 t10 [windows-update-r1.txt](../t10-auto-update/evidences/windows-update-r1.txt)）；
- 现有发布流程的发布后核对：同一提交上 `release:smoke --from registry`（[`repository-workflow.md`](../../../../../docs/standards/repository-workflow.md) 的“npm 包”）。

已定的决定：
- 开发者 2026-11-13 定打 `v*` 标签后全自动发布；流水线上线前由开发者确认；push、打标签、配置 Secrets 与 Environment、npm 上配置信任，都是开发者逐次授权或亲自操作。
- 不签名（提案 4.5）。
- 只升不降，不往回拨“最新”（提案 4.8）。

工作方式：autonomous-delivery。本地能做完的切片（脚本、单测、pc-notype 上的 Windows 实测、工作流文件的静态检查）先做完。到 push 与第一次在 GitHub 上运行时停下，交开发者。

现有发布链：
- `release:smoke`：`scripts/release/pack-smoke.ts`。打包前要求会发布的目录干净并记下 HEAD，结束时再核对这些目录没变；打 12 个包，在 `dist/release/` 写 `release-manifest.json`（提交与每个 tarball 的 SHA-256）；
- `release:publish`：`scripts/release/publish.ts`，本机门禁加 `bun publish`。它用 `loadBuiltPackages` 读 `dist/plugin-sdk/`、`dist/app-package/` 的 `package.json` 建依赖图，只下载了 `dist/release/` 的干净作业里没有这两个目录；
- 桌面工程：`packages/neuro-book/desktop/scripts/build.ts` 在 Linux 上也能跑：从当前源码的 `PRODUCT_VERSION` 打壳主进程 `bundle/main.js`、写 `bundle/version.json`，按发布清单组装 Windows 载荷 `payload/`（t10 就是在 Linux 上组装 win32-x64 载荷）。`electrobun.config.ts` 构建时读 `bundle/version.json` 与两个环境变量（测试用的应用标识、更新源）；
- Hutch 构建：Windows 上 `hutch electrobun build --env=stable`，产物在工程目录的 `artifacts/`：
  - `win-x64-NeuroBook-Setup.zip`；
  - `stable-win-x64-NeuroBook.tar.zst`；
  - `stable-win-x64-update.json`、`-update-v2.json`；
  - 有上一版时还有 `stable-win-x64-<上一版哈希>.patch`。
  - Hutch 从 `release.baseUrl` 取上一版做补丁，没有上一版时打印 “no previous release found; skipping delta patch”（t10 实测）。
  - 每次构建先删掉再重建 `artifacts/`，文件名只含平台、频道与应用名，不含标识与版本（Hutch v0.29.0 `writeReleaseArtifacts`）。同一个工程目录连着构建几个包，后一个会冲掉前一个的产物。

GitHub windows runner 上已经实测过（t01 [windows-runner-probe-r1.txt](../t01-distribution-proposal/evidences/windows-runner-probe-r1.txt)）：
- 构建约 85 秒；runner 镜像不带 Bun 与 Hutch，要先装；
- Setup 能无人值守安装，但 Setup 进程装完不一定退出；
- 直接起 `app\bin\launcher.exe`，`WM_CLOSE` 后有序停止；
- 卸载 `uninstall.exe --uninstall --quiet --delete-data`。

## 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 驱动 Windows 上装好的应用的页面 | Playwright `chromium.connectOverCDP`，壳启动时设 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<端口>` | 仓库已有 Playwright 与 e2e 的定位写法，能断言页面里看得到的东西。否决 UI 自动化读文字：能看到文字，但点击与等待靠轮询，CI 上难稳定。否决只查服务端 HTTP：验不到页面与关闭前询问 |
| 不调真实模型跑一条 Agent 命令 | `src/plugins/agent/testing/endpoint.ts` 的 `fakeEndpoint` 与 `localModelSettings`，脚本回一次 `shell` 工具调用（工具给模型的名字是 `shell`，见 `backend/builtin/index.ts`） | e2e 已在用这个本机 OpenAI 兼容端点；它只在仓库检出里，不进安装包 |
| 关窗 | `user32` 的 `PostMessageW(WM_CLOSE)`，用 `bun:ffi` 调 | 与用户点关闭走同一条路（关闭前询问、有序停止）；切片 1 实测过（[cdp-probe-r1.txt](evidences/cdp-probe-r1.txt)），窗口枚举要在登录的桌面会话里跑 |
| GitHub Release 与资产 | `gh` CLI（runner 自带），由 `scripts/release/github-release.ts` 调用 | 资产列表带 `digest`（形状 `sha256:<64 位十六进制>`，审查者已在本仓库的旧 Release 上读到），能核对同名资产的摘要。否决第三方 Action：多一份要固定版本、要审查的依赖 |
| npm 发布 | npm CLI 11.5.1 以上、Node 22.14.0 以上，trusted publishing（OIDC） | 提案 4.8 已定 |
| 工作流静态检查 | `actionlint`（本机用下载的二进制跑，不进依赖） | 在 push 之前抓住表达式与 `needs` 的错 |

## 关键设计

### 构建分工：桌面工程的输入在 ubuntu 上做齐，Windows 只跑 Hutch 与冒烟

一个“桌面变体”指一份 Hutch 工程输入：`bundle/`（壳主进程与 `version.json`）加 `payload/`。三个变体：

| 变体 | 源码 | 应用标识与更新源 | 用途 |
|---|---|---|---|
| 正式 | 标签提交 | 缺省（正式标识、GitHub `latest/download`） | 发布；安装版、便携版冒烟 |
| A′ | 与正式同一份输入 | 测试标识、本机更新源 | 更新冒烟的旧版本 |
| B′ | 标签提交加一个本地测试提交：补丁号加 1 | 测试标识、本机更新源 | 更新冒烟的新版本 |

- 正式变体的输入由 `npm-packages` 作业在 `release:smoke` 之后跑 `build.ts <清单> --os win32 --cpu x64` 得到，与发到 npm 的应用包同一份 tarball。
- B′ 由 `update-test-packages` 作业在一个独立的 `git worktree`（检出标签提交）里做：
  - 改 `PRODUCT_VERSION` 与 `packages/neuro-book/package.json` 的版本，`bun install` 刷新 `bun.lock`；
  - 用一次性的身份提交到这个 worktree（不 push），让 `release:smoke` 的干净检查与结束核对照常成立，不给正式门禁开口子；
  - 在这个 worktree 里跑 `release:smoke` 与 `build.ts`，壳和应用包都是 B′ 的版本。
- 三个变体的输入各自上传为产物。Windows 上每个变体复制一份 `desktop/` 工程到 `RUNNER_TEMP` 下各自的目录，放入它的 `bundle/` 与 `payload/`，各自 `hutch install`、`hutch electrobun build`，产物互不覆盖。
- 正式变体一构建完，就把它的 `artifacts/` 与便携 zip 复制到 `release-assets/`、写 `SHA256SUMS`，之后上传的只有这个目录。A′ 构建完先把它的产物复制进本机更新源的目录，再构建 B′（Hutch 构建 B′ 时从更新源取 A′ 做补丁）。
- 复制一份 `desktop/` 单独构建是否成立（`hutch install` 要不要仓库里的别的文件），切片 4 在 pc-notype 上先验；不成立就改成每个变体一个 worktree。
- `verifyBuiltVersions`：每个变体构建前核对 `bundle/version.json`、载荷清单里应用包的版本与预期版本一致（正式与 A′ 等于标签版本，B′ 等于标签版本补丁号加 1）；构建后核对产物里 `update-v2.json` 的版本与标识。

### `scripts/release/tag.ts`（新增）：标签与版本门禁

`checkReleaseTag({tag, repository}) → {version} | 抛 GateFailure`。规则：

- 标签是 `v<稳定的语义化版本>`，带预发布段的拒绝；
- 去掉 `v` 后等于 `packages/neuro-book/package.json` 的 `version` 与 `PRODUCT_VERSION`（读 `src/shared/product.ts`，与 `product.test.ts` 同一个读法）；
- 标签解引用后的提交等于 `GITHUB_SHA`，且是 `origin/master` 的祖先（`git merge-base --is-ancestor`）。

工作流另在 `gate` 里要求这次推送是新建标签：`github.event.created` 为真、`forced` 与 `deleted` 为假。改指已有标签、删标签都不发布；重跑用同一轮的“重跑”，事件不变。命令行入口 `bun scripts/release/tag.ts <标签>`，打印版本给工作流的 `GITHUB_OUTPUT`。单测 `tag.test.ts` 用临时 Git 仓库。

### `scripts/release/publish.ts`：发布计划与 CI 入口

加两个入口，本机模式的门禁不变。

`--plan`（`npm-packages` 作业里，生成目录还在的时候跑）写 `dist/release/release-plan.json`：
- 清单里每个包的名字、版本、tarball、`dist.integrity`、运行时依赖（这时读得到生成目录），按发布顺序；
- 每个包当时在 registry 上的状态：没发、已发且字节相同、已发而字节不同。
- 失败（不写计划）的情况：
  - 本次版本的包（应用包与 SDK，版本等于标签版本）已发而字节不同：桌面载荷与 npm 上的应用包会不是同一批；
  - 计划要发的包依赖已发而字节不同的包（沿用 `blockingStalePackages`）。
- 已发而字节不同、又没人依赖的源码包，沿用现有的提醒，不发。

`--ci --yes`（`publish-npm` 作业）只读下载的 `dist/release/`，不读生成目录：
- 不跑 `npm whoami`，不要求分支叫 master（标签检出是分离的 HEAD）；
- 核对清单的 `commit` 等于 `GITHUB_SHA`，计划与清单对得上（同一批 tarball、摘要相同）；
- 对计划里每个包重读 registry：没发就发；已发而 `dist.integrity` 与计划相同就跳过（上次发了一半）；已发而不同就失败；
- 用 `npm publish <tarball> --access public --tag <标签>`，不用 `bun publish`（trusted publishing 只认 npm CLI，provenance 由它自动生成）。

npm 的 dist-tag，一律显式给：
- 每个包发之前读 `npm view <名> dist-tags.latest`；
- 包从没发过（E404），或本次版本高于它：`--tag latest`；
- 否则 `--tag history`；
- 读不到（网络、5xx）就停。
- 显式给的原因：不带 `--tag` 时 npm 11.5.1 按 registry 里最高的正式版本拒绝（不是按 `dist-tags.latest`），手工把 `latest` 回拨过的包会被拒。

纯函数 `distTagFor(version, latest)`、`planProblems(plan, registryState)` 放进 `publish.ts`，单测加进 `publish.test.ts`：含 `latest` 不是最高版本、`latest` 缺失、读取失败、本次版本的包已发而字节不同。

### `scripts/release/github-release.ts`（新增）：草稿、资产、公开

命令：

- `draft <版本> <资产目录>`：
  - 没有这个标签的 Release 时建草稿：`gh release create v<版本> --draft --verify-tag --notes-file <说明>`；
  - 只上传缺的资产；
  - 同名资产的 `digest` 与本地 SHA-256 不同就失败；
  - 已经公开的 Release 只做核对、不上传。
- `publish <版本>`：
  - 核对资产齐全、摘要一致；
  - 读当前最新 Release 的标签（`gh release view --json tagName`）。它可能是旧应用的 `v0.9.2-canary…` 这类带预发布段的标签，按语义化版本比较，不套用 `tag.ts` 的“只收稳定版本”；
  - 当前最新就是本次版本，或本次版本更高：`latest=true`；否则 `latest=false`；
  - 公开与是否设为最新在同一个请求里定：`gh release edit v<版本> --draft=false --latest=<true|false>`（草稿不能设为最新；公开时不带 `make_latest` 会缺省设为最新）；
  - 已经公开的：只核对，`latest` 只在本次应为最新、而当前最新是更低版本时补设，不撤掉已有的标记。
- 公开请求成功但作业在返回前失败时，重跑读到的是已公开的 Release，按上一条只核对。

资产（`SHA256SUMS` 覆盖其余全部）：
- `win-x64-NeuroBook-Setup.zip`；
- `NeuroBook-<版本>-win-x64-portable.zip`；
- `stable-win-x64-NeuroBook.tar.zst`；
- `stable-win-x64-update.json`、`stable-win-x64-update-v2.json`；
- 有补丁时 `stable-win-x64-<哈希>.patch`；
- `SHA256SUMS`。

说明模板 `scripts/release/desktop-release-notes.md`：下载哪个文件、SmartScreen 的“仍要运行”、便携版不自动更新、回到旧版本先备份。

`gh` 的调用经一个注入的 `run` 端口，单测用记录调用的替身，核对调用与判断。替身的输入形状照 `gh release view --json assets` 的真实输出。

### `scripts/release/verify-update-feed.ts`（新增）：发布完成门禁

先重读当前最新 Release，分三种：
- **本次是最新**：照更新器的取法对 `https://github.com/notnotype/neuro-book/releases/latest/download/` 发 GET；
- **已被更高版本取代**（重跑时较新的已经发了），或**本次是补发的旧版本**：对 `releases/download/v<版本>/` 核对资产，注明 `latest` 路由这次没有验；
- **本次没有公开**：失败。

要核对的：
- `stable-win-x64-update-v2.json?<16 位十六进制>`：版本、哈希、标识、频道、平台、架构与本次正式构建一致，声明的文件存在；
- `stable-win-x64-update.json?cache=<32 位>`（下一次构建 Hutch 要取的）：与 v2 指向同一版本、同一哈希、同一文件；
- 清单声明的完整包与补丁（若有）按 `?cache=<32 位>` 下载，SHA-256 与本地资产相同；
- 正式构建产物里 `Resources/version.json` 的更新源是 GitHub `latest/download`、版本与哈希与清单一致。

跟随重定向至多 5 跳，都要 200。查询串的形状写成常量，注释链接 Electrobun 2.0.6 的出处与 t10 的请求日志。每个请求的地址、重定向链、状态与应答头写进 `feed-evidence.json`，作为作业产物上传，并写进作业摘要。失败时作业失败，摘要写明“发行没有完成，自动更新不可用”与处置（见“失败与重跑”）。

### `packages/neuro-book/desktop/scripts/smoke-windows.ts`（新增）：安装版与便携版的冒烟

在 Windows 上用 Bun 运行，参数 `--setup <Setup.zip> | --portable <zip>`，`--evidence <目录>`；本机验证时另收 `--state-root`（CI 不给，用缺省）。步骤：

1. **准备**：
   - 状态根用缺省的 `%LOCALAPPDATA%\NeuroBook`；便携版用程序目录下的 `data\`；
   - 起 `fakeEndpoint`，在状态根写 `settings.json`（`localModelSettings`）；
   - 在仓库外的临时目录建一部作品，写一章已知内容；经应用的“打开作品”登记，不直接写 `projects.json`；
   - 便携版：先记下缺省状态根的顶层清单与 `projects.json`、`settings.json` 的摘要（安装版冒烟已在那里留下东西），作基线。
2. **安装**：
   - 解压 Setup.zip，起 `*-Setup.exe`；
   - 等安装目录里出现 `app\bin\launcher.exe` 和卸载注册表项，至多 3 分钟；
   - Setup 进程还在就结束它（t01：装完不一定退出），并结束它自动拉起的应用。
   - 便携版：解压到另一个临时目录，根目录有 `NeuroBook.portable`。
3. **启动**：
   - 设 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 起 `launcher.exe`；
   - `connectOverCDP` 等页面就绪（书架页的作品卡）。
4. **作品与命令**：
   - 打开那部作品，在 Agent 输入框发一句；
   - 端点回 `shell` 工具调用，命令 `echo nb-smoke-<随机串>`，再回一句结束；
   - 端点记到的第二个请求里，对应这次调用的工具结果退出码是 0、输出里有这一行；会话完成。只看页面或请求里“含随机串”不够：命令参数本身就含它。
5. **关窗**：
   - 对产品窗口 `WM_CLOSE`（窗口句柄按进程号枚举）；
   - 关闭前询问以 `quit` 同意（没有未保存的内容与在跑的工作）；
   - 壳进程以 0 退出，至多 90 秒；
   - 状态根下没有 `logs\desktop\unclean-stop.json`（壳以 0 退出不代表服务端有序停止；服务端超时、被强制结束或非 0 退出时壳写这个标记）；
   - 没有残留的 `bun.exe` 子进程。
6. **卸载**（安装版）：`uninstall.exe --uninstall --quiet --delete-data`，安装目录与开始菜单快捷方式都不在；缺省状态根里的 `projects.json`、`settings.json` 与那部作品的文件都还在（desktop-shell：卸载不删作品与设置）。
7. **便携版另核对**：`data\` 在程序目录下；缺省状态根与基线相同；`%LOCALAPPDATA%\io.github.notnotype.neurobook\stable` 下没有建出状态文件。

每一步打印一行 `✓`。证据目录不论成败都写（见下一节“冒烟的证据”）。定位写法复用 e2e 里的数据属性，不另造。

### `packages/neuro-book/desktop/scripts/smoke-update.ts`（新增）：更新的冒烟

对应 desktop-update 的 Smoke：场景 1、场景 2；有上一个正式桌面版本时再跑一遍场景 1。用 A′、B′ 两个测试包（见“构建分工”），本机静态更新源与 t10 的 `t10-serve.ts` 同一种写法，记请求。状态根用缺省的（设了 `NBOOK_STATE_ROOT` 就进只提示模式，不下载、不换上）。

- **场景 1 与场景 2 后半**：
  - 装 A′；在 A′ 的状态根里建一部作品、写一章已知内容；
  - 源放 B′：页面出现“可以更新”，点“下载”，等到“已下载”；请求记录里取的是补丁；
  - 关窗，把源换回 A′（低于已下载的 B′，与场景 2 后半“已下载 C 之后源换成 B”同一形状：源退回正在运行的版本）；
  - 再起：等到 B′ 的页面与“已更新到”，没有“可以更新”的提示；
  - 同一状态根、同一部作品、那一章内容不变；安装目录与缺省位置之外没有建出新的状态根。
- **场景 2 前半**：
  - 关掉 B′，源仍是 A′；记下请求记录与 `shell.log` 的位置，再起 B′（检查只在启动时与每 24 小时做一次，换源后不重起就看不到新的检查）；
  - 这次启动之后的 `shell.log` 有一条 `desktop.update.checked`，远端版本 A′、结论“更低”；请求记录里没有补丁或完整包的请求；页面没有提示。
- **上一个正式版本到本次**（`latest/download` 上已有低于本次的正式桌面版本时跑；第一次发布跳过并注明）：
  - 下载上一版的 Setup，用正式标识安装；
  - 把装好的 `Resources\version.json` 里的更新源改成本机更新源，源里放本次的正式资产（本次正式构建时 Hutch 已从 GitHub 取上一版做了补丁）；
  - 跑场景 1 的步骤，核对状态根与作品不变、版本是本次；结束后卸载。
  - 改装好的 `version.json` 更新源是否被更新器接受，切片 4 在 pc-notype 上用 t10 留下的测试安装先验；不成立就回到开发者定这一条的做法。
- 测试包不进 Release。失败时 A′、B′ 的产物与更新源的请求记录随证据上传，保留 14 天。

为了让“检查过、结论是什么”可观察，`UpdateController` 在检查完成时写一条 info 诊断 `desktop.update.checked`，带远端版本与结论（没有更新、有更新、更低）。适配层把它写进 shell.log。

### 冒烟的证据

三个冒烟都写 `--evidence <目录>`，按变体分子目录（正式安装、便携、A′、B′、上一版）。工作流的收集步骤 `if: always()`，截图失败不影响原始错误：
- 失败的步骤名与退出码；
- 壳与服务端的完整日志（`logs\desktop\` 下全部，含 `server-output.log`、`unclean-stop.json`）；
- 安装的 `Resources\version.json` 与载荷清单；
- 通道根下的 `nbook-update-state.json` 与更新器的结果文件；
- 更新源的请求记录；
- 当时的进程列表（路径、PID）；
- WebView 页面本身的截图（不截屏幕）。

证据作为作业产物上传，保留 14 天。

### `src/desktop/update.ts`：检查完成的诊断

`#check` 成功判定后 `report` 一条 `desktop.update.checked`，不改行为。`update.test.ts` 在现有“只升不降”的用例里断言这条诊断的结论。

### `.github/workflows/ci.yml`：可复用

- 加 `on.workflow_call`，输入 `all`（布尔，缺省假）。为真时选包直接用 `--all`。发布用它，不靠 `github.event.before` 的形状（被调用时 `github` 上下文是调用方的；改指的标签 `before` 不是全零）。
- `concurrency` 的组名加上调用来源：`ci-${{ github.workflow }}-…`。否则与 master 上同一提交的 CI 同组排队。
- 不改作业内容。

### `.github/workflows/release.yml`（新增）

- 触发：`push: tags: ['v*']`；`workflow_dispatch` 只做演练（`dry-run`），跳过所有远端写入的作业。
- `concurrency`：正式发布 `{group: release, queue: max}`（缺省的 `queue: single` 只留一个等待中的，新来的会把旧的等待中的取消；`max` 至多 100 个、先进先出）。演练另一个组 `release-dry-run`，不占正式发布的队列。actionlint 若还不认 `queue`，按它的版本处理（升级或注明）。
- `permissions` 按作业给：缺省 `contents: read`；发 npm 的作业 `id-token: write`；发 Release 的作业 `contents: write`。
- 每个作业自己装要用的运行时：`oven-sh/setup-bun`（版本与 ci.yml 一致）、`bun install --frozen-lockfile`；Windows 作业另装 Hutch，版本从 `desktop/` 下一处可机读的地方读（切片 5 定：`hutch.config.ts` 现在只固定了 Electrobun 2.0.6，没有 Hutch 的版本），装后核对 `hutch --version`。
- 产物都显式 `retention-days: 35`（覆盖 GitHub 首次运行后 30 天的可重跑期）；失败证据 14 天。

作业按顺序：

1. `gate`（ubuntu）：
   - `fetch-depth: 0`；
   - 新建标签的检查（见 `tag.ts` 一节）；
   - `bun scripts/release/tag.ts $GITHUB_REF_NAME`，输出版本；
   - 演练时用 `package.json` 的版本，不核对标签。
2. `ci`：`uses: ./.github/workflows/ci.yml`，`with: {all: true}`，`needs: gate`。
3. `npm-packages`（ubuntu，`needs: gate`）：
   - `release:smoke`；
   - `publish.ts --plan` 写 `release-plan.json`；
   - `build.ts <清单> --os win32 --cpu x64`；
   - 上传 `npm-packages`（`dist/release/`）与 `desktop-official`（`bundle/`、`payload/`）。
4. `update-test-packages`（ubuntu，`needs: gate`）：按“构建分工”做 B′，上传 `desktop-bplus`。只供冒烟，不发布。
5. `desktop`（windows-2025，`needs: [npm-packages, update-test-packages]`）：
   - 下载 `desktop-official`、`desktop-bplus`；
   - 正式变体：核对版本、构建、复制到 `release-assets/`、打便携 zip（`build/stable-win-x64/NeuroBook/` 的内容加 `NeuroBook.portable`）、`SHA256SUMS`；
   - `smoke-windows.ts` 跑安装版，再跑便携版；
   - A′、B′ 构建，`smoke-update.ts`；
   - 上传 `desktop-assets`（`release-assets/`）；收集并上传证据（`always()`）。
6. `publish-npm`（ubuntu，`needs: [ci, desktop]`，非演练，`environment: release`）：
   - Node 与 npm 升到下限以上并核对版本；
   - `publish.ts --ci --yes`，读下载的 `npm-packages`。
7. `registry-smoke`（ubuntu，`needs: publish-npm`）：标签提交上 `release:smoke --from registry`；registry 刚发的版本可能要一会儿才装得到，读不到时重试几次再判失败。结果写进作业摘要。不挡 GitHub Release：npm 上的字节已经定了，桌面包不受它影响。
8. `github-release`（ubuntu，`needs: publish-npm`，非演练）：`github-release.ts draft`，然后 `publish`。
9. `verify-feed`（ubuntu，`needs: github-release`）：`verify-update-feed.ts`，按它自己重读的最新身份分支；上传 `feed-evidence.json`。

### 失败与重跑

- **重跑失败的作业**（同一轮）：成功作业的产物与输出照旧可用，不重新构建；`publish-npm` 跳过已发而字节相同的包，`github-release` 只补缺的资产、已公开的只核对，`verify-feed` 重读当前最新身份。
- **整轮重跑**：重新构建。若第一轮已经发了本次版本的应用包或 SDK，而这次打出来的字节不同，`--plan` 失败，不会出现“npm 上是第一轮的、桌面包是第二轮的”。字节相同（打包可复现）时照常走完。
- **恢复不了**（产物过了保留期或被删，而 npm 已发、Release 没有公开）：流水线不自动重建替换。按 `release-plan.json` 与 registry 只读对账，处置是提高补丁号、重打标签发一个新版本；没公开的草稿由开发者删掉。
- 这些写进 `repository-workflow.md`。

Hutch 设了 `HTTPS_PROXY` 时下载必失败，runner 上没有代理，不处理。

### 一次性准备（开发者做，写进 `repository-workflow.md`）

- `nb-flock` 首发（npm 要包已经存在才能配置信任）。
- 标签规则集：`v*` 标签只允许开发者创建，禁止改指与删除。没有它，有仓库写权限的人推一个 `v*` 标签就能发布。
- `release` Environment：部署只允许 `v*` 标签；可选加人工批准。npm 的信任绑定这个 Environment，OIDC 的主体随之是 Environment 形式。
- npm 上每个包配置信任：仓库、`release.yml`、Environment `release`，允许的动作勾上直接发布 `npm publish`（2026-09-03 之后新建的配置缺省只允许 `npm stage publish`）。
- 新建的信任配置要在 2 天内完成第一次成功发布，否则过期、要删了重建。所以只在这个包有版本要发的那次发布前 2 天内配置：
  - 第一次发布：这次要发的包；
  - 之后：哪个包第一次经流水线发布，就在打标签前给它配上。
  - 演练会列出“这次要发、在流水线上还没发过”的包，提醒先配。
- 在 master 上 `workflow_dispatch` 演练一次，打第一个标签。

### 文档

- `docs/standards/repository-workflow.md` 的“发布授权”与“npm 包”两节改写：
  - 打标签即发布；
  - 一次性准备（上一节）；
  - 失败与重跑（上一节）；
  - 本机手工发布作为备用入口保留；
  - 去掉“GitHub Releases 只留旧应用历史版本”。
- `packages/neuro-book/desktop/README.md`：CI 怎么构建与冒烟、三个变体。
- 两份 Spec 的“证据”里写 Smoke 的入口与第一次运行的链接；第一次运行之前写“未运行”。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/runtime/desktop-update.md` | 证据加 Smoke 入口；Smoke 的要求不改 |
| `docs/specs/runtime/desktop-shell.md` | 证据的 Smoke 一条改成入口与运行记录 |
| `docs/standards/repository-workflow.md` | 见上 |
| `docs/proposals/desktop-distribution.md` | 只追加决策记录（npm 历史标签名、整轮重跑字节不同就失败），正文不动 |

## 切片

1. **CDP 探针**（pc-notype，不提交产品代码；2026-11-14 已做，选型成立，[cdp-probe-r1.txt](evidences/cdp-probe-r1.txt)）。
2. **门禁与发布脚本**：`tag.ts`、`publish.ts` 的 `--plan` 与 `--ci`、`github-release.ts`、`verify-update-feed.ts`、单测。验证：`bun test scripts/release`、`bunx tsc -p scripts`（按 scripts 的 tsconfig）、`governance:check`。另加一条只读的端到端检查：只有源码检出与下载的 `dist/release/`、没有生成目录时，`publish.ts --ci` 走到“要发哪些”为止不出错（不真的发）。
3. **检查完成的诊断**：`update.ts` 与适配层的一行日志。验证：`bun test src/desktop`。
4. **Windows 冒烟脚本**：`smoke-windows.ts`、`smoke-update.ts`。在 pc-notype 上用本分支做的三个变体跑：
   - 先验两件前提：复制一份 `desktop/` 单独构建；改装好的 `version.json` 更新源被更新器接受（用 t10 留下的测试安装）；
   - 安装版、便携版：测试应用标识，`--state-root` 放 `%USERPROFILE%\nb-w00046\t11\` 下，不碰缺省状态根；
   - 更新冒烟：测试应用标识，用缺省状态根（与 t10 相同，开发者当时定直接用已有的 `%LOCALAPPDATA%\NeuroBook`；记进待确认清单）。冒烟建的作品在结束时经应用移出书架；前后对照顶层清单与 `projects.json`；
   - 证据 `evidences/windows-smoke-r1.txt`；顺带重跑 t10 没在 Windows 上重跑的相对路径与无盘符路径的拒绝。
5. **工作流**：`ci.yml` 可复用、`release.yml`。验证：`actionlint`；本机按作业顺序把各脚本串一遍，用演练参数，不写远端。
6. **文档**：repository-workflow、README、Spec 证据、提案的决策记录。

之后停下交开发者：push 分支、合入 master，以及“一次性准备”一节的各项。

## 验收映射

| 编号 | 覆盖 |
|---|---|
| 提案 4.8 门禁（标签、版本、祖先、新建标签） | `tag.test.ts`；release.yml `gate` |
| 提案 4.8 构建与冒烟 | `npm-packages` 作业（`release:smoke`）；`desktop` 作业（`smoke-windows.ts`、`smoke-update.ts`）；切片 4 的 pc-notype 运行 |
| 提案 4.8 发布 npm（同一批、摘要、OIDC、latest 不回拨） | `publish.test.ts` 的 `distTagFor`、`planProblems`；切片 2 的只读端到端检查；第一次真实运行 |
| 发布后 registry 核对 | `registry-smoke` 作业 |
| 提案 4.8 Release（草稿、只补缺、摘要、最新） | `github-release.test.ts`；第一次真实运行 |
| desktop-shell 的 Smoke | `smoke-windows.ts` |
| desktop-update 的 Smoke 场景 1、2，上一版到本次 | `smoke-update.ts` |
| t10 交下来的发布完成门禁 | `verify-update-feed.ts`；`verify-feed` 作业与 `feed-evidence.json` |

## 验证

- 本机：`bun test scripts/release`、`bun test src/desktop`、类型检查、`governance:check`、`actionlint`。
- pc-notype：切片 1 的探针，切片 4 的前提与三个冒烟；只读 UI 自动化的文字与 WebView 页面本身的截图，不按屏幕区域截图。
- 不跑 e2e：页面代码只有 `update.ts` 的一条诊断，没有页面改动。
- 未验证、要等第一次真实运行的：
  - GitHub runner 上 `connectOverCDP` 是否同样可用（t01 证明窗口能起、能关）；
  - trusted publishing 与 Environment 形式的 OIDC 主体；
  - 重跑失败的作业时，下载得到前一次尝试的产物；
  - `latest/download` 的重定向。

## 不做与风险

- 不做 macOS、Linux 桌面包；不签名。
- 不做发布说明的自动生成（`--generate-notes` 列的是提交，对用户没用）；说明用模板。
- 风险：
  - runner 上 Setup 不退出、WebView2 的远程调试端口被策略关掉。切片 1 先在 pc-notype 上探；CI 里失败时作业失败、不发布，证据照常上传。
  - npm 与 GitHub 不是一个事务：可能出现“npm 已发、Release 没建”。处置见“失败与重跑”。
  - 演练模式与真实发布在门禁上的差别（不核对标签）只在 `gate` 一步，用 `tag.test.ts` 覆盖真实规则。
  - 补发旧版本时，Hutch 从 `latest/download` 取的“上一版”是更高的版本，补丁没用但无害。这样的 Release 不设为最新，已装用户不会从它取更新。
  - 正式发布排队靠 `queue: max`，串行顺序不是版本顺序；`latest` 的判断在公开那一刻重读，不依赖顺序。
