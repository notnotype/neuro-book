# 发布手册

怎么发一个 NeuroBook 版本：阶段与版本号、变更记录、发版、流水线、失败与重跑、本机发布。谁能发、哪些动作要授权见 [`repository-workflow.md` 的“发布授权”](repository-workflow.md#发布授权)；取舍的理由在 [ADR 0029](../adr/0029-workspace-packages-publish-source-to-npm.md)（源码包）、[ADR 0033](../adr/0033-app-delivered-as-built-npm-package.md)（应用包）、[ADR 0051](../adr/0051-desktop-shell-electrobun-tag-release.md)（桌面版与打标签发布）、[ADR 0053](../adr/0053-release-stages-and-changelog.md)（阶段与变更记录）。

发布渠道是 npm 与 GitHub Release。推 `v<版本>` 标签就发布：流水线 `.github/workflows/release.yml` 在标签提交上做门禁、跑 CI、构建与冒烟，都通过才发 npm、建 Release、核对自动更新的取法。打标签本身就是发布授权，只由开发者做。

## 阶段与版本

- 阶段：canary（早期验证版：功能能用，未必经过完整的人工验收）→ preview（预览版，也叫测试版：新功能的预览）→ stable（稳定版）。写在 `packages/neuro-book/src/shared/product.ts` 的 `PRODUCT_STAGE`，随提版一起改。现在是 canary。
- 版本号是纯数字的三段，不带阶段。产品版本（应用、桌面版与插件 SDK 共用）写在两处：`packages/neuro-book/package.json` 与 `PRODUCT_VERSION`（`product.test` 核对两处一致）。
- 十个源码包（nb-story 与它依赖的包、nb-flock）各有自己的版本，手工提：改它的 `package.json` 并提交；提了版本号就是“这个包这次发”。依赖它、又要用到新接口的包一起提；内部依赖写 `workspace:^`，发布时改写成 `^<版本>`。
- 第一个稳定版之前只有一条线：每次发布都设为 GitHub 的最新，已装的桌面版跟着自动更新；npm 只发 `latest`（比当前 `latest` 低的补发版本发到 `history`）。门禁拒绝 `stable`；第一个稳定版要先按 ADR 0053 决定 6 实现支线。

## 写变更记录

- 应用、桌面版与 SDK 共用 `packages/neuro-book/CHANGELOG.md`；源码包各一份 `packages/<包>/CHANGELOG.md`，在它下一次提版时建（复制应用那份的开头与 `## [Unreleased]`）。
- 改了要发布的包里用户看得到的行为，在同一个提交里往 `## [Unreleased]` 下补一条。应用用户看得到的写在应用的记录里，哪怕改在库里；库的记录写给直接用这个包的人（插件作者、nb-story 用户）。
- 分类，按这个次序：`### 不兼容的改动`、`### 新增`、`### 改动`、`### 修复`、`### 移除`；应用另有 `### 数据与升级`（数据格式变了、要迁移、不能再降级），Release 说明把它放在最前。别的分类名解析时报错。
- 条目一行，写用户看到的或能做的事，不写实现过程（那是提交说明的事）。来自 issue 的带链接：`修好了 X（[#12](https://github.com/notnotype/neuro-book/issues/12)）`；外部贡献加上贡献者：`新增 Y（[#34](https://github.com/notnotype/neuro-book/pull/34) by [@名字](https://github.com/名字)）`。一条写不下时下一行缩进两格接着写。
- 已经发布的段落（`## [0.13.0] - 2026-11-15`）不再改。
- 变更记录不进 npm 包：npm 页面的 README 有仓库链接，Release 说明链到标签下的记录。

## 发版

1. 源码包要发的，先各自提版、补好它的 `[Unreleased]`，合入 master。
2. 这一版插件能用的接口（SDK 的公开面、内置插件导出的服务与合同、宿主共享给插件的模块）有不兼容的改动时，把 `packages/neuro-book/src/shared/product.ts` 的 `PLUGIN_API_SINCE` 改成这次的版本，并在应用记录的 `### 不兼容的改动` 写一条，合入 master；没有就不动它，已经构建的插件在新版本上照样能装（[`runtime/plugin-api.md`](../specs/runtime/plugin-api.md) 的“兼容”）。
3. 在主工作区的 master 上（与 origin 同步）：`bun run release:prepare <版本> [--stage canary|preview]`。它先只读检查：在 master、包含 `origin/master`、会发布的目录与 `bun.lock` 干净、版本更高、应用的 `[Unreleased]` 有条目、与上一个桌面版本（与门禁同一来源：GitHub 上低于本次、有安装包的最高稳定版本，要本机的 `gh` 已登录）相比提了版本的源码包有记录且有条目、没有降版本的；全部通过才改两处产品版本与阶段、把这些记录的 `[Unreleased]` 定稿成 `[<各自的版本>] - <今天>`、刷新 `bun.lock`，提交 `release: v<版本>`；写入之后任何一步失败都把这些文件还原、不提交。版本没提而 `[Unreleased]` 有条目的源码包留到它下次提版，只打一行提示。
4. 推 master（README 的图片用 GitHub 上的地址，没推送时 npm 页面看不到）。
5. 开发者在这个提交上打标签并推送：`git tag v<版本> && git push origin v<版本>`。

## 流水线

按顺序：

- `gate`：这次推送是新建标签（改指、删除都不发布）；标签版本等于源码两处版本、指向检出的提交、在 `origin/master` 上；阶段不是 `stable`；定下上一个桌面版本（Release 历史里低于本次、有安装包的最高稳定版本）；由应用的变更记录生成 Release 说明（要有本次版本的段、`[Unreleased]` 为空、提了版本的源码包有段），存成工件 `release-notes`，也写进作业摘要。
- `ci`：同一提交上整套 CI（`ci.yml`，选包用 `--all`）。
- `npm-packages`：`release:smoke`、发布计划（`publish.ts --plan`）、正式桌面变体的壳与载荷。
- `update-test-packages`：更新冒烟用的 B′（标签提交加一个只在 runner 上的测试提交，补丁号加 1）。
- `desktop`（Windows）：用 Hutch 构建正式、A′、B′ 三个变体；冻结发布资产：安装包改名为 `NeuroBook-win-x64-Setup.zip`、从完整包打便携版 `NeuroBook-win-x64-portable.zip`、写 `SHA256SUMS`；跑安装版、便携版与更新的冒烟。两个名字不带版本号，`releases/latest/download/<名>` 是固定的最新版链接；更新用的文件名由 Electrobun 定（`stable-win-x64-…`，`stable` 是发布频道，不是阶段）。
- `publish-npm`（Environment `release`，trusted publishing）：只发计划里本次发布的包，dist-tag 显式给（高于 `latest` 时 `latest`，否则 `history`）。
- `registry-smoke`：先等本次的版本都能从 registry 取到（最多 30 分钟；刚发的版本 npm 要处理几分钟，大包更久），再装一遍（不挡 Release）。
- `github-release`：建草稿（标题 `NeuroBook <版本>（<阶段>）`，正文是 `gate` 生成的说明；草稿已在时换成这一轮的），只补缺的资产，公开；本次不低于当前最新时设为最新。
- `verify-feed`：按更新器的取法从 GitHub 取清单、完整包与补丁，核对与冻结的资产相同；失败时摘要写“发行没有完成，自动更新不可用”。
- `upgrade-from-previous`（有上一个桌面版本、本次是最新时）：装上一版的正式安装包（v0.13.0 叫 `win-x64-NeuroBook-Setup.zip`，按 `*Setup.zip` 取），从 GitHub 发现本次、下载、换上。

演练：在 Actions 里对 master 手动运行 Release（`workflow_dispatch`），用源码里的版本、不核对标签，跑到冒烟为止，不发 npm、不建 Release。说明照样生成并写进门禁的摘要，问题只警告（master 上 `[Unreleased]` 通常有条目）。版本已经发过时发布计划那一步报错、照常往下跑；它列出的“要发的包”就是打标签前要配好信任的名单。

## 一次性准备

- **新包首发**：npm 要包已经存在才能配置信任。从没发过的包先用下文“本机发布”首发（`nb-flock` 0.1.0 就是这样发的），之后再配信任、经流水线发。
- **标签规则集**：`v*` 标签只允许开发者创建，禁止改指与删除。没有它，有仓库写权限的人推一个 `v*` 标签就能发布。
- **Environment `release`**：部署只允许 `v*` 标签，可选加人工批准。npm 的信任绑定这个 Environment。
- **npm 信任**：每个要经流水线发布的包配置 trusted publishing：仓库、工作流 `release.yml`、Environment `release`，允许的动作勾上直接发布 `npm publish`（2026-09-03 之后新建的配置缺省只允许 `npm stage publish`）。新建的信任配置要在 2 天内有一次成功发布，否则过期、要删了重建：只在这个包有版本要发的那次发布前 2 天内配置。
- 在 master 上演练一次，再打第一个标签。

## 失败与重跑

- **重跑失败的作业**（同一轮）：成功作业的产物与输出照旧可用，不重新构建。`publish-npm` 跳过已发而字节相同的包；`github-release` 只补缺的资产，草稿的正文换成同一份说明，已公开的只核对；`verify-feed` 重读当前最新；`upgrade-from-previous` 用 `gate` 定下的同一个上一版。
- **说明生成失败**（`gate`）：还没有任何远端写入。按报出的问题补变更记录（通常是忘了 `release:prepare`，或定稿后又往 `[Unreleased]` 加了条目），提高补丁号重新发版；标签不能改指。
- **整轮重跑**（重新构建）：第一轮已经发出的本次发布的包（按 npm 上的发布时间晚于标签提交认出），这次打出来的字节不同时发布计划失败，不会出现 npm 上是第一轮、桌面包是第二轮的字节。字节相同时照常走完。
- **被取消**：正式发布按推送先后排队（`queue: max`，至多 100 个等待中的）；满了以后新来的被取消，在 Actions 里重跑那一轮即可，标签不用重推。
- **恢复不了**（产物过了保留期或被删，而 npm 已发、Release 没有公开）：流水线不自动重建替换。按 Release 草稿、`release-plan.json` 与 registry 只读对账，提高补丁号、重打标签发一个新版本；没公开的草稿由开发者删掉。
- **`verify-feed` 或 `upgrade-from-previous` 失败**：Release 已经公开。先看作业摘要与证据（`feed-evidence.json`、`upgrade-evidence`）：是 GitHub 的临时问题就重跑作业；是资产或清单的问题，提高补丁号发一个修正版本，有问题的 Release 由开发者决定是否改回草稿。
- **`registry-smoke` 失败**：npm 包已发。先看是不是版本还没在 registry 上可见（等待超过 30 分钟）；是的话等它出现后重跑这个作业。

产物保留 35 天（覆盖首次运行后 30 天的可重跑期），冒烟证据保留 14 天。

## 本机发布

以源码发布的 10 个工作区包（nb-story 与它依赖的 9 个，[ADR 0029](../adr/0029-workspace-packages-publish-source-to-npm.md)、[ADR 0052](../adr/0052-non-stale-file-lock-package.md)）与先生成再发布的两个包（应用 `@notnotype/neuro-book` 与插件 SDK `@notnotype/nb-plugin-sdk`，[ADR 0033](../adr/0033-app-delivered-as-built-npm-package.md)）在本机也能发，用于首发还没有信任配置的包与流水线不可用时。改版本与发布都要开发者授权，`release:publish` 由开发者执行：

1. 改版本，合入 master（同上文“发版”的第 1、2 步）。
2. 推 master：README 的图片用 GitHub 上的地址，没推送时 npm 页面看不到；发布门禁会查。
3. `bun run release:check`：源码包的发布清单（license、`files`、`LICENSE`、README、内部依赖写法、源码导入的包都写进依赖）。
4. `bun run release:smoke`：生成应用包与 SDK 包，12 个包都过发布清单检查、打成 tarball 放进 `dist/release/` 并写下 `release-manifest.json`（提交与 SHA-256）；再装进仓库外的空项目像用户那样用一遍：`nbstory` 与它的查看器、Vite 宿主构建、`bun add -g` 应用后 `nbook` 打开书架、`bunx -p` SDK 生成插件并构建、`nbook plugin install` 后重启插件已加载。直连 registry 慢时整条命令前加 `prox`。冒烟之后不要 amend、变基或改写已冒烟的提交：`release-manifest.json` 记的是那一刻的提交，改写后它要么不在 `origin/master` 上，要么与要发布的目录对不上，只能重跑冒烟。
5. `npm login`，再 `bun run release:publish`：过门禁（会发布的目录没有未提交的改动、在 master 上、冒烟用的提交已在 origin/master、冒烟以来会发布的目录没改过、tarball 没被改过、源码包的发布清单、要发的包的 typecheck），列出要发的包；确认后带 `--yes` 重跑，发的就是第 4 步验过的 tarball（Bun 发 tarball 时按当前目录找 bin，会打印 `warn: bin … does not exist`，无害：bin 在 tarball 里，冒烟已经跑过）。开了两步验证时加 `--auth-type web`（一个 OTP 只有 30 秒，发不完 12 个包）；在非交互的终端里 npm 拿不到认证链接，要在真正的终端里运行。中途失败就停，重跑会跳过已发布的版本。
6. 发布后在发布用的那个提交上跑 `bun run release:smoke --from registry --wait 30`（先等这些版本在 registry 上取得到，再按当前 checkout 的版本号装，装到的版本对不上就失败），结果记进对应 Task 的证据。
