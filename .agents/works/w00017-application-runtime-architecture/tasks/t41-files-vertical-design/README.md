---
schema: nbook.task/v2
taskId: t41-files-vertical-design
---

# Files 竖切需求讨论与设计稿

## 目标与范围

阶段 1 完成后（[t40](../t40-phase1-closing/README.md)），开发者要求阶段 2 的 Files 竖切先讨论、重新设计并划定需求，要解决实际使用中的问题（打开项目要等全量预读、切换文件约 0.3 秒延迟），用起来要和本地 IDE 一样流畅；并把 `nbook.platform-files`、`nbook.project` 视为项目底座，用 History、剧情、Agent 文件工具、用户资产等依赖方检验其扩展性。

本 Task 只做需求讨论与设计稿，不改产品代码、不改 Spec。行为合同未变：设计稿接受后再按其“对 Spec 的预期改动”修订 [`workspace.files`](../../../../../docs/specs/workspace/files.md)、[`workbench.files-explorer`](../../../../../docs/specs/workbench/files-explorer.md) 等并开实施 Task。

## 当前状态

2026-10-02 需求讨论完成，设计稿 [项目文件底座与 Files 竖切](../../../../../packages/neuro-book/docs/proposals/project-file-foundation.md) 为 `reviewing`。

讨论采用一问一答（每问附主 Agent 的猜测），开发者逐条确认或修正。开发者的关键修正：

- 剧情篇章不采用“文件树即编排加 frontmatter id”，改为开发者提出的活页夹：`manuscripts.binder/` 加清单，编号即稳定 id（`chapter://1`），编排只看清单。
- 普通文件没有稳定身份，也没有“被引用、改名要跟着更新”的需求；只有活页夹特殊。
- 文件夹分三类（普通、内容、活页夹），内容文件夹用清单模式而不是子目录 frontmatter；类型以文件夹名后缀识别（普通模式无法感知目录内文件），清单用 XML（层级深时比 YAML 清楚）。
- 迁移只写在项目迁移脚本里，业务代码保持干净；路径迁移（`lorebook/` → `lorebook.content/` 等）的代价已接受，但属后续重构，不在主线。

确认的成功标准、范围与分项决定见设计稿的“目标与非目标”与“分项决定”两节。

## 下一步

开发者评审设计稿中的技术方案部分；接受后修订相关 Spec，按切片开实施 Task（实施前补一次 VS Code 文件服务与资源管理器的针对性源码调研）。
