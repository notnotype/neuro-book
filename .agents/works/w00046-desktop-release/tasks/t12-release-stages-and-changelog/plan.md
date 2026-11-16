# t12 计划：发布阶段、变更记录与发版脚本（r2）

r1 经设计审查（omp 10 条、拉远看 10 条，[处理](evidences/design-review-r1-disposition.txt)）改成本稿。

## Context

v0.13.0 是第一个经流水线的正式发布（t11）。发出去之后开发者 2026-11-15 定：

- 现在的版本都是 **canary**（早期验证版：功能能用，未必经过完整人工验收）；之后是 **preview**（预览版，也叫测试版：新功能的预览）；最后是 **stable**（稳定版）。GitHub 的 latest 可以指向最新的 canary。
- npm 的阶段规则只管以后；GitHub 上的 v0.13.0 已改标题与说明（“NeuroBook 0.13.0（canary）”）。
- 治理参照 omp（can1357/oh-my-pi）：CHANGELOG、发版脚本、由 CHANGELOG 生成 Release 说明；Release 说明先只写中文。
- 安装包从下一版起叫 `NeuroBook-win-x64-Setup.zip`，便携版 `NeuroBook-win-x64-portable.zip`：不带版本号，`releases/latest/download/<名>` 是固定的“下载最新版”链接（开发者在审查后选定）。v0.13.0 不改。
- 写回：主题声明要求的 nb-ui 版本要有机检（已做，切片 1）；发布文档整理成手册。

依据：[ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)（源码包各自的版本、没发过才发）、[ADR 0033](../../../../../docs/adr/0033-app-delivered-as-built-npm-package.md)、[ADR 0051](../../../../../docs/adr/0051-desktop-shell-electrobun-tag-release.md)（决定 6 只升不降、决定 7 打标签发布）、[桌面发行提案](../../../../../docs/proposals/desktop-distribution.md) 4.8（预发布标签第一版拒绝）、t11 的 [plan.md](../t11-release-pipeline/plan.md)。新决定写进 ADR 0053。

参照（2026-11-15 读的 omp main）：`AGENTS.md` 的 Changelog 与 Releasing、`scripts/release.ts`、`scripts/ci-release-notes.ts`；magpie 的 Release 正文（下载哪个）。omp 全部包同一个版本、一个脚本改版本到打标签；我们的源码包各自有版本（ADR 0029），所以只学它的格式与“说明由变更记录生成”，版本与发布集合沿用现有规则。

## 技术选型

- CHANGELOG 解析：手写（按 `## [版本]`、`### 分类` 两级标题切段）。否决解析库：分类名是中文，库的格式化会改写已发布段落。
- 不用 GitHub 自动生成的说明（`--generate-notes`）、git-cliff、release-please：它们由提交或 PR 生成，我们的提交是给开发者看的中文流水账，不经 PR，生成出来不是用户能读的变更。changesets 已在 ADR 0029 否决。
- 参数解析：`node:util` 的 `parseArgs`。无新依赖。

## 关键设计

### 阶段：`packages/neuro-book/src/shared/product.ts`、`scripts/release/tag.ts`

- `product.ts` 加 `PRODUCT_STAGE: ProductStage = "canary"`（`"canary" | "preview" | "stable"`），放在 `PRODUCT_VERSION` 旁边：阶段是这一版产品的属性，只随提版改，改了也是同一次构建，不多一次构建。
- 版本号保持纯数字（`STABLE_VERSION` 不变）：ADR 0051 决定 6 只升不降、提案 4.8 预发布标签第一版拒绝；阶段写进预发布段时按字母比较，同一版本号换阶段的次序取决于阶段名。
- `tag.ts check`、`source` 多打 `stage=<阶段>`（从 `product.ts` 用正则取，同 `sourceVersions`）。`stage = stable` 时门禁失败（稳定版的发布规则还没实现，见 ADR 0053），第一个稳定版的 Task 去掉。
- 阶段与 Electrobun 的发布频道不是一回事：频道名 `stable` 写进已装的应用（资产前缀 `stable-win-x64-`），与阶段无关，ADR 0053 写明。
- npm：本 Task 不改 `distTagFor`，第一个稳定版之前一律 `latest`。

### 变更记录：`packages/*/CHANGELOG.md`、`scripts/release/changelog.ts`

