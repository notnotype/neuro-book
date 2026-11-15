# t12 计划：发布阶段、变更记录与发版脚本

## Context

v0.13.0 是第一个经流水线的正式发布（t11）。发出去之后开发者 2026-11-15 定：

- 现在的版本都是 **canary**（早期验证版：功能能用，未必经过完整人工验收）；之后是 **preview**（预览版，也叫测试版：新功能的预览）；最后是 **stable**（稳定版）。GitHub 的 latest 可以指向最新的 canary。
- npm 的阶段规则只管以后；GitHub 上的 v0.13.0 已改标题与说明（“NeuroBook 0.13.0（canary）”）。
- 治理参照 omp（can1357/oh-my-pi）：各包 CHANGELOG、发版脚本、由 CHANGELOG 生成 Release 说明；Release 说明先只写中文。
- 安装包从下一版起叫 `NeuroBook-<版本>-win-x64-Setup.zip`，v0.13.0 不改。
- 写回：主题声明要求的 nb-ui 版本与 nb-ui 版本一致要有机检（v0.13.0 演练第 2 次因它失败）。
- 发布文档整理：发布手册单独成文，`repository-workflow.md` 只留授权。

依据：[ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)、[ADR 0033](../../../../../docs/adr/0033-app-delivered-as-built-npm-package.md)、[ADR 0051](../../../../../docs/adr/0051-desktop-shell-electrobun-tag-release.md)、t11 的 [plan.md](../t11-release-pipeline/plan.md)。新决定写进 ADR 0053（部分取代 0029 决定 5 的“都发到 latest、由开发者执行”）。

参照的做法（2026-11-15 读的 omp main）：`AGENTS.md` 的 Changelog 与 Releasing 两节、`scripts/release.ts`、`scripts/ci-release-notes.ts`；magpie 的 Release 正文（下载哪个、致谢）。不照搬 omp 的 canary：它是稳定版旁边的一条支线（`X.Y.Z-canary.N`、npm `canary` 标签、GitHub 预发布、用户主动选），我们还没有稳定版、要一条更新线；第一个稳定版时再照它改，写进 ADR 0053。

## 技术选型

- CHANGELOG 解析与改写：手写（按 `## [版本]`、`### 分类` 两级标题切段，几十行）。否决 `keep-a-changelog` 等库：分类名是中文、要保留 omp 的“未发布段落不可改”的检查，库的格式化会改写已发布段落。
- 发版脚本的参数解析：`node:util` 的 `parseArgs`（仓库脚本现用的）。
- 其余无新依赖。

## 关键设计

### 阶段：`packages/neuro-book/src/shared/product.ts`、`scripts/release/tag.ts`

- `product.ts` 加 `export const PRODUCT_STAGE: ProductStage = "canary"`，`ProductStage = "canary" | "preview" | "stable"`。阶段与版本号一样经提交改，标签门禁读它。
- 版本号保持纯数字（`STABLE_VERSION` 不变）。阶段写进预发布段有两个坑：预发布段按字母比较，同一个版本号换阶段时次序取决于阶段名的字母（更新器只升不降）；内部依赖的 `^` 范围不接受别的版本号的预发布段。
- `tag.ts check` 与 `source` 多打一行 `stage=<阶段>`；读法与 `sourceVersions` 一样从 `product.ts` 取（正则取常量，不导入应用代码）。`stage = stable` 时门禁失败：“稳定版的发布规则（npm 标签、桌面频道）还没实现，见 ADR 0053”。第一个稳定版时由那个 Task 去掉这条。
- npm：本 Task 不改 `distTagFor`（第一个稳定版之前一律 `latest`，与现在相同）。

### 变更记录：`packages/*/CHANGELOG.md`、`scripts/release/changelog.ts`

- 每个发布单元一份：10 个源码包各一份；应用、桌面版与 SDK 同一个产品版本，共用 `packages/neuro-book/CHANGELOG.md`。
- 格式（照 omp，分类名用中文）：

  ```markdown
  # 变更记录

  ## [Unreleased]

  ### 不兼容的改动
  ### 新增
  ### 改动
  ### 修复
  ### 移除
  ### 数据与升级      ← 只有应用用：数据格式、迁移、不能降级

  ## [0.13.0] - 2026-11-15
  ```

  条目一行，写用户看到的或能做的事；带 `([#12](…/issues/12))`，外部贡献 `([#34](…/pull/34) by [@名字](https://github.com/名字))`。已发布的段落不改。
