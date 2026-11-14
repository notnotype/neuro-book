# t11 打标签自动发布流水线：实施计划

## Context

打 `v<产品版本>` 标签后，GitHub Actions 依次门禁、构建与冒烟、发 npm、发 GitHub Release。依据：[桌面发行提案](../../../../../docs/proposals/desktop-distribution.md) 的 4.5、4.8 与第五节的“发布”“回滚”，以及 [ADR 0051](../../../../../docs/adr/0051-desktop-shell-electrobun-tag-release.md) 决定 7。还要兑现下面这些里写着“发布流水线的 Windows 作业”的 Smoke：

- [`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md)：安装版与便携版各跑一遍；
- [`runtime/desktop-update`](../../../../../docs/specs/runtime/desktop-update.md)：场景 1、2；
- t10 计划“验证”一节交下来的发布完成门禁（更新器的取法、两种查询串，见 t10 [windows-update-r1.txt](../t10-auto-update/evidences/windows-update-r1.txt)）。

已定的决定：
- 开发者 2026-11-13 定打 `v*` 标签后全自动发布；流水线上线前由开发者确认；push、打标签、配置 Secrets 与 Environment、npm 上配置信任，都是开发者逐次授权或亲自操作。
- 不签名（提案 4.5）。
- 只升不降，不往回拨“最新”（提案 4.8）。

工作方式：autonomous-delivery。本地能做完的切片（脚本、单测、pc-notype 上的 Windows 实测、工作流文件的静态检查）先做完。到 push 与第一次在 GitHub 上运行时停下，交开发者。

现有发布链：
- `release:smoke`：`scripts/release/pack-smoke.ts`，打 12 个包、在 `dist/release/` 写 `release-manifest.json`，含提交与每个 tarball 的 SHA-256；
- `release:publish`：`scripts/release/publish.ts`，本机门禁加 `bun publish`；
- 应用包与桌面载荷：`packages/neuro-book/desktop/scripts/build.ts`，读发布清单组装 `payload/`；
- Hutch 构建：Windows 上 `hutch electrobun build --env=stable`，产物在 `desktop/artifacts/`：
  - `win-x64-NeuroBook-Setup.zip`；
  - `stable-win-x64-NeuroBook.tar.zst`；
  - `stable-win-x64-update.json`、`-update-v2.json`；
  - 有上一版时还有 `stable-win-x64-<上一版哈希>.patch`。
  - Hutch 从 `release.baseUrl` 取上一版做补丁，没有上一版时打印 “no previous release found; skipping delta patch”。这是 t10 实测。

GitHub windows runner 上已经实测过（t01 [windows-runner-probe-r1.txt](../t01-distribution-proposal/evidences/windows-runner-probe-r1.txt)）：
- 构建约 85 秒；
- Setup 能无人值守安装，但 Setup 进程装完不一定退出；
- 直接起 `app\bin\launcher.exe`，`WM_CLOSE` 后有序停止；
- 卸载 `uninstall.exe --uninstall --quiet --delete-data`。

## 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 驱动 Windows 上装好的应用的页面 | Playwright `chromium.connectOverCDP`，壳启动时设 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<端口>` | 仓库已有 Playwright 与 e2e 的定位写法，能断言页面里看得到的东西。否决 UI 自动化读文字：能看到文字，但点击与等待靠轮询，CI 上难稳定。否决只查服务端 HTTP：验不到页面与关闭前询问 |
| 不调真实模型跑一条 Agent 命令 | `src/plugins/agent/testing/endpoint.ts` 的 `fakeEndpoint` 与 `localModelSettings`，脚本回一次 `bash` 工具调用 | e2e 已在用这个本机 OpenAI 兼容端点；它只在仓库检出里，不进安装包 |
| 关窗 | `user32` 的 `PostMessageW(WM_CLOSE)`，用 `bun:ffi` 调 | 与用户点关闭走同一条路（关闭前询问、有序停止）；切片 1 实测过（[cdp-probe-r1.txt](evidences/cdp-probe-r1.txt)），窗口枚举要在登录的桌面会话里跑 |
| GitHub Release 与资产 | `gh` CLI（runner 自带），由 `scripts/release/github-release.ts` 调用 | 资产列表带 `digest`，能核对同名资产的摘要。否决第三方 Action：多一份要固定版本、要审查的依赖 |
| npm 发布 | npm CLI 11.5.1 以上，trusted publishing（OIDC） | 提案 4.8 已定 |
| 工作流静态检查 | `actionlint`（本机用 `bunx` 或下载的二进制跑，不进依赖） | 在 push 之前抓住表达式与 `needs` 的错 |

## 关键设计

### `scripts/release/tag.ts`（新增）：标签与版本门禁

`checkReleaseTag({tag, repository}) → {version} | 抛 GateFailure`。规则：

- 标签是 `v<稳定的语义化版本>`，带预发布段的拒绝；
- 去掉 `v` 后等于 `packages/neuro-book/package.json` 的 `version` 与 `PRODUCT_VERSION`（读 `src/shared/product.ts`，与 `product.test.ts` 同一个读法）；
- 标签提交是 `origin/master` 的祖先（`git merge-base --is-ancestor`）。

构建后的核对另由 `verifyBuiltVersions(manifest, version)` 做：发布清单里应用包与 SDK 包的版本、`desktop/bundle/version.json` 的版本都等于标签版本。命令行入口 `bun scripts/release/tag.ts <标签>`，打印版本给工作流的 `GITHUB_OUTPUT`。单测 `tag.test.ts` 用临时 Git 仓库。

### `scripts/release/publish.ts`：CI 入口

加 `--ci` 模式，本机模式的门禁不变。CI 模式：

- 不跑 `npm whoami`，不要求分支叫 master（标签检出是分离的 HEAD）；
- 改核对清单的 `commit` 等于 `GITHUB_SHA`，且它在 `origin/master` 上；
- 用 `npm publish <tarball> --access public`，不用 `bun publish`（trusted publishing 只认 npm CLI，provenance 由它自动生成）。

冻结要发的集合：
- 新增 `release-plan.json`，与清单放在一起，由构建作业在 `release:smoke` 之后写（`bun scripts/release/publish.ts --plan`）。
- 它记下当时 npm 上还没有这个版本的包，按发布顺序；
- 之后的第一次发布与每次重跑都只认这份：
  - 计划里的包：已发而 `dist.integrity` 相同就跳过；已发而不同就失败；没发就发。
  - 计划外的包：沿用现有规则（`blockingStalePackages`：被要发的包依赖才阻断，否则提醒）。

不往回拨 `latest`：
- 每个包发之前读 `npm view <名> dist-tags.latest`；
- 包从没发过（E404），或本次版本高于它，就不带 `--tag`；
- 否则带 `--tag history`；
- 读不到（网络、5xx）就停。

纯函数 `distTagFor(version, latest)`、`planProblems(plan, registryState)` 放进 `publish.ts`，单测加进 `publish.test.ts`。

### `scripts/release/github-release.ts`（新增）：草稿、资产、公开

命令：

- `draft <版本> <资产目录>`：
  - 没有这个标签的 Release 时建草稿：`gh release create v<版本> --draft --verify-tag --notes-file <说明>`；
  - 只上传缺的资产；
  - 同名资产的 `digest` 与本地 SHA-256 不同就失败；
  - 已经公开的 Release 只做核对、不上传。
- `publish <版本>`：
  - 核对资产齐全、摘要一致；
  - 读当前最新 Release 的标签（`gh release view --json tagName`，可能是旧应用的 0.10.x），本次版本更高才 `--latest`，否则 `--latest=false`；
  - 然后 `--draft=false`。

资产（`SHA256SUMS` 覆盖其余全部）：
- `win-x64-NeuroBook-Setup.zip`；
- `NeuroBook-<版本>-win-x64-portable.zip`；
- `stable-win-x64-NeuroBook.tar.zst`；
- `stable-win-x64-update.json`、`stable-win-x64-update-v2.json`；
- 有补丁时 `stable-win-x64-<哈希>.patch`；
- `SHA256SUMS`。

说明模板 `scripts/release/desktop-release-notes.md`：下载哪个文件、SmartScreen 的“仍要运行”、便携版不自动更新、回到旧版本先备份。

`gh` 的调用经一个注入的 `run` 端口，单测用记录调用的替身，核对调用与判断。替身的输入形状照 `gh release view --json assets` 的真实输出，第一次真实运行时对一次。

### `scripts/release/verify-update-feed.ts`（新增）：发布完成门禁

照更新器的取法，对 `https://github.com/notnotype/neuro-book/releases/latest/download/` 各发一次 GET：

- `stable-win-x64-update-v2.json?<16 位十六进制>`：内容里的版本与哈希等于本次；
- `stable-win-x64-NeuroBook.tar.zst?cache=<32 位>`、补丁（若有）`?cache=<32 位>`：长度与本地资产相同；
- 下一次构建 Hutch 要取的 `stable-win-x64-update.json?cache=<32 位>`。

跟随重定向至多 5 跳，都要 200。查询串的形状写成常量，注释链接 Electrobun 2.0.6 的出处与 t10 的请求日志。

### `packages/neuro-book/desktop/scripts/smoke-windows.ts`（新增）：安装版与便携版的冒烟

在 Windows 上用 Bun 运行，参数 `--setup <Setup.zip> | --portable <zip>`。步骤：

1. **准备**：
   - 状态根用缺省的 `%LOCALAPPDATA%\NeuroBook`（runner 是干净机器；便携版用程序目录下的 `data\`）；
   - 起 `fakeEndpoint`，在状态根写 `settings.json`（`localModelSettings`）；
   - 在仓库外的临时目录建一部作品，登记进 `projects.json`。
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
   - 端点回 `bash` 工具调用 `echo nb-smoke-<随机串>`，再回一句结束；
   - 页面里出现这个输出，端点记到的第二个请求里有它。
5. **关窗**：
   - 对产品窗口 `WM_CLOSE`（窗口句柄按进程号枚举）；
   - 关闭前询问以 `quit` 同意（没有未保存的内容与在跑的工作）；
   - 壳进程以 0 退出，至多 90 秒；
   - `logs\desktop\shell.log` 末尾是 `exit 0`，没有“没有正常停止”的记录；
   - 没有残留的 `bun.exe` 子进程。
6. **卸载**（安装版）：`uninstall.exe --uninstall --quiet --delete-data`，安装目录与开始菜单快捷方式都不在。
7. **便携版另核对**：`data\` 在程序目录下；缺省状态根与 `%LOCALAPPDATA%\io.github.notnotype.neurobook\stable` 下没有建出状态文件。

每一步打印一行 `✓`，失败时打印步骤名、shell.log 末尾与页面截图（截的是 WebView 页面本身，不截屏幕），交给工作流作为失败产物上传。定位写法复用 e2e 里的数据属性，不另造。

### `packages/neuro-book/desktop/scripts/smoke-update.ts`（新增）：更新的冒烟

对应 desktop-update 的 Smoke：场景 1，与场景 2 的前半。流程：

- 同一条链另构建两个测试包，都用测试应用标识，都把 `NBOOK_UPDATE_BASE_URL` 指到本机端口：
  - A′ 是本次版本：载荷与正式包相同（同一份 `npm-packages` 产物），只是 Hutch 构建时的标识与更新源不同；
  - B′ 是补丁号加 1：壳拒绝版本不同的服务端，所以 B′ 的应用包也要按新版本从头打。
    在另一个 ubuntu 作业里做：改 `PRODUCT_VERSION` 与 `package.json` 的版本，`bun install` 刷新 `bun.lock`，然后 `release:smoke`。这是 t10 的做法，不刷新 bun.lock 时冒烟报不一致。版本只在作业的检出里改，不提交、不发布。
- 本机静态更新源与 t10 的 `t10-serve.ts` 同一种写法，记请求。先构建 A′、放进更新源、起服务，再构建 B′：Hutch 构建 B′ 时从更新源取 A′ 生成补丁。
- 场景 1：
  - 装 A′、源放 B′：页面出现“可以更新”，点“下载”，等到“已下载”；
  - 关窗后再起：等到 B′ 的页面与“已更新到”；
  - 请求日志里取的是补丁。
- 场景 2 前半：B′ 上源放 A′，等过一次检查：没有提示、没有下载请求。
- 测试包不上传、不发布。

后半（已下载 C 后源换回 B）要第三个包，冒烟里不做，记进待确认清单；t10 的 Windows 实测已经覆盖。

为了让“等过一次检查”可观察，`UpdateController` 在检查完成时写一条 info 诊断 `desktop.update.checked`，带远端版本与结论（没有更新、有更新、更低）。适配层把它写进 shell.log。这条也供发布后的门禁用。

### `src/desktop/update.ts`：检查完成的诊断

`#check` 成功判定后 `report` 一条 `desktop.update.checked`，不改行为。`update.test.ts` 在现有“只升不降”的用例里断言这条诊断的结论。

### `.github/workflows/ci.yml`：可复用

- 加 `on.workflow_call`。
- 被调用时 `github.event_name` 是调用方的 `push`（标签），`github.event.before` 是全零，选包落到 `--all`：标签提交上跑全部检查，正是要的。
- `concurrency` 的组名加上调用来源：`ci-${{ github.workflow }}-…`。否则与 master 上同一提交的 CI 同组排队。
- 不改作业内容。

### `.github/workflows/release.yml`（新增）

- 触发：`push: tags: ['v*']`；`workflow_dispatch` 只做演练（`dry-run`），跳过所有远端写入的作业。
- `concurrency: {group: release, cancel-in-progress: false}`。
- `permissions` 按作业给：缺省 `contents: read`；发 npm 的作业 `id-token: write`；发 Release 的作业 `contents: write`。

作业按顺序：

1. `gate`（ubuntu）：
   - `fetch-depth: 0`；
   - `bun scripts/release/tag.ts $GITHUB_REF_NAME`，输出版本；
   - 演练时用 `package.json` 的版本，不核对标签。
2. `ci`：`uses: ./.github/workflows/ci.yml`，`needs: gate`。
3. `npm-packages`（ubuntu，`needs: gate`）：
   - `bun install --frozen-lockfile`；
   - `release:smoke`；
   - `publish.ts --plan` 写 `release-plan.json`；
   - 上传 `dist/release/` 为产物 `npm-packages`。
4. `update-test-packages`（ubuntu，`needs: gate`）：按上面 B′ 的做法打一份补丁号加 1 的 `dist/release/`，上传为产物 `update-test-packages`。只供冒烟，不发布。
5. `desktop`（windows-2025，`needs: [npm-packages, update-test-packages]`）：
   - 下载 `npm-packages`；
   - `bun desktop/scripts/build.ts <清单>`；
   - 核对 `verifyBuiltVersions`；
   - 装固定版本的 Hutch，`hutch install`、`hutch electrobun build --env=stable`；
   - 打便携 zip：`build/stable-win-x64/NeuroBook/` 的内容加 `NeuroBook.portable`；
   - `SHA256SUMS`；
   - `smoke-windows.ts` 跑安装版与便携版；
   - 用测试标识与本机更新源再做两次 Hutch 构建（A′ 用 `npm-packages`，B′ 用 `update-test-packages`），`smoke-update.ts` 跑一遍；
   - 上传 `desktop-assets`；失败时上传失败产物。
6. `publish-npm`（ubuntu，`needs: [ci, desktop]`，非演练，`environment: release`）：
   - npm 升到 11.5.1 以上；
   - `publish.ts --ci --yes`，读下载的 `npm-packages` 产物。
7. `github-release`（ubuntu，`needs: publish-npm`）：`github-release.ts draft`，然后 `publish`。
8. `verify-feed`（ubuntu，`needs: github-release`）：
   - 本次被设为最新时跑 `verify-update-feed.ts`；
   - 没设为最新（补发的旧版本）时跳过并注明。

重跑：
- 失败后用 GitHub 的“重跑失败的作业”，前面成功作业的产物照旧可用，不重新构建；
- 整轮重跑会重新构建，字节不同时被 `release-plan.json` 的摘要核对与 Release 的同名摘要核对拦下。
- 这条写进 `repository-workflow.md`。

Hutch 设了 `HTTPS_PROXY` 时下载必失败，runner 上没有代理，不处理；固定版本写在 `desktop/hutch.config.ts`，工作流读它，不另写一份。

### 文档

- `docs/standards/repository-workflow.md` 的“发布授权”与“npm 包”两节改写：
  - 打标签即发布；
  - 一次性准备（开发者做）；
  - 失败与重跑；
  - 本机手工发布作为备用入口保留；
  - 去掉“GitHub Releases 只留旧应用历史版本”。
- `packages/neuro-book/desktop/README.md`：CI 怎么构建与冒烟。
- 两份 Spec 的“证据”里写 Smoke 的入口与第一次运行的链接；第一次运行之前写“未运行”。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/runtime/desktop-update.md` | Smoke 一句改成场景 1 与场景 2 的前半（后半由手工实测覆盖）；证据加 Smoke 入口 |
| `docs/specs/runtime/desktop-shell.md` | 证据的 Smoke 一条改成入口与运行记录 |
| `docs/standards/repository-workflow.md` | 见上 |
| `docs/proposals/desktop-distribution.md` | 只追加决策记录（npm 历史标签名、更新冒烟的范围），正文不动 |

## 切片

1. **CDP 探针**（pc-notype，不提交产品代码；2026-11-14 已做，选型成立，[cdp-probe-r1.txt](evidences/cdp-probe-r1.txt)）：
   - 装 t10 的测试包，设 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 起应用；
   - 从 pc-notype 本机用 Playwright `connectOverCDP` 连上，读到书架页；
   - `bun:ffi` 的 `WM_CLOSE` 能触发关闭前询问。
   - 不成立就停下改选型（退回 UI 自动化读文字），先改本计划。
   - 证据 `evidences/cdp-probe-r1.txt`。
2. **门禁与发布脚本**：`tag.ts`、`publish.ts` 的 CI 模式与发布计划、`github-release.ts`、`verify-update-feed.ts`、单测。验证：`bun test scripts/release`、`bunx tsc -p scripts`（按 scripts 的 tsconfig）、`governance:check`。
3. **检查完成的诊断**：`update.ts` 与适配层的一行日志。验证：`bun test src/desktop`。
4. **Windows 冒烟脚本**：`smoke-windows.ts`、`smoke-update.ts`。验证：在 pc-notype 上用本分支构建的包跑安装版、便携版与更新冒烟。用测试应用标识与另一个状态根，不碰缺省状态根：脚本收 `--identifier` 与 `--state-root`，CI 用缺省。证据 `evidences/windows-smoke-r1.txt`。
5. **工作流**：`ci.yml` 可复用、`release.yml`。验证：`actionlint`；本机按作业顺序把各脚本串一遍，用演练参数，不写远端。
6. **文档**：repository-workflow、README、Spec 证据、提案的决策记录。

之后停下交开发者，需要开发者授权或亲自操作的事：

- push 分支、合入 master；
- `nb-flock` 首发；
- 12 个包在 npm 上配置信任这个工作流；
- 建 `release` Environment（可选加人工批准）；
- 在 master 上 `workflow_dispatch` 演练一次；
- 打第一个标签。

## 验收映射

| 编号 | 覆盖 |
|---|---|
| 提案 4.8 门禁（标签、版本、祖先） | `tag.test.ts`；release.yml `gate` |
| 提案 4.8 构建与冒烟 | `npm-packages` 作业（`release:smoke`）；`desktop` 作业（`smoke-windows.ts`、`smoke-update.ts`）；切片 4 的 pc-notype 运行 |
| 提案 4.8 发布 npm（同一批、摘要、OIDC、latest 不回拨） | `publish.test.ts` 的 `distTagFor`、`planProblems`；第一次真实运行 |
| 提案 4.8 Release（草稿、只补缺、摘要、最新） | `github-release.test.ts`；第一次真实运行 |
| desktop-shell 的 Smoke | `smoke-windows.ts` |
| desktop-update 的 Smoke 场景 1、2 前半 | `smoke-update.ts` |
| t10 交下来的发布完成门禁 | `verify-update-feed.ts`；`verify-feed` 作业 |

## 验证

- 本机：`bun test scripts/release`、`bun test src/desktop`、类型检查、`governance:check`、`actionlint`。
- pc-notype：
  - 切片 1 的探针，切片 4 的三个冒烟；
  - 用测试应用标识，状态根放 `%USERPROFILE%\nb-w00046\t11\`，不碰缺省状态根；
  - 只读 UI 自动化的文字与 WebView 页面本身的截图，不按屏幕区域截图。
- 不跑 e2e：页面代码只有 `update.ts` 的一条诊断，没有页面改动。
- 未验证、要等第一次真实运行的：
  - GitHub runner 上 `connectOverCDP` 是否同样可用（t01 证明窗口能起、能关）；
  - trusted publishing；
  - `gh` 的资产 `digest` 字段；
  - `latest/download` 的重定向。

## 不做与风险

- 不做 macOS、Linux 桌面包；不签名。
- 不做发布说明的自动生成（`--generate-notes` 列的是提交，对用户没用）；说明用模板。
- 风险：
  - runner 上 Setup 不退出、WebView2 的远程调试端口被策略关掉。切片 1 先在 pc-notype 上探；CI 里失败时作业失败、不发布，冒烟留下 shell.log 与页面截图。
  - npm 与 GitHub 不是一个事务：可能出现“npm 已发、Release 没建”。靠重跑失败的作业补齐，`release-plan.json` 与 Release 的摘要核对兜底。
  - 演练模式与真实发布在门禁上的差别（不核对标签）只在 `gate` 一步，用 `tag.test.ts` 覆盖真实规则。
  - 补发旧版本时，Hutch 从 `latest/download` 取的“上一版”是更高的版本，补丁没用但无害。这样的 Release 不设为最新，已装用户不会从它取更新。
