---
schema: nbook.task/v2
taskId: t33-plugin-skills
status: planned
updated: 2026-11-10
---

# 插件的 Skill 与 SDK 构建

## 目标与范围

插件经贡献点 agent.skills 带上 Skill 目录；插件 SDK 的构建把每个 Skill 的脚本连同 npm 依赖打成单文件，打不进的构建失败并说明原因（t15 第 7 条，2026-11-10 从 t15 拆出）

合同：开工时定；`agent/skills.md`（t15 新建）加插件来源，`agent/contributions.md` 加贡献点 `agent.skills`，插件 SDK 的构建 Spec 加 Skill 打包。

来源：[t15](../t15-skills/README.md) 第 7、9、20 条；[t10](../t10-agent-plugin/README.md)“后续修改”里构建预设的那条。

## 当前状态

2026-11-10 从 t15 拆出，尚未开工。

## 下一步

t15 合入之后开工：贡献点（声明 `{directory}`）、目录服务加插件来源、`nbooke build` 打包每个 Skill 的脚本与依赖、打不进单文件时构建失败并说明原因（原生模块、运行时读包内数据文件、Python 脚本）。