- 初始内容：应用写一段 `[0.13.0] - 2026-11-15`（第一个 Windows 桌面版的要点，从 w00046 的结果摘）；源码包只放 `[Unreleased]` 与一句“更早的版本见 Git 历史”。
- `changelog.ts` 导出：`parseChangelog(text) → {unreleased: Section; releases: {version, date, section}[]}`（`Section` 是分类到条目列表）；`finalizeUnreleased(text, version, date) → text`（`[Unreleased]` 改名为版本段、上面补一个空的 `[Unreleased]`；`[Unreleased]` 为空或版本段已存在时抛出）；`CATEGORIES` 定顺序，未知的 `###` 分类报错（不静默丢条目）。
- 文件进 `files`：源码包的 `package.json` 的 `files` 加 `CHANGELOG.md`，`checkReleasePackages` 加一条“发布单元有 CHANGELOG.md、格式能解析”。应用包由 `pack-app.ts` 拷进生成目录（与 README 一样）。

### Release 说明：`scripts/release/release-notes.ts`、`scripts/release/desktop-release-notes.md`

- `render(input) → markdown`，输入：版本、阶段、发布计划里本次发布的包（名、版本）、各发布单元的 CHANGELOG 文本、上一个公开的 Release 标签。输出顺序：
  1. 开头：版本与阶段的一句话（阶段说明是固定文案：canary、preview 各一段；stable 不加）、npm 同版本；
  2. “数据与升级”（应用段有这一类时，放最前，提醒先备份）；
  3. 变更：应用一节在前，之后是本次发布的源码包，每节按 `CATEGORIES` 输出；本次发布的包没有对应版本段时报错；
  4. 模板里原有的“下载哪个”“第一次运行”“回到旧版本”；
  5. 致谢：从条目里的 `by [@名字]` 收集，去重；没有就不出这节；
  6. `**完整对比**：<上一个>...v<版本>` 的 compare 链接（没有上一个就不出）。
- 应用的变更段取 `(上一个公开的 Release, 本次]` 之间的全部版本段（omp 的做法：中间的标签没发出 Release 时，它的条目并进这次），源码包只取本次版本段。
- 命令：`check <版本> <release-plan.json>`：npm 包作业写完发布计划后跑，在任何远端写入之前确认说明能生成（应用有本次版本段、每个本次发布的包都有）；`render <版本> <release-plan.json> <输出>`：GitHub Release 作业用。上一个 Release 由 `github-release.ts` 已有的 `list` 读出。
- `github-release.ts draft`：标题 `NeuroBook <版本>（<阶段>）`（stable 不加括号），正文用 `render` 的结果代替现在的模板替换。阶段从 `tag.ts source` 取（与门禁同一来源）。

### 发版脚本：`scripts/release/prepare.ts`（`bun run release:prepare`）

- `release:prepare <版本|patch|minor> [--stage canary|preview]`，在当前检出（Work 分支或 master）上：
  1. 预检：会发布的目录干净；
  2. 改产品版本两处（`package.json`、`product.ts`）与阶段；
  3. 对每个发布单元：`[Unreleased]` 有条目的，要求它的版本是 registry 上没有的（没提版本号就停，提示先提）；没有条目却版本号是新的，也停（缺变更记录）；通过后定稿成 `[<它的版本>] - <今天>`；应用的 `[Unreleased]` 必须有条目；
  4. 提交 `release: v<版本>`，打印下一步（合入、推 master、由开发者打标签推送）。
- 不打标签、不推送：推标签只由开发者做（标签规则集）。registry 查询复用 `publish.ts` 的 `publishedState`。

### 安装包改名：`desktop` 作业的冻结步骤、`github-release.ts`、`release.yml`

- 冻结资产时把 Hutch 产出的 `win-x64-NeuroBook-Setup.zip` 改名为 `NeuroBook-<版本>-win-x64-Setup.zip`；A′、B′ 的测试变体不改（不进 Release）。
- `requiredAssets(version)` 用新名；`SETUP_ASSET` 换成 `setupAsset(version)`，另留 `LEGACY_SETUP_ASSET`：`previous` 认两个名字（v0.13.0 是旧名），`upgrade-from-previous` 下载时按 `previous` 打出的资产名下载（`previous` 多打一行 `previous-setup=<名>`）。
- 安装版冒烟、发布说明模板里的文件名跟着改。

### 主题版本的机检：`packages/nb-ui/src/theme/theme-loader.test.ts`

- 加一条：`packages/nb-ui/themes/*/manifest.ts` 的 `hostVersion` 都接受当前 `NB_UI_VERSION`（用 `satisfiesRange`）。放在 nb-ui 的测试里而不是 `release:check`：提 nb-ui 版本号的那次提交在 CI 上就失败，不用等到发布。

## Spec 与文档改动

