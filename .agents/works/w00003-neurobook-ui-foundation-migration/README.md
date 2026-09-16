---
schema: nbook.work/v1
workId: w00003-neurobook-ui-foundation-migration
issueId: i191
---

# NeuroBook UI Foundation Migration

把 NeuroBook 主应用 UI 底座迁移到 monorepo 内的 `@notnotype/nb-ui`，先固定当前消费边界、迁移切片与真实 UI 验收合同，再逐片删除主应用重复实现。

## 当前迁移路线

开发者于 2026-09-03 决定后续采用 **Lab-first replacement**，取代此前“每批组件立即接入主页”的执行顺序：

1. 新组件在 `packages/nb-ui` 或其领域 owner 中实现，只消费 nb-ui 语义 token；组件不得通过 `isLab`、路由或旧主题变量区分宿主。
2. 每个组件先在 NeuroBook Component Lab 完成同名文档、确定性 fixture、状态与关键交互、键盘/焦点/ARIA、桌面和 `390 × 844` 验证，达到 `Lab-ready`。
3. 第一个真实界面由开发者与 Agent 协作迁移，逐步记录边界识别、宿主依赖上移、主题适配、fixture、验证、失败与踩坑；该记录成为后续批次的输入，不预先假定所有组件步骤相同。参考实现：Agent Profile 设置页（t15），配方与坑表见 [t13 walkthrough 002](tasks/t13-lab-first-migration-strategy/walkthroughs/002-trial-migration-gold-standard.md)。
4. 协作试迁移闭合后，Leader 按实际依赖拆分可独立验收的 Agent 自主迁移批次。Agent 自行查明代码、规范和测试可回答的事实；无法消除的产品取舍与风险逐项记录并请求开发者决定。
5. 目标组件达到 Lab-ready 后，再创建 C 产品 `theme.system` clean cutover Task。C 让主页面成为 nb-ui 主题的合法宿主，但不以 Lab 主题状态代替产品配置、首帧和失败合同。
6. C 闭合后按消费者批次把主页接到新组件，恢复真实功能、构建、typecheck、测试和产品 surface 验收；全部消费者切换后删除旧组件与旧主题 authority。
7. 最后对当前 merge revision 集合统一审查。Lab smoke 不能代替主页面、桌面、窄屏和 Product 构建证据。

## Workbench 外壳接入（#192）

Workbench 与 View Host 提案 [`workbench-view-host.md`](../../../packages/neuro-book/docs/proposals/workbench-view-host.md)（#192）已于 2026-09-13 获批 `accepted`。
[t20](tasks/t20-workbench-shell-adoption/README.md) 已有外壳、标题栏 Chrome 与部件 Lab 的实现和历史验收记录，不能再称 pending；
完整消费者等价与真实主页面闭环仍未完成，[ui.workbench-shell](../../../docs/specs/ui/workbench-shell.md) 保持 planned。
后续 Storage、浏览器标题栏与迁移清单按下面的当前计划推进；未迁消费者仍遵守提案的删除门禁。

## Storage 设计审查

