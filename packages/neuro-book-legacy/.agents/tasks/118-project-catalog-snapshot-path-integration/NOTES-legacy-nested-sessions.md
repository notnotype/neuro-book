# 旧布局嵌套 Session 清理记录（Phase 6 前置）

## 背景

`workspace/.nbook/agent/sessions/` 下存在两种物理布局：

| 布局 | 例子 | 数量 |
| --- | --- | --- |
| 平铺（当前） | `sessions/187.jsonl` | 499 |
| 按 workspaceKey 分子目录（2026-05-24 ~ 05-28 的旧布局） | `sessions/novel-7/2.jsonl` | 38 |

`JsonlSessionRepository` 读写 Session 的路径是硬拼的 `sessions/<id>.jsonl`（`server/agent/session/session-repo.ts:919-921`，**不递归**）。因此这 38 份嵌套文件在产品里打不开、列不出、也不会被写入——是磁盘上的死数据，承载的是项目最早期的 sessionId 1–38。

Session schema v2 迁移 runner 的枚举是**递归**的（`scripts/db/agent-session-migration/durable-file.ts:144-160`，注释：「旧分目录同样纳入硬切复扫」），会把这 38 份一并扫入，使 Phase 6 基线从文档记录的 499 / 24 stale 变为 537 / 48 stale。其中 12 份（`novel-6` 1 / `novel-7` 10 / `workspace` 1）的 `workspaceKey` 是裸目录名（如 `novel-7`）而非 `workspace/novel-7`，decoder 要求 `workspace/` 前缀才认 Project 归属（`legacy-decoder.ts:991-998`），会被折叠为无归属的 Workspace Root session。

## 决定

用户拍板：**删除这 38 份**。删除后基线回到 499，与 Task 118 / 115 文档记录一致，且「全库 Session 均为 schema v2」的假设成立，不会在 store 里长期残留未迁移的 v1 文件。

执行方式是**移动而非 rm**，沿用仓库既有先例 `workspace/.nbook/agent/session-backups/task109-test-pollution-2026-07-16T19-02-13.779Z`。

- 来源：`workspace/.nbook/agent/sessions/{novel-6,novel-7,user-assets,workspace,workspace_silver-dragon-hime,workspace_wei-ming-ming-xiao-shuo}/`
- 去向：`workspace/.nbook/agent/session-backups/legacy-nested-2026-07-26/`
- 总量：38 份 JSONL / 2,698,213 bytes
- `workspace/` 在 `.gitignore` 第 42 行，这些文件从不进入 git

## 删除前清单

sha256 取前 16 位。「预测分类」按 decoder 的 `classifyScope` 规则离线推算，仅作删除前存档，不是 runner 实跑结果。

