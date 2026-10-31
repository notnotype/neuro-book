---
schema: nbook.task/v2
taskId: t11-project-layout
status: planned
updated: 2026-10-31
---

# 项目文件结构

## 目标与范围

定新版作品目录长什么样：正文、设定、剧情、资料、派生数据各放哪，目录叫什么。

合同：讨论 Task，只定设计，行为合同未变；定稿后的 Spec 改动在实施时另定。

前置：t09、t10。

## 要讨论的问题

1. 顶层目录：`manuscripts.binder/`、`lorebook.content/` 已在 Spec 里约定；剧情、资料、大纲、灵感要不要固定目录。
2. 目录名用英文还是中文、是否可以由用户改名（插件靠什么找到设定目录：固定名、后缀、`project.json` 登记）。
3. `.nbook/` 里放什么：身份、启用的插件、派生数据、缓存；哪些进 Git、哪些忽略。
4. 旧版项目里的 `AGENTS.md`、`agents/`（Profile 记忆）、`manual/`、`reference/`、`upload/` 在新版还要不要；Profile 已放到状态根（w00032 t05），项目级 Agent 指令放哪。
5. 封面、插图、立绘等图片资产放哪。
6. 一部作品多卷、多部（接 t24）时的目录形状。

材料：[调研：四、六节](../../research/2026-10-31-repo-survey.md)；[`workspace/folder-kinds.md`](../../../../../docs/specs/workspace/folder-kinds.md)；[项目文件底座](../../../../../docs/proposals/project-file-foundation.md)。

## 当前状态

2026-10-31 由 t01 问题发现建为草稿，尚未讨论。

## 下一步

按 Work README 的讨论顺序轮到时讨论；讨论定的事写进本 README 的“当前状态”。