开发者于 2026-09-15 要求先审查 Storage 设计，再沉淀符合当前需求的 Spec。
[t21](tasks/t21-storage-design-review/README.md) 负责审查与文档；2026-09-16 开发者同意补充计划。
当前合同为 [storage.boundaries](../../../docs/specs/storage/boundaries.md)、[storage.persistence](../../../docs/specs/storage/persistence.md)
与 [ui.nested-grid](../../../docs/specs/ui/nested-grid.md)，均保持 planned。
[实施计划](storage-implementation-plan.md) 固定依赖、切片、迁移与验收。
Spec 与治理已单独提交为 `44710392`；开发者授权后已建立实现 goal，由 [t22](tasks/t22-storage-core/README.md) 开始服务核心增量。
实现与各验收逐项推进，旧键迁移尚未执行；局部增量完成不代表全部 capability 已实现。
开发者随后将本轮收口缩为核心底座修复、验证与本地提交；余下集成按 handoff 技能在系统Temp交接，不要求本轮完成全部六切片，也不据此晋升planned能力。
服务核心 t22 已提交 `dfc5df82`（86 个聚焦用例、包含新入口的 typecheck 通过）；
宿主身份 [t23](tasks/t23-storage-host-identity/README.md) 已提交 `3b8d87fb`（149 用例、主应用 typecheck、普通 HTTP Chrome smoke 通过，独立复核不阻断）；
user 受管句柄与 HTTP 值读写 [t24](tasks/t24-storage-user-http/README.md) 已提交 `8b1229ea`，
[t25](tasks/t25-storage-http-review/README.md) 完成独立审查及 HMR 追加复核，无阻断项；
[t26](tasks/t26-storage-browser-adapter/README.md) 已实现浏览器分区绑定、值适配器和订阅，真实 Chrome 值 smoke 与最终主应用 typecheck 通过；
[t27](tasks/t27-storage-adapter-review/README.md) 发现读取超时缺陷，修复后追加复核建议合并。
切片 1 已提交 `42d65b7c`；[t28](tasks/t28-project-ready-publication/README.md) 实现 Project 精确 ready 发布与 presence 配对，
30 文件 215 用例与主应用类型检查通过，[t29](tasks/t29-project-ready-review/README.md) 独立审查建议合并；
t28 已提交 `0d66064b`。[t30](tasks/t30-project-storage-host/README.md) Project Storage lazy module 与宿主访问已提交 `7e1fe94d`，
包含物理复核、HMR与关停排空补修；[t34](tasks/t34-project-storage-review/README.md) 最终独立150用例通过、1跳过并建议合并。
[t31](tasks/t31-storage-file-boundary/README.md) 文件保护与资产同步、[t32](tasks/t32-storage-archive/README.md) 归档已由
[t33](tasks/t33-storage-file-archive-review/README.md) 追加复核建议合并；最后 CLI parse/递归修复保护及类型检查通过，已提交 `6d644059`。
[t35](tasks/t35-storage-project-browser/README.md) 浏览器 Project 适配已提交 `70c7168d`，
[t36](tasks/t36-storage-project-browser-review/README.md) 独立 76 用例通过、建议合并，主 Agent统一类型检查通过。
切片2的服务/适配器与磁盘接线已闭合；有效宿主上下文替代旧 `resolveViewStateLayer(projectRoot)` 的消费接线，
随切片3插件样例一起验证，当前该旧函数只有测试调用，尚未被产品Storage消费。
切片3的核心增量已闭合：[t37](tasks/t37-grid-geometry/README.md) 完成两轴几何、快照与Shell/Spike消费，
[t38](tasks/t38-splitter-gestures/README.md) 完成用户手势边界；t39/t41最终独立复核建议合并。
最终[核心验证](storage-core-validation.md)：主应用类型检查与142聚焦用例、nb-ui类型检查/350单测/48浏览器用例通过，CSS连续构建一致。
完整插件持久化宿主、原件合成、旧键迁移与主页面/标题栏仍交接后续；隐藏editor的公开API边界问题已登记，不影响当前主页路径。
[t40](tasks/t40-workbench-storage-context/README.md) 并行消费已验证的Storage接口，实现不依赖grid的工作台上下文与插件内存样例。
该核心已提交 `7a5d04de`，Leader独立94用例通过，t42最终复核另有9个探针通过并建议合并；消费文档已说明切换等待、目标与可用状态的区别。
[t41](tasks/t41-grid-consumer-review/README.md) 独立复核grid与真实消费者，变动中的版本需收口后追加确认。
[t42](tasks/t42-storage-context-review/README.md) 独立复核工作台Storage上下文与插件样例的生命周期和失败清理。
[t43](tasks/t43-project-storage-browser-smoke/README.md) 补齐已提交Project适配器的真实浏览器/HTTP/磁盘验证。
第二稿按 [Leader返工要求](tasks/t43-project-storage-browser-smoke/walkthroughs/leader-rework-requirements.md) 闭合 R1–R9：
根内持久profile与cache、同客户端跨Project隔离、`project/shared` 定义、生产地址/身份入口推导的精确磁盘断言、
槽级资源生命周期、根归属校验与全阶段失败清理。Leader独立复跑 exit 0、findings `[]`、清理 10/10，已提交 `2cfc871d`；
证据见 [返工证据](tasks/t43-project-storage-browser-smoke/walkthroughs/rework-evidence.md) 与 `evidences/`。
[t44](tasks/t44-plugin-grid-storage-host/README.md) 实现插件grid持久化宿主 `app/utils/workbench/storage-grid-host.ts`：
快照v2恢复、原件合成保存、手势单次提交、订阅基线更新、CAS冲突重放与重试/放弃出口、释放排空；
17聚焦用例与主应用typecheck通过，已提交 `5fcdf8b8`。
[t45](tasks/t45-nested-grid-lab-fixture/README.md) 提供Lab静态确定性嵌套fixture与四主题/桌面/390×844浏览器验收；
[t46](tasks/t46-checkpoint-a-review/README.md) 独立审查公共类型、身份、生命周期与插件消费（检查点A）。
首轮裁定需修复（P2 重放无落点误报 `saved` 并清未确认意图、P3 release 后 open 仍读取、观察 1a），
已回 t44 修复（`1f1942c3`，聚焦 20 例）；追加复核逐项复现闭合、G1–G4 相邻路径全绿，**建议合并**，
证据见 [审查记录](tasks/t46-checkpoint-a-review/walkthroughs/review.md) 与 `walkthroughs/probes/`。检查点 A 关闭。
切片 4 已启动：[t47](tasks/t47-legacy-state-migration/README.md) 迁移门禁与原件保护（浏览器暂存早于旧 writer、迁移期冻结三字段、
`workbench.migration` 分块原件备份、逐项条件导入、进度/完成标记、状态可观察）已提交 `8263726e`，
Leader 复跑 4 文件 49 例、相关测试域 12 文件 139 例与主应用 typecheck 均通过；
[t49](tasks/t49-migration-review/README.md) 独立审查与 [t48](tasks/t48-workbench-layout-authority/README.md) 主工作台接线并行进行。
开发者已有 `http://localhost:3001/` 后台服务，后续验收不占用、复用、重启或关闭它；
产品验收显式使用系统Temp内独立State Root、Workspace Root与浏览器数据目录，以及其它空闲端口。
命令系统、跨独立 data 在线同步、桌面多窗口和 World Engine/Agent Chat Flow 整页接入继续单列。