| 目录 | 文件 | sessionId | profileKey | createdAt | bytes | 记录数 | workspaceRoot | workspaceKey | projectPath | 预测分类 | Project |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| novel-6 | 11.jsonl | 11 | leader.default | 2026-05-25T01:57:24Z | 14957 | 19 | workspace | novel-6 | - | workspace_root | - |
| novel-7 | 1.jsonl | 1 | leader.default | 2026-05-24T03:24:25Z | 741 | 2 | workspace | novel-7 | - | workspace_root | - |
| novel-7 | 2.jsonl | 2 | leader.default | 2026-05-24T03:24:42Z | 44265 | 76 | workspace | novel-7 | - | workspace_root | - |
| novel-7 | 3.jsonl | 3 | leader.default | 2026-05-24T04:17:55Z | 741 | 2 | workspace | novel-7 | - | workspace_root | - |
| novel-7 | 4.jsonl | 4 | leader.default | 2026-05-24T05:15:32Z | 259012 | 96 | workspace | novel-7 | - | workspace_root | - |
| novel-7 | 5.jsonl | 5 | retrieval | 2026-05-24T05:16:44Z | 22002 | 16 | workspace | novel-7 | - | workspace_root | - |
| novel-7 | 6.jsonl | 6 | leader.default | 2026-05-24T06:20:51Z | 326473 | 121 | workspace | novel-7 | - | workspace_root | - |
| novel-7 | 7.jsonl | 7 | retrieval | 2026-05-24T06:24:46Z | 27480 | 19 | workspace | novel-7 | - | workspace_root | - |
| novel-7 | 8.jsonl | 8 | leader.default | 2026-05-24T07:57:51Z | 13677 | 18 | workspace | novel-7 | - | workspace_root | - |
| novel-7 | 9.jsonl | 9 | leader.default | 2026-05-24T08:54:18Z | 17214 | 20 | workspace | novel-7 | - | workspace_root | - |
| novel-7 | 10.jsonl | 10 | leader.default | 2026-05-24T08:57:06Z | 59223 | 86 | workspace | novel-7 | - | workspace_root | - |
| user-assets | 12.jsonl | 12 | leader.assets | 2026-05-25T02:11:49Z | 14973 | 19 | workspace/.nbook | user-assets | - | user_assets | - |
| workspace | 13.jsonl | 13 | leader.default | 2026-05-25T02:13:17Z | 21174 | 37 | workspace | workspace | - | workspace_root | - |
| workspace_silver-dragon-hime | 15.jsonl | 15 | leader.default | 2026-05-25T16:16:20Z | 1130652 | 173 | workspace/silver-dragon-hime | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 16.jsonl | 16 | retrieval | 2026-05-26T04:03:53Z | 44446 | 20 | workspace/silver-dragon-hime | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 17.jsonl | 17 | writer | 2026-05-26T04:04:41Z | 23203 | 36 | workspace/silver-dragon-hime | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 18.jsonl | 18 | leader.default | 2026-05-26T04:12:08Z | 789 | 4 | workspace/silver-dragon-hime | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 19.jsonl | 19 | leader.default | 2026-05-26T04:12:24Z | 789 | 4 | workspace/silver-dragon-hime | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 20.jsonl | 20 | leader.default | 2026-05-26T06:11:53Z | 789 | 4 | workspace/silver-dragon-hime | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 21.jsonl | 21 | leader.default | 2026-05-26T10:39:25Z | 78309 | 95 | workspace/silver-dragon-hime | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 22.jsonl | 22 | leader.default | 2026-05-26T12:28:42Z | 18002 | 28 | workspace/silver-dragon-hime | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 23.jsonl | 23 | leader.default | 2026-05-26T12:29:07Z | 18703 | 30 | workspace/silver-dragon-hime | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 24.jsonl | 24 | leader.default | 2026-05-26T14:54:41Z | 336198 | 115 | workspace/silver-dragon-hime | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 25.jsonl | 25 | writer | 2026-05-26T14:56:21Z | 65007 | 16 | workspace/silver-dragon-hime | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 26.jsonl | 26 | leader.default | 2026-05-26T15:41:38Z | 770 | 4 | workspace | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 27.jsonl | 27 | leader.default | 2026-05-26T16:04:56Z | 770 | 4 | workspace | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 28.jsonl | 28 | leader.default | 2026-05-26T16:17:38Z | 770 | 4 | workspace | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 29.jsonl | 29 | leader.default | 2026-05-27T01:49:58Z | 15036 | 21 | workspace | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 30.jsonl | 30 | leader.default | 2026-05-27T11:31:36Z | 390 | 2 | workspace | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 31.jsonl | 31 | leader.default | 2026-05-27T14:06:19Z | 20479 | 30 | workspace | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 32.jsonl | 32 | session.summarizer | 2026-05-27T14:06:33Z | 5548 | 9 | workspace | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 33.jsonl | 33 | session.summarizer | 2026-05-27T15:46:24Z | 23107 | 16 | workspace/silver-dragon-hime | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 34.jsonl | 34 | leader.default | 2026-05-28T03:11:41Z | 19252 | 27 | workspace | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 35.jsonl | 35 | leader.default | 2026-05-28T03:18:21Z | 19739 | 29 | workspace | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 36.jsonl | 36 | session.summarizer | 2026-05-28T03:22:32Z | 5289 | 9 | workspace | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 37.jsonl | 37 | leader.default | 2026-05-28T03:22:36Z | 19811 | 29 | workspace | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_silver-dragon-hime | 38.jsonl | 38 | session.summarizer | 2026-05-28T04:29:48Z | 5232 | 9 | workspace | workspace/silver-dragon-hime | workspace/silver-dragon-hime | stale_managed | silver-dragon-hime |
| workspace_wei-ming-ming-xiao-shuo | 14.jsonl | 14 | leader.default | 2026-05-25T13:55:15Z | 23201 | 22 | workspace/wei-ming-ming-xiao-shuo | workspace/wei-ming-ming-xiao-shuo | workspace/wei-ming-ming-xiao-shuo | managed | wei-ming-ming-xiao-shuo |

含 sha256 前缀的完整机器可读清单见 `.agent/workspace/legacy-nested-sessions.json`（不入 git）。

## 顺带确认的事实

- 537 份 Session 的 `sessionId` 全局唯一，平铺与嵌套之间无冲突（嵌套占 1–38，平铺从 39 起）。
- 537 份 header 全部可解析，0 份损坏。
- `silver-dragon-hime`、`shi-jie-yin-qing-shou-dong-ce-shi`、`shi-jie-yin-qing-fu-xian`、`workspace-files-test-*` 四个 Project 目录已不存在，指向它们的 Session 走 G2 的 `stale_managed` / `current_project_missing` 路径，属既定合同，不在本次清理范围。