- 应用、桌面版与 SDK 共用 `packages/neuro-book/CHANGELOG.md`。源码包的 CHANGELOG 在它下一次提版时建（`release:prepare` 要求），现在不建空文件。
- 格式（照 omp，分类名中文）：`## [Unreleased]`，分类依次 `不兼容的改动`、`新增`、`改动`、`修复`、`移除`，应用另有 `数据与升级`（数据格式、迁移、不能降级）；`## [0.13.0] - 2026-11-15`。条目一行，写用户看到的或能做的事，带 `([#12](…/issues/12))`，外部贡献 `([#34](…/pull/34) by [@名字](https://github.com/名字))`。已发布的段落不改（写进手册，不机检）。
- 写在哪：应用用户看得到的行为变化（哪怕改在库里）写应用的 CHANGELOG；库的 CHANGELOG 写给直接用这个包的人（插件作者、nb-story 用户）。
- 不进 npm 包：已发的版本加上它字节就变，发布计划会把它们当成改过源码的历史包，本次发布的包依赖它们时整轮被拦（`blockingStalePackages`）。npm 页面的 README 已有仓库链接；Release 说明链到标签下的 CHANGELOG。
- 初始内容：应用写 `[0.13.0] - 2026-11-15`（第一个 Windows 桌面版的要点）与空的 `[Unreleased]`。
- `changelog.ts`：`parseChangelog(text) → {unreleased, releases: {version, date, section}[]}`，`Section` 是分类到条目；未知分类报错。`finalizeUnreleased(text, version, date)`：`[Unreleased]` 改为版本段、上方补空的 `[Unreleased]`；为空或版本段已存在时抛出。`mergeSections(sections)`：跨版本按分类合并，按条目文本去重、保留较新的那条（omp 的做法）。

### Release 说明：`scripts/release/release-notes.ts`、`scripts/release/desktop-release-notes.md`

- 在 `gate` 作业里生成并作为工件 `release-notes` 上传：输入全在门禁手里（标签提交的源码、`previous` 已算出的上一个桌面 Release），生成失败就停在一切远端写入之前。`github-release` 只用这个文件，不重新生成。
- `render({version, stage, previous, appChangelog, released, repo}) → markdown`：
  1. 开头：版本与阶段的一句话（canary、preview 各一段固定文案，stable 不加）；
  2. `数据与升级`（有时放最前）；
  3. 应用的变更：取 `(previous, version]` 之间的全部版本段合并去重（中间的标签没发出 Release 时并进这次）；
  4. “同时发布的 npm 包”：本次版本号有变的源码包（与 `previous` 标签的 `package.json` 比，git 读），每个一行 `@notnotype/x 0.4.0`，链到 `blob/v<版本>/packages/x/CHANGELOG.md`；
  5. 模板原有的“下载哪个”“第一次运行”“回到旧版本”；
  6. `**完整对比**：compare/<previous>...v<版本>`（没有 previous 就不出）。
- 门禁的检查（同一个命令）：应用有非空的 `[<版本>]` 段、`[Unreleased]` 为空（定稿到打标签之间进来的条目不会漏）；每个版本号有变的源码包有 CHANGELOG 且有 `[<它的版本>]` 段。演练（`workflow_dispatch`）在 master 上跑，用源码里已发过的版本，`[Unreleased]` 通常有条目：演练只渲染、不查 `[Unreleased]` 为空。没有 `previous` 时不列同时发布的包。
- `github-release.ts draft <版本> <资产目录> <说明文件>`：建草稿时标题 `NeuroBook <版本>（<阶段>）`（stable 不加括号）、正文用这个文件；已有草稿时用 `gh release edit` 把标题与正文换成这次的（同一提交、同一个 `previous`，重跑得到同一份）；已公开的不动正文。

### 发版脚本：`scripts/release/prepare.ts`（`bun run release:prepare <版本> [--stage canary|preview]`）

- 只在 master 上、HEAD 包含 `origin/master`（先 fetch）、会发布的目录干净时运行；版本是显式的纯数字、高于当前。
- 源码包的版本照 ADR 0029 手工提（改它的 `package.json`），提版本身就是“这个包这次发”的输入。脚本找出与上一个桌面 Release 标签相比版本号有变的源码包：每个都要有 CHANGELOG 且 `[Unreleased]` 有条目，否则停；版本没变而 `[Unreleased]` 有条目的，留到它下次提版，打一行提示。应用的 `[Unreleased]` 必须有条目。
- 先只读检查完全部，再一次写：两处产品版本与阶段、各 CHANGELOG 定稿（`[<各自版本>] - <今天>`）；写后重新解析一遍，再 `git commit -- <这些文件>` 提交 `release: v<版本>`。中途任何一项不过都不写文件。
- 不打标签、不推送：打印下一步（推 master、开发者打标签推送）。

### 安装包与便携版改名：`desktop` 作业、`portable.ts`、`github-release.ts`、`release.yml`

- 冻结资产时把 Hutch 的 `win-x64-NeuroBook-Setup.zip` 改名为 `NeuroBook-win-x64-Setup.zip`；`portable.ts` 输出 `NeuroBook-win-x64-portable.zip`。A′、B′ 不改（不进 Release）。
- `requiredAssets` 用新名；`previous` 找上一个桌面版本时新旧两个 Setup 名都认（v0.13.0 是旧名）；`upgrade-from-previous` 下载用 `--pattern '*Setup.zip'`（每个 Release 只有一个），冒烟用下载到的那个文件。
- 安装版、便携版冒烟的参数与说明模板跟着改。

## Spec 与文档改动

