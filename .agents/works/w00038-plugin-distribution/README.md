---
schema: nbook.work/v1
workId: w00038-plugin-distribution
issueId: null
status: active
updated: 2026-10-30
---

# 插件分发：安装来源、市场客户端、更新与下架

## 目标

让 NeuroBook 能从 git、npm、官方市场、第三方市场与离线压缩包安装插件，处理版本兼容、更新、信任确认与封禁。来源：w00032 t25 讨论（开发者 2026-10-30），整个 t25 移到本 Work。

## 已定的事（[w00032 t25](../w00032-agent-integration/tasks/t25-plugin-marketplace/README.md) 讨论，开发者 2026-10-30）

开发者：整个 t25 移到本 Work；官方网站与配套服务（含官方市场）另开 [w00037](../w00037-official-site/README.md)，本 Work 只管 NeuroBook 这一侧的插件系统。

1. 安装来源：git（GitHub、Gitee 等任何 git 服务）、npm、官方市场、第三方市场、手动下载的压缩包离线安装，以及现有的本地文件夹（[`runtime.plugin-install`](../../../docs/specs/runtime/plugin-install.md)）。
2. 官方市场由 w00037 的官方网站提供，安全措施照 VS Code：杀毒扫描、检测与审核，细节在 w00037 讨论。
3. 第三方市场：一个 Git 仓库里的 JSON 索引，用户按 URL 添加；索引直接写出每个版本的下载地址、sha256 与 `engines.neurobook`，客户端读一个文件就够。索引与下载地址都能配镜像（国内访问 GitHub 慢）。
4. 发布物：构建好的插件打成压缩包，打包范围同本地安装的 `files` 规则；有 sha256 的来源在安装前校验。
5. 版本与兼容：选 `engines.neurobook` 满足的最新版；插件间依赖范围（`pluginVersions`）照现有 Spec 检查。
6. 更新：第一版全部手动；应用开着时每天检查一次，有更新的插件标出来、一键更新；单个插件可以固定版本；自动更新以后再考虑。
7. 本地改动：装好的插件目录不让改；想改插件里的 Skill 或 Profile 就复制到用户级再改（同 w00032 t05）。更新时发现安装目录被改过只提示一句。
8. 安装确认：完全信任（ADR 0022）；确认框列出发布者、来源、代码仓库链接、插件会贡献什么（服务端代码、Agent 工具、视图、Skill、Profile），并用白话写“插件能访问你的全部作品和这台电脑”；添加第三方市场另有一次警告。
9. 下架：市场有封禁列表（按 id 与版本，写原因）；刷新时发现已安装的版本被封禁，立即停用并通知用户，由用户决定是否卸载（卸载涉及是否删除私有数据，不自动卸）；普通下架只是市场里看不到，已安装的照常用。
10. 单个 Skill 上架：命令行把它自动包成只含这个 Skill 的插件（w00032 t15 的推荐），命令放进 [w00035](../w00035-nbook-cli/README.md) 的 `nbook plugin`。
11. Agent 可以搜索市场、给出推荐；安装要经用户在第 8 条的确认框确认。
12. 不做：付费插件、权限沙箱。签名随官方市场在 w00037 讨论；评分与评论随 w00037 的社区讨论。

## 要讨论的问题

- 从 git 安装时插件要不要预先构建好：推荐要求所选的提交里已有构建产物（同 Obsidian 的 Release 资产），用户机器上不构建；否则要在用户机器上装依赖、跑构建。
- 第三方市场的索引格式与官方市场的接口能否共用一套客户端模型。
- ADR 0022 写“第一版不做插件市场、在线分发、签名”，开工时另写 ADR 修订。

## 调研

[插件市场：Obsidian、VS Code、Claude Code 与其它](../w00032-agent-integration/research/2026-10-30-plugin-marketplace-survey.md)；[各家的 Skill](../w00032-agent-integration/research/2026-10-30-skill-survey.md)第 4 节。

## Task

| Task | 内容 |
|---|---|
| [t01](tasks/t01-design/README.md) | 设计定稿：Spec 与实施计划 |

## 前置

插件 SDK 发布（ADR 0030）之后才有第三方插件，本 Work 排在它之后；官方市场的部分依赖 w00037。
