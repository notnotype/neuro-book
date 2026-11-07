---
schema: nbook.work/v1
workId: w00042-image-generation
issueId: null
status: active
updated: 2026-11-06
---

# 图像生成插件

## 目标

给 NeuroBook 做文生图插件：提示词工作台（用户抽卡、Agent 检索与校验、预设与模块）、文中插画、人物设计与资产版本、局部重绘。工作台耦合最低、最常用，界面最重要，最先做。

主要后端是 NovelAI 与 ComfyUI（Danbooru 标签式提示词）；gpt-image、nano banana 这类自然语言模型以后接。

## 决定

| 日期 | 决定 |
|---|---|
| 2026-11-06 | 开发者：讨论先于实现，工作台最先做 |
| 2026-11-06 | 开发者：图像等模型不再都集中到 `nbook.models`，分开。主会话建议按媒介各设一个门面、凭据共用，文本与决策留在 `nbook.models`，嵌入、视频、语音用到时再建，开发者未反对。这改的是[平台提案](../../../docs/proposals/extensible-application-platform.md)里“按能力都由 `nbook.models` 提供”的设想 |
| 2026-11-06 | 开发者提出把凭据与 OAuth 登录抽成插件共享；第一版只用 API 模式的文生图。主会话建议第一版就抽 `nbook.credentials`，只做 API Key，见 [t04](tasks/t04-credentials-plugin/README.md) |
| 2026-11-06 | 开发者：写手的 `<image-gen prompt="…"/>` 只写 prompt，不写意图与角色引用（写手有本章上下文，但没有精确的角色 id）；prompt 交给专门的生图 Agent 或管线，写手专心写作，见 [t10](tasks/t10-generation-pipeline/README.md) |
| 2026-11-06 | 开发者：接受后用稳定 id 的 `<image-generated id="…">`，不用标准图片语法，否则换一版就要改正文。主会话建议补一个 `alt`，开发者未答复，见 [t09](tasks/t09-markdown-dialect/README.md) |
| 2026-11-06 | 开发者：NovelAI 专属标签不单独成层，官方文档已经整理好（[Special Tags](https://docs.novelai.net/en/image/tags#special-tags)），并入标签库基础层，见 [t05](tasks/t05-tag-library/README.md) |
| 2026-11-06 | 开发者：成人标签不隐藏，不做分级开关。主会话保留一条：涉及未成年人性内容的标签在构建词库时去掉，这是构建时的排除名单，运行时没有逻辑，这类内容主会话不做进去 |

## 调研

- [标签来源、NovelAI 能力与法典图鉴](research/2026-11-06-tag-sources-and-novelai.md)

## 顺序

| 顺序 | Task | 内容 | 前置 |
|---|---|---|---|
| 1 | [t01](tasks/t01-research-decisions/README.md) | 调研与初步决定 | — |
| 2 | [t02](tasks/t02-backend-probe/README.md) | 后端接入探测，定首发后端 | 开发者提供令牌或 ComfyUI 地址 |
| 2 | [t03](tasks/t03-core-contracts/README.md) | 提示词与配方合同 | t01 |
| 3 | [t04](tasks/t04-credentials-plugin/README.md) | 凭据插件 | t01 |
| 3 | [t05](tasks/t05-tag-library/README.md) | 标签库 | t03 |
| 3 | [t06](tasks/t06-image-backends/README.md) | 生成后端与任务 | t02、t03、t04 |
| 3 | [t07](tasks/t07-prompt-workbench/README.md) | 提示词工作台，静态稿可以先出 | t03、t05、t06 |
| 4 | [t08](tasks/t08-agent-tools/README.md) | Agent 工具 | t05、t06 |
| 5 | [t09](tasks/t09-markdown-dialect/README.md) | 插图方言与图片版本 | t06 |
| 5 | [t10](tasks/t10-generation-pipeline/README.md) | 生图管线 | t08、t09 |
| 6 | [t11](tasks/t11-character-visual-profile/README.md) | 角色视觉档案 | t10、w00039 内核合入 |
| 6 | [t12](tasks/t12-image-editing/README.md) | 局部重绘与图像编辑 | t06、t07 |

## 待定

- **决策模型：** 开发者说的“决策模型”具体指什么；如果只是拿 LLM 做判断，它是一个角色，不用拆插件。不影响第一版。
- **首发后端：** 主会话推荐 NovelAI，取决于 [t02](tasks/t02-backend-probe/README.md)。