## 红分支边界

- 允许出现的红色只限 NeuroBook 主应用仍未接入新组件的消费者路径：主页真实流程、主应用 Product build/typecheck 或由该未接线直接导致的主应用集成检查失败。每项必须记录命令、cwd、路径、错误原文、引入批次和恢复条件。
- `packages/nb-ui` 自身的 build、typecheck、测试与 E2E；NeuroBook Component Lab 的聚焦测试、Lab smoke；以及 Product 排除门禁必须保持绿色。它们失败时不得归因于“主页未接入”，当前批次不得宣称 Lab-ready，必须定位并修复或停止交付。
- 红色中间 revision 不得 push、提 PR、合并、发布、部署或声明 Work 完成。不得损坏数据库、Project Workspace、Session、用户文件或其它产品数据。
- 每个组件仍须独立达到 Lab-ready；主应用集成失败不能放宽组件、nb-ui、Lab 或 Product 排除门禁。t09 `LabShell.vue` 拆分继续延期；命中其 Leader walkthrough 的恢复触发条件时必须先恢复 t09。

## 下一阶段触发条件

- 当前只创建一个协作试迁移 Task；候选界面、开发者参与点和验收边界由该 Task 固定。
- 批量自主迁移 Task 只在试迁移闭合、步骤与不确定项已形成证据后创建。
- C 只在已批准的目标组件集合达到 Lab-ready 后创建；创建前仍须把同一个 `docs/specs/theme/system.md` 从当前旧系统的 `implemented` 原地改为目标合同的 `planned`。
