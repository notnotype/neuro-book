---
schema: nbook.work/v1
workId: w00021-smart-ime-spike
issueId: null
---

# 智能输入法 Spike

为写作场景做一个「智能拼音输入法 + 编辑器」的独立 spike：编辑器知道正在写什么，能边写边提取专名入词库、用上下文给候选排序、语音输入后只做纠错。spike 不集成进 NeuroBook，也不依赖其运行时；只留一个写作上下文接口，等 w00017 等重构完成后再评估接入。

执行位置：`.worktree/w00021-smart-ime-spike`，分支 `feat/w00021-smart-ime-spike`。主树本目录是占号副本，进度只在实现 worktree 维护。

## 已定决策（开发者，2026-10-01）

- 输入法形态先做应用内（方案 A）：编辑器自带拼音引擎，系统输入法需切到英文；系统级接入（方案 B）以后再议。
- spike 是可脱离 NeuroBook 的独立产品形态：独立编辑页 + 输入法，可在 monorepo 新建 package。
- 专名词库 spike 自建，不接 NeuroBook；重点验证「写起来舒不舒服」与边写边自动提取实体。
- 上下文候选重排评估 TypeSafe Jev（System One 判断模型，只做 Choice/Score/Noul，不生成文本）；密钥在仓库根 `.env` 的 `TYPESAFE_API_KEY`，不进 Git。
- 语音输入后只纠错、不润色；纠错用 deepseek-flash 这类 flash 生成模型，不用 Jev。
- 先设计和调研，拼音解码方案需讨论后再实现。

## 参考源码

开源输入法参考仓库只读克隆在 `~/CodeRepository/ime-refs/`，不进本仓库。

## Tasks

- [`t01-design-and-research`](tasks/t01-design-and-research/README.md)：需求、功能边界、拼音解码方案、重排与纠错链路的调研和待裁决清单。