- 新 `docs/adr/0053-release-stages-and-changelog.md`：
  - 阶段与次序；版本号不带阶段；第一个稳定版之前全部发布设为 GitHub latest、npm 只发 `latest`、桌面一条更新线。
  - CHANGELOG 与生成的说明。
  - 第一个稳定版时的迁移合同：稳定版用高于此前全部版本的新版本号；已装的应用（频道 `stable`、更新源 `releases/latest/download`）留在稳定线上；之后的 canary、preview 照 omp 走支线：版本号 `X.Y.Z-<阶段>.N`、npm `--tag <阶段>`（发布时只挂一个标签，trusted publishing 够用）、GitHub 预发布、桌面另开频道与更新源（新装才进支线）；`previous` 只看稳定线。
  - 部分取代 ADR 0029 决定 5（“都发到 latest、由开发者执行”）；`docs/adr/README.md` 登记并在 0029 那行补注。
- 新 `docs/standards/releasing.md`（发布手册）：阶段与版本、写变更记录、发版（`release:prepare` → 推 master → 打标签）、流水线各作业、一次性准备、失败与重跑、本机发布。从 `repository-workflow.md` 的“发布授权”搬来再改，那一节只留授权规则与链接。
- 链到发布手册：`docs/standards/README.md`、`AGENTS.md` 的“动手前读什么”、`packages/AGENTS.md`（改了要发布的包的用户可见行为，同一提交补 `[Unreleased]`）、`packages/neuro-book/desktop/README.md`、`packages/neuro-book/README.md`、`PROJECT-STATUS.md`、`release.yml` 与脚本头注释里的“发布授权”。
- Spec：`runtime/desktop-update` 与 `runtime/desktop-shell` 出现资产名的地方跟着改。

## 切片

1. ~~主题版本的机检~~（已提交 `82d1affd6`）。
2. 阶段：`product.ts`、`tag.ts`（`stage=`、拒绝 stable）；单测。
3. 变更记录：`changelog.ts` 与单测；应用的 CHANGELOG。
4. Release 说明：`release-notes.ts` 与单测、模板；`gate` 生成并上传、`github-release` 下载并传给 `draft`；`draft` 的标题与改正文。验证：用真实 CHANGELOG 渲染 0.13.1 的样例存证据。
5. 发版脚本 `prepare.ts` 与单测（git 与 registry 用注入的端口）；在一次性 worktree 里对真实仓库跑一次（`master` 检查用参数放开），看提交内容，不合入。
6. 改名：冻结步骤、`portable.ts`、`github-release.ts`、`upgrade-from-previous`、冒烟参数、模板；单测。
7. 文档：ADR 0053、发布手册、各处链接。

每片单独提交，在 Work 分支 `feat/w00046-t12-release-stages`（worktree `.worktree/w00046-t12-release-stages`）。

## 验收映射

行为合同不变，没有 Spec 编号。判据与测试：

- `stage=` 进门禁输出、stable 被拒 → `tag.test.ts`。
- 解析：未知分类报错；定稿后 `[Unreleased]` 为空、版本段在上 → `changelog.test.ts`。
- 说明：数据与升级在前；中间未发 Release 的版本并入、重复条目只留一条；同时发布的包只列版本号有变的；缺版本段、`[Unreleased]` 非空时检查失败；compare 链接 → `release-notes.test.ts`。
- 草稿：新建用标题与说明文件，已有草稿改标题与正文，已公开的不改 → `github-release.test.ts`。
- 发版脚本：不在 master 或落后 origin、版本没升、提版的包没条目、应用没条目都不写任何文件；版本没变而有条目的包留下 → `prepare.test.ts`。
- 改名：`requiredAssets` 新名、`previous` 认新旧两名 → `github-release.test.ts`。

## 验证

- 单测、`bun run test:affected`、`bunx tsc -p scripts/tsconfig.json --noEmit`、actionlint、`governance:check`、`docs:check`。
- 本机渲染一份说明（用真实的应用 CHANGELOG 与 v0.13.0 作 previous），存进证据。
- 流水线：合入 master 并推送后（push 要开发者授权）演练一次（`workflow_dispatch`）：门禁输出阶段并生成说明工件、桌面冻结的改名与两个冒烟。演练跳过远端写入的作业，草稿的标题与正文靠单测与本机渲染；第一次真正用上在下一个标签。
- 未验证边界：`upgrade-from-previous` 第一次运行在下一个标签（上一版 v0.13.0 是旧名，正好覆盖“认旧名”）。

## 不做与风险

- 不做：英文说明；应用里显示阶段；稳定版的实现（ADR 0053 写合同）；签名的 SHA256SUMS；清理旧应用时期的 Release；致谢一节（条目里已带贡献者）。
- 风险：变更记录靠写的人补。兜底是门禁（应用要有本次版本段、提版的源码包要有段）与发版脚本（提版的包没条目就停）；不加“改了源码就要 CHANGELOG”的治理检查。
