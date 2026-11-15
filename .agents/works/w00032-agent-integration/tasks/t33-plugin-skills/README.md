---
schema: nbook.task/v2
taskId: t33-plugin-skills
status: active
updated: 2026-11-15
---

# 插件的 Skill 与 SDK 构建

## 目标与范围

插件经贡献点 agent.skills 带上 Skill 目录；插件 SDK 的构建把每个 Skill 的脚本连同 npm 依赖打成单文件，打不进的构建失败并说明原因（t15 第 7 条，2026-11-10 从 t15 拆出）

合同：开工时定；`agent/skills.md`（t15 新建）加插件来源，`agent/contributions.md` 加贡献点 `agent.skills`，插件 SDK 的构建 Spec 加 Skill 打包。

来源：[t15](../t15-skills/README.md) 第 7、9、20 条；[t10](../t10-agent-plugin/README.md)“后续修改”里构建预设的那条。

## 决定

| 编号 | 日期 | 决定 |
|---|---|---|
| 1 | 2026-11-15 | 开发者：t30 之后开 t33 |
| 2 | 2026-11-15 | 开发者确认[计划](plan.md)，末尾 6 个待确认项全部按推荐：一个贡献声明一个装着若干 Skill 的目录；Skill 文件夹里全部 JS/TS 文件都打包；打包后保留原路径与文件名；Python 脚本只在带第三方依赖时构建失败，只用标准库的原样带上；Skill 页分组为我的、各插件、内置；插件 Skill 里有 `package.json` 时标无效 |
| 3 | 2026-11-15 | 开发者：用 autonomous-delivery 推进到 Task 完成 |

## 当前状态

2026-11-15 开工。调研了插件构建、清单与贡献点、安装目录，用十个常用 npm 包做了打包实验；[计划](plan.md)已获开发者确认（决定 2），下一步是设计审查（后端 omp）。

## 下一步

设计审查处理完后开 worktree `.worktree/w00032-t33-plugin-skills`（分支 `feat/w00032-t33-plugin-skills`），按计划切片实施。
