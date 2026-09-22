# 架构审查修订记录

## 范围

本轮为架构提案交付，不执行产品重构。正文为 `packages/neuro-book/docs/proposals/application-runtime-and-plugins.md`；能力地图、生命周期矩阵和内置插件表是同一份提案的章节。Proposal 保持 `reviewing`，未创建 `planned` Spec。

## t02 运行时合同初审

独立报告：[运行时合同审查](../../t02-runtime-contract-review/walkthroughs/review.md)。初审提出三个问题，Leader 按以下方式修订：

| 项目 | 处理 | 原因与边界 |
|---|---|---|
| F1：消费列混合低层文件能力和 workspace-files，可能形成 Project 装配环 | 增加 `platform-resources` 与 `session-persistence`；统一用插件 id、宿主能力、精确资源绑定描述依赖；明确 Files 链方向；功能组不是最终 manifest | Project 必需的低层文件/数据库能力不能来自依赖 Project ready 的业务服务。没有采纳“adapter/运行期绑定不参与环检测”的修正建议：适配器仍是 provider，运行期等待仍入图，避免隐藏循环 |
| F2：拒绝装配的作用对象不明 | 冲突隔离全部冲突声明；缺依赖/环阻断受影响闭包，闭包含必需能力才阻止应用 ready | 明确可选能力局部失败与应用门禁的关系；不按登记顺序随意选 provider；验收矩阵同步修订 |
| F3：运行实例级租约无 owner | 明确 `session-persistence` 拥有 Session Store 租约；获取失败阻止 Product 接纳业务；消费者结束后释放；失效走领域停机 | 查阅 `docs/specs/agent/session-store-lease.md` 后拒绝把建议直接写成“整个 State Root 的强互斥锁”。现有合同保护 Workspace Root 下 Session Store 的协作写入，明确存在 advisory stale 窗口；没有新增 fencing 承诺 |

以上是 Leader 集成结果；独立复核结论留在 t02 原报告后续章节，不覆盖初审历史。首批 Files 链明确把 Session Store 租约作为 Product 门禁，而不是让 Project 服务依赖 Agent Session 数据。

## 文档事实修正

- 修订日期标为 2026-09-20；人类授权发生时间不凭空推断，决策表写“本轮对话”。
- 主树文档基线与 w00003 未提交实现调查分别标注；不宣称主树具备共享树的全部 Command/View/Storage 实现。
- 未运行任何产品测试、typecheck、build、浏览器、真实 Provider 或迁移。门禁与既有失败单独记录在[质量基线](quality-baseline.md)。

## t02 定向复核与 t03 文档审查

- t02 原 Reviewer 定向复核 F1–F3 全部闭合；唯一 P3「最小启动输出」缺 `宿主：` 前缀也已修正，并由其消息确认。原报告保留初审和复核，不回写历史初审为无问题。
- t03 [独立报告](../../t03-document-governance-review/walkthroughs/review.md)未发现阻断交付问题，提出三条具体建议，Leader 已全部集成：D5 与 Spec 改动表标明五个 tab 合同在 w00003；保留清单明确元素/检查器；增加 Desktop/安装与 runtime.application 的边界，并同步根 Spec 缺口行。
- t03 自动最终结果因 `overall_correctness` 等字段重复聚合成数组而 schema 校验失败；完整 Markdown 报告已成功落盘并由 Leader 读取。审查证据取该报告，不把工具的 job failed 冒称结构化校验通过，也不丢弃已完成的独立审查。异常已报告工具 QA。
- t03 三处文字修正由 Leader 集成确认，未另声称原 Reviewer 再做一轮完整审查。所有审查结论均不代表人类 accepted 或产品实现通过。
