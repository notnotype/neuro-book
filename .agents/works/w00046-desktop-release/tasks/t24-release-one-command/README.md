---
schema: nbook.task/v2
taskId: t24-release-one-command
status: done
updated: 2026-11-20
---

# 发版跑通：CI 全绿、一条命令推送、流水线发 npm 与 Release（含 macOS）

## 目标与范围

来源：开发者 2026-11-20（“可以再发一个新 canary 版了，本次把 CI 全流程都彻底跑通，做到一条命令帮助推送，然后 github action 全发布，包括 npm，release。还有再研究一下 release note 谁来写”）。

- 修好 master 上让 Release 流水线跳过 npm 与 Release 的 CI 失败（v0.14.0、v0.14.1 都因此没发 npm）；
- 一条命令发版：准备提交、master 与标签原子推送、盯流水线；
- macOS 桌面包并进 Release 流水线（t23 的工作流改成可复用），不再手动补传；
- 调研 Release 说明由谁写：推送时记、还是在 Actions 里用 Agent 写；参照 omp。
- 发一个新的 canary 版本。

合同：行为合同未变（发布手册 `docs/standards/releasing.md` 随流程一起改）。

## 做了什么（合入 master，分支 `feat/w00046-t24-release`）

- CI 在 master 上的原有失败：
  - 治理检查的 13 条固定等待：轮询改成 `waitUntil`，判定上限与被测的慢读慢写标注理由；
  - SDK 组件子路径补上 `ImagePreviewDialog`、`SidePanel`；
  - 看板娘的跨插件导入经对方的 `shared/contracts.ts`；
  - 三个贡献点的命名空间用例按 w00043 t06 的新规则改；
  - nb-ui 登记宿主钩子变量 `--nb-side-panel-inset-top`；
  - 服务端冒烟的 stderr 竞态（S10）。
- Windows 打包：内置表情包的中文文件名让 Hutch 调的 `tar.exe` 在 runner 上失败（第二次演练）。改成 ASCII 文件名、表情名写进清单；组装载荷时拦下非 ASCII 路径。
- 一条命令发版：`scripts/release/release.ts`（`bun run release rehearse | <版本> | watch <版本>`）。
- macOS 并入 Release 流水线：`desktop-macos-build.yml` 只读可复用；`github-release` 作业核过 macOS 产物才并入，失败只告警。`desktop-macos.yml` 留作手动补包。
- 发布手册改了“发版”与“流水线”两节；Release 说明的模板加了 macOS。
- Release 说明由谁写的调研：[research-release-notes.md](research-release-notes.md)。

## 验证

- 本机：
  - `test:affected --since master --typecheck` 全部通过；
  - 改过的 e2e 都通过：`desktop-settings`、`editor-font-size`、`builtin-stickers`、`app-package`；
  - 服务端冒烟连跑 3 次通过。
- 演练（`bun run release rehearse`）：
  - 第 1 次（44722785765）启动即失败：被调用的工作流里有要写权限的作业；
  - 第 2 次（44724555998）：Windows 打包失败（中文文件名），其余通过，CI 第一次在 runner 上全绿；
  - 第 3 次（44729550074）：除冒烟 S10 的偶发失败外全部通过，Windows 安装版、便携版、更新冒烟与 macOS 构建都成功。
- 实现审查：omp 14 条全部处理，见 [evidences/impl-review-disposition.md](evidences/impl-review-disposition.md)。

## v0.15.0 的发布（2026-11-20）

- 第 4 次演练（44732642632，f1beae555）全绿，之后 `bun run release 0.15.0`：
  - 提交 `release: v0.15.0`（2878960fa）；
  - master 与标签原子推送；
  - Release 流水线 44735943591。
- 第 1 轮的结果：
  - 门禁、CI、npm 包、Windows 的三项冒烟都通过；
  - npm 发了 `@notnotype/neuro-book@0.15.0` 与 `@notnotype/nb-plugin-sdk@0.15.0`，`registry-smoke` 通过；
  - Release 公开，是最新版；
  - macOS 构建在打 DMG 时撞上 runner 的 `hdiutil create` “Resource busy”，失败、不挡发布。“自动更新的取法”与“上一版升级”被 macOS 连带跳过（缺省的 `success()` 看所有上游作业）。
- 第 2 轮（重跑失败的作业）：
  - macOS 构建成功，`github-release` 把 macOS 的一整套补传到已公开的 Release；
  - `verify-feed` 通过；
  - `upgrade-from-previous`（0.14.1 → 0.15.0）失败。原因是冒烟脚本：新 runner 上 0.14.1 的首次启动向导与更新提示同时在，模态框挡住了“下载”按钮，不是产品的更新失败。
- 发布时暴露、已修在 master 上、下一版生效：
  - macOS 构建最多试 3 次；
  - `bun run release` 判定前等整轮 `completed`（`gh run watch --exit-status` 在第一个作业失败就退出）；
  - 核对与升级作业不被 macOS 连带跳过；
  - 更新冒烟的向导处理。

## 没做与后续

- 0.14.1 → 0.15.0 的真实自动升级没有在流水线上验证通过（见上）：开发者机器上装着的 0.14.1 会提示更新，可以顺手确认。
- macOS 的补丁文件（`stable-macos-arm64-*.patch`）构建出来了，却没放进 Electrobun 的产物目录，没上传：macOS 版更新时下载完整包。
- 十个源码包里有 7 个改过源码没提版本号（发布计划里列着），这次只发了应用与 SDK。
- 要不要做发版前用模型整理 `[Unreleased]` 的步骤，交开发者定（[调研](research-release-notes.md)）。
