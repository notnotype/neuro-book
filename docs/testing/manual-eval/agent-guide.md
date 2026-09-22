# Agent 执行手册（agent-guide）

> 给 Agent 看的评测执行流程。触发方式与用户侧约定见 [README.md](README.md)；判定口径与证据要求见 [criteria.md](criteria.md)；报告格式见 [report-template.md](report-template.md)；检查项见 `journeys/` 目录。

## 1. 执行边界

- **不自动发起评测**：只有收到用户触发指令（README 的提示词模板，或用户自定义范围）才执行。
- 评测过程**不改业务代码、不清理用户数据、不合并/关闭 PR**。
- 需要真实 Project / 真实数据（真实 World Engine Project、已有 Session）时，先征得用户允许；否则用隔离 State Root + 临时 Project。
- 真实 provider 不可用时如实标「未验证」，**不伪造结果**；未验证项不得用 focused 测试或静态分析结果冒充浏览器证据。

## 2. 执行流程

2. **准备环境**：隔离 State Root（`NEURO_BOOK_STATE_ROOT` 指向系统 Temp 下的 NeuroBook Agent 受控目录），Source Dev 用独立端口、创建临时 Project（Task 141 惯例：先执行 `bun run migrate:application-state -- --apply`，再起实例）。记录环境信息，填入报告「环境」节。
3. **逐旅程走查**：按 `journeys/<旅程>.md` 逐检查项操作（操作 / 预期 / 通过判据 / 失败形态），按 [浏览器工具选择](../README.md#浏览器工具) 与真实页面交互。
4. **收集证据**：快照、截图（含窄屏 390×844）、console、requests、video、文件系统旁证；具体命令与用途见 criteria.md 第 5 节。临时证据放系统 Temp，current 正式脱敏证据放 `.agents/works/<work>/tasks/<task>/evidences/`；legacy Task 继续写原 evidence 目录。
5. **初判**：按 criteria.md 判定类别（通过 / 部分通过 / 未验证 / 环境阻塞 / 发现问题）与严重度（P0 / P1 / P2 / 观察项）；每条问题按条目格式（场景 → 影响 → 证据 → 原因 → 位置 → 置信度）。
6. **出报告**：按 report-template.md 产出；满足 README 的收尾标准（P0 澄清、P1 清单、未验证注明原因）。
7. **复核与去向**：报告交给用户复核；用户确认后的问题才按 CONTRIBUTING 建 Issue（必须加 `source: agent` 标签）。

## 3. 常见约束（踩坑点）

- 浏览器加载超时不直接归因业务逻辑，记录为环境阻塞（Task 141 先例：此前 `localhost`/浏览器时序曾出现导航超时和空白页，不当作产品缺陷）。
- 无法稳定复现的边界（中文 IME composing Enter、图片 metadata 失败、32 MiB 预算超限）标「未验证」，不用 focused 测试替代。
- 窄屏检查（390×844）结束后恢复默认视口。
- 每个旅程给出旅程级判定（通过 / 部分通过 / 未验证 / 环境阻塞），检查项级判定逐项记录在报告表格。
- 真实模型驱动的场景（Skill 初始化、章节写作、Composer 停止/恢复、Workflow 多 Run）没有真实 provider 时一律标「未验证」，不写「通过」也不写「失败」。