- 新 `docs/adr/0053-release-stages-and-changelog.md`：阶段、版本号不带阶段、GitHub latest 指向最新、npm 在第一个稳定版前只发 latest；CHANGELOG 与生成的说明；第一个稳定版时要做的（照 omp 的 canary 支线、桌面另开频道、门禁去掉 stable 拒绝）。部分取代 0029 决定 5；`docs/adr/README.md` 索引登记并在 0029 那行补注。
- 新 `docs/standards/releasing.md`（发布手册）：阶段与版本、变更记录怎么写、发版（`release:prepare` → 合入 → 推 master → 打标签）、流水线各作业、一次性准备、失败与重跑、本机发布。内容从 `repository-workflow.md` 的“发布授权”搬来再改；那一节只留授权规则与链接。
- 链到发布手册：`docs/standards/README.md`、`AGENTS.md` 的“动手前读什么”（加一行“发版、写变更记录”）、`packages/AGENTS.md`（“改了要发布的包的用户可见行为，同一提交在 CHANGELOG 的 `[Unreleased]` 补条目”）、`packages/neuro-book/desktop/README.md`、`packages/neuro-book/README.md`、`PROJECT-STATUS.md`、`release.yml` 头注释、脚本头注释里的“发布授权”。
- Spec：`runtime/desktop-update` 与 `runtime/desktop-shell` 只有资产名出现处跟着改（行为合同不变）。

## 切片

1. 主题版本的机检（nb-ui 测试）。验证：`bunx vitest run packages/nb-ui/src/theme/theme-loader.test.ts`，把一个主题改成 `^0.3.0` 看它失败再改回。
2. 阶段：`product.ts`、`tag.ts`、门禁输出；单测（`tag.test.ts`、`product.test.ts`）。
3. CHANGELOG：`changelog.ts` 与单测；12 个发布单元的初始文件；`files`、发布清单检查、`pack-app.ts`。验证：`bun run release:check`、`bun run release:smoke`（产物里有 CHANGELOG.md）。
4. Release 说明：`release-notes.ts` 与单测、模板、`github-release.ts draft` 改用它；`release.yml` 的 `npm-packages` 加 `check`、`github-release` 下载 `npm-packages` 并 `render`。验证：用真实 CHANGELOG 与本机 `release:smoke` 写出的计划渲染一份，存进证据。
5. 发版脚本 `prepare.ts` 与单测（registry 用注入的查询）；在一次性 worktree 里对真实仓库跑一次 `patch`，看提交内容，不合入。
6. 安装包改名：冻结步骤、`github-release.ts`、`upgrade-from-previous`、冒烟参数、模板；单测。
7. 文档：ADR 0053、发布手册、各处链接。验证：`bun run governance:check`、`bun run docs:check`、actionlint。

每片单独提交；全部在 Work 分支 `feat/w00046-release-stages`（worktree `.worktree/w00046-release-stages`）。

## 验收映射

没有 Spec 编号要映射（行为合同不变）。判据：

- 门禁：`stage` 进 `GITHUB_OUTPUT`；`stable` 被拒 → `tag.test.ts`。
- 发布单元缺 CHANGELOG 或格式错 → `packages.test.ts`（发布清单检查）。
- 说明：分类顺序、数据与升级在前、未发出 Release 的中间版本并入、缺版本段报错、致谢去重、compare 链接 → `release-notes.test.ts`。
- 发版脚本：没提版本号的有条目包、提了版本号没条目的包都停；定稿后 `[Unreleased]` 为空 → `prepare.test.ts`。
- 改名：`previous` 认旧名与新名、`requiredAssets` 用新名 → `github-release.test.ts`。
- 主题 → `theme-loader.test.ts`。

## 验证

- 每片的单测；`bun run test:affected`；类型检查 `bunx tsc -p scripts/tsconfig.json --noEmit`；改 `.github/workflows/` 跑 actionlint。
- `release:smoke` 一次（切片 3 之后，确认 CHANGELOG 进包、生成的应用包里有它）。
- 流水线：合入 master 并推送后（push 要开发者授权）在 Actions 上演练一次（`workflow_dispatch`），覆盖门禁的 `stage`、`npm-packages` 的说明检查、桌面冻结的改名与安装版冒烟。演练跳过 `github-release`，所以说明的渲染与草稿标题靠本机渲染的证据与单测；真正的草稿在下一次打标签时第一次出现。
- 未验证边界：第一次带新说明的 Release 要到下一个标签；`upgrade-from-previous` 第一次真正运行也在下一个标签（上一版是旧名 v0.13.0，正好覆盖认旧名）。

## 不做与风险

- 不做：英文说明；应用界面上显示阶段（关于页、标题栏）；稳定版的 npm 标签与桌面频道（第一个稳定版时）；签名的 SHA256SUMS；清理旧应用时期的 GitHub Release（开发者决定）。
- 风险：CHANGELOG 靠写的人自觉补。发版脚本对“版本号新、没有条目”和“有条目、没提版本号”都停下，兜住最常见的两种漏；不加“改了源码就要求 CHANGELOG”的治理检查（误报多，omp 也没有）。
