---
schema: nbook.adr/v1
status: accepted
decided: 2026-11-15
superseded-by: null
---

# ADR 0053：发布分 canary、preview、stable 三个阶段，阶段不写进版本号；变更记录按发布单元写，Release 说明由它生成

- 日期：2026-11-15
- 决策者：开发者
- 关联工作：[w00046 t12](../../.agents/works/w00046-desktop-release/tasks/t12-release-stages-and-changelog/README.md)
- 补充：[ADR 0029](0029-workspace-packages-publish-source-to-npm.md) 决定 5（版本与 dist-tag）、[ADR 0051](0051-desktop-shell-electrobun-tag-release.md) 决定 7（打标签发布）：定下发布的阶段、变更记录与 Release 说明；两份的其余决定不变

## 背景

v0.13.0 是第一个经流水线发布的版本（w00046 t11），它的 GitHub Release 只有一份固定模板，看不出这一版改了什么，也看不出它有多成熟。开发者定：现在的版本都是早期验证版，之后有几轮预览版，最后才是稳定版；治理大体照 omp（can1357/oh-my-pi）的做法。

omp 的做法：每个包一份 Keep a Changelog 格式的 `CHANGELOG.md`，新条目写在 `[Unreleased]`；发版脚本一次改版本、定稿变更记录、打标签；CI 把各包本版本的段落拼成 Release 说明。它的 canary 是稳定版旁边的一条支线：版本号 `X.Y.Z-canary.N`、npm 的 `canary` 标签、GitHub 预发布，用户主动选择才升级到它。omp 全部包同一个版本；我们的源码包各有版本（ADR 0029）。

## 决策

1. **三个阶段**：canary（早期验证版：功能能用，未必经过完整的人工验收）→ preview（预览版，也叫测试版：新功能的预览）→ stable（稳定版）。阶段是每个产品版本的属性，写在 `packages/neuro-book/src/shared/product.ts` 的 `PRODUCT_STAGE`，随提版一起改；标签门禁读它，Release 的标题（`NeuroBook <版本>（<阶段>）`，稳定版不带括号）与说明的开头按它写。
2. **版本号不带阶段**，仍是纯数字（ADR 0051 决定 6 只升不降、[桌面发行提案](../proposals/desktop-distribution.md) 4.8 的预发布标签第一版拒绝）。阶段写进预发布段时按字母比较，同一个版本号换阶段的先后取决于阶段名的字母。
3. **第一个稳定版之前只有一条线**：每次发布都设为 GitHub 的最新，桌面版的自动更新跟着最新走（已装的 canary 会升到之后的 preview、stable）；npm 只发 `latest`（ADR 0029 决定 5 不变）。门禁拒绝 `stable`，直到第 5 条做完。
4. **变更记录按发布单元写**：应用、桌面版与插件 SDK 同一个产品版本，共用 `packages/neuro-book/CHANGELOG.md`；源码包各一份，在它下一次提版时建。格式照 omp，分类用中文（不兼容的改动、新增、改动、修复、移除，应用另有数据与升级）。应用用户看得到的变化写在应用的记录里，哪怕改在库里；库的记录写给直接用这个包的人。变更记录不进 npm 包：已发的版本加上它字节就变，发布计划会把它们当成改过的历史包。
5. **Release 说明由应用的变更记录生成**，在门禁作业里生成，生成不出来就停在一切远端写入之前；只展开应用的变更（含上一个桌面版本之后没发出 Release 的中间版本），同时发布的源码包每个一行、链到它的变更记录。发版用 `release:prepare` 提版、定稿、刷新锁文件并提交；打标签仍只由开发者做。
6. **第一个稳定版时的迁移合同**（届时另起 Task 实现，门禁去掉对 `stable` 的拒绝）：
   - 稳定版的版本号高于此前全部版本；npm 用 `latest`，GitHub 设为最新；
   - 已装的应用（Electrobun 频道 `stable`、更新源 `releases/latest/download`）就是稳定线，不迁移；
   - 之后的 canary、preview 照 omp 走支线：版本号 `X.Y.Z-<阶段>.N`，npm `--tag <阶段>`（发布时只挂一个标签，trusted publishing 够用，不需要 dist-tag 权限），GitHub 预发布；桌面另开频道与更新源，只有新装的支线安装包会进支线；
   - 门禁与发布脚本接受带阶段的预发布版本，“上一个桌面版本”只在稳定线里找。
7. **阶段与 Electrobun 的发布频道不是一回事**：频道名 `stable` 写进已装的应用、决定资产的前缀（`stable-win-x64-…`），与第 1 条的阶段无关；第 6 条之前所有阶段的发布都走这个频道。

## 备选方案

- **照搬 omp，现在就用 `X.Y.Z-canary.N`**：GitHub 预发布不会成为最新，已装 0.13.0 的桌面版取 `releases/latest/download` 就再也收不到更新；而且还没有稳定版，支线旁边没有主线。到第一个稳定版时再照它改（决定 6）。
- **阶段写进版本号**（`0.14.0-preview.1`，但仍设为最新）：同一个版本号从 canary 换到 beta 这类名字时会被只升不降拒绝；内部依赖的 `^` 范围不接受别的版本号的预发布段；标签门禁、Hutch 的版本都要改。
- **由提交或 PR 生成说明**（GitHub 自动生成的说明、git-cliff、release-please）：我们的提交写给开发者看，不经 PR，生成出来不是用户能读的变更；changesets 已在 ADR 0029 否决。
- **说明里展开每个源码包的变更**：说明的读者是桌面与命令行用户；库的变化链到它自己的记录就够，展开它还要让 Release 作业去读发布计划。

## 后果

- 变更记录靠写的人补：门禁拦“应用没有本次的段、`[Unreleased]` 还有条目、提了版本的源码包没有段”，发版脚本拦“提了版本的包没有条目”；不加“改了源码就要写记录”的检查。
- `PRODUCT_STAGE` 在应用源码里，改阶段要随一次提版；应用现在不读它，以后要在界面上显示阶段时直接用。
- 安装包与便携版的名字不带版本号（`NeuroBook-win-x64-Setup.zip`、`NeuroBook-win-x64-portable.zip`），`releases/latest/download/<名>` 是固定的最新版链接；v0.13.0 是 Hutch 的原名，找上一个桌面版本时两个名字都认。
- 流程写在 [发布手册](../standards/releasing.md)。
