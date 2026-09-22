---
schema: nbook.task/v2
taskId: t04-foundation-spec-plan
role: leader
---

# 底座两切片规范与整体实施路径

## 目标与授权

在[所属 Work](../../README.md)继续，不新建重复 Work。2026-09-20 开发者接受总体推进方向，明确第一实现切片止于环境适配入口和小内核，第二切片用内置服务插件验证，后续从外部插件作者视角推进 Lab → Files → Settings → World/Plot；要求落 Spec、Work、整体方案与 Task。后续明确决定等 w00003 完成并合并 master 后再考虑从 master 创建 worktree，不继续共享树或检查点分叉。

本 Task 交付文档与本地审查，不执行产品实现、创建 worktree、提交或远端写入。用户的本轮批准足以登记前两片的 planned 目标，不表示已实现、已允许真实数据迁移或热卸载。

## 范围与产物

- 切片一的四项合同：runtime.lifecycle、runtime.services、runtime.plugins、runtime.application（后者限定环境启动/停止与门禁接口，不声称首片已替换整个产品）。
- 切片二的最小真实服务集合：runtime.diagnostics、platform.files、platform.sqlite。身份、配置、Session、Project、Storage、命令、View Host 等随后续真实消费者接入；不在验证地基前先搬完所有应用服务。
- 同一提案原位记录批准范围；Spec 注册表只登记上述七项 planned。既有能力不建“插件版”副本。
- Work README 更新当前范围；`implementation-plan.md` 记录代码边界、验证命令、整体里程碑和 worktree 前提。
- 只登记已知可执行的首个实现 Task；后续子任务在前驱结果核定后生成，规划表不伪造 Task id。
- t02/t03 分别复核机制/资源合同、范围/可执行性与文档治理；新报告 `walkthroughs/foundation-review.md`，保留此前审查。

## 编排与写入边界

Leader 集成 Proposal、索引、Work、实施计划、环境适配 Spec 与下一 Task。可并行委派：机制组独占 lifecycle/services/plugins 三份 Spec；基础设施组独占 diagnostics/files/sqlite 三份 Spec。共同合同：创建中/可用/停止中/已关闭；关闭失败不假报 closed；精确 owner 与代次；消费不获得 provider 关闭权；关闭期已接纳消费者的清理仍可用依赖；单进程内受信插件，无第三方沙箱或在线替换。独立 writer 不运行门禁、不编辑集成 owner 文件。

## 验收与验证

1. 每模块具有九节黑盒合同、稳定 capability、owner、真实批准来源和可观察 smoke 场景，无候选占位、代码实现宣称或第二正文。
2. 实施路径分清模块、文件、依赖、替换点、停止条件和验证证据；首片能在非产品装配下实际运行而非只有类型，第二片真实文件/SQLite，不用 echo mock 冒充 I/O。
3. 外部作者视角验证不等于发布第三方 SDK；实现必须等待 w00003 完成并合入 master，再核实包含治理登记的主线基线，不复制未提交文件或提前从 w00003 分叉。
4. Main 最后统一运行 `bun run docs:check`、本 Task `governance:context`；治理基线已知两项失败保持单独记录，不为再次确认用户/已有报告的失败重跑或修改他人文件。

## 继续条件

完成此文档交付后，首个实现 Task 等待 w00003 完成并合并 master，满足工作登记共同祖先后再落实从 master 创建 worktree；不再询问共享树/检查点分叉选择。当前不实施、不创建worktree、不授权提交、push、合并、数据库迁移、真实模型、浏览器人工验收或删除用户数据；后续普通实现细节由 Tasker 按已批准合同落实。

## 本轮记录

模块规范、整体路径与首个实现Task已完成编写；处理和质量证据见[交付记录](walkthroughs/foundation-resolution.md)、[身份检查](evidences/context-checks.txt)。独立审查与最终文档门禁在该交付记录收口，不借用t01历史绿灯。
