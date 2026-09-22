---
schema: nbook.task/v2
taskId: t01-architecture-proposal
role: leader
---

# 架构提案与规范归属

> 历史交付合同：本Task及其证据对应首轮/B/S追加设计，以下“本轮”“reviewing”“不晋升Spec”均描述当时范围，不是当前Work状态。2026-09-20后续已批准基础切片规范规划，由[t04](../t04-foundation-spec-plan/README.md)承接；当前状态以[Work](../../README.md)为准，产品实施等待w00003完成合并master。

## 目标与交付

在[所属 Work](../../README.md)授权内，将已确认方向落实为一份可独立阅读、可评审的[总体提案](../../../../../packages/neuro-book/docs/proposals/application-runtime-and-plugins.md)，包含能力地图、生命周期矩阵、内置插件划分与验收/迁移策略。更新根 Proposal 索引和 Spec 缺口入口，不修改产品实现。

## 当前依据与边界

- 主工作区 `master` / HEAD `45906272915ff43e83318653af62afa9ce668206` 是本轮文档基线，包含他人未提交改动。
- 前序现状调查的实现基准是 `.worktree/w00003-neurobook-ui-foundation-migration` / `refactor/w00003-nb-ui-adoption` / HEAD `26479d48604d3882b8d42b9f4447c6e3f4ac69c4` 加共享未提交改动。命令、View 与 Storage 现状不能回填成主树事实。只保留与设计有关的源码观察，不复制实现代码或重跑旧验收。
- 用户已接受必需服务插件、首批不任意热卸载、dirty/在途关闭协商与后台资源独立，以及 Lab → Files → Settings 顺序；进一步要求生命周期划分、代码模块规划、B/S 示踪链、WorldEngine/Plotbench 接入与热卸载扩展评估。
- 本轮仅继续设计和记录批准，具体状态、模块边界与热卸载方案尚待评审；`reviewing` 不作为当前行为或产品实施授权。代码可改造不意味着用户数据和在途操作可被丢弃。

## 步骤与产物

1. 以仓库现有治理为唯一入口，核对资料来源、术语、权限与证据成熟度。
2. 编写提案：限定小内核、显式 DI、内置插件装配，分离运行位置、资源作用域、激活与数据归属。
3. 用多窗口、Project 重开、部分激活失败、停机、后台任务和 Lab 场景检验矩阵；明确错误、取消与关闭失败不能伪装完成。
4. 给出能力依赖图、未来 Spec 归属、插件提供/消费能力与迁移顺序；不把每个组件/函数改名为插件，不承诺第三方沙箱。
5. 更新 `docs/proposals/README.md` 和 `docs/specs/README.md`，独立语义审查完成后修复问题，执行文档与治理检查。
6. 叙事及审查处理记录写入 walkthrough，原始质量输出按需归档到 evidence。

## 验收

- 总体架构、能力地图、生命周期划分、模块代码布局、B/S Tracer Bullet 与内置插件划分均有正文；热卸载评估、已确认方向与推荐/待决合同可区分；reader 无需阅读源码才能判断主要取舍。
- 能力边界不重复；关闭、失败、跨进程、依赖寿命、认证/授权与持久化归属没有被一个通用 `active` 或 `dispose` 混同。
- 文档有可解析入口、明确质量矩阵和旧合同影响清单；没有虚构实现证据或提前晋升 Spec。
- 运行 `bun run docs:check`、`bun run governance:check`、`bun run governance:context -- --work w00017-application-runtime-architecture --task t01-architecture-proposal --role leader`，分别记录结果；不因本轮纯文档修改运行产品测试或浏览器。

## 开发者参与与继续条件

本次授权足以继续文档和本地审查；不重复提问已批准三项。新增生命周期/模块/分层设计先供审阅，再按确认范围沉淀 Spec；外部兼容、数据变更与产品实施仍须独立批准。不等待远端 Issue，也不请求无必要的产品执行权限。

## 交付记录

首轮总体设计集中于总体提案，Proposal/Spec 索引已登记。首轮修订与证据见[审查处理](walkthroughs/review-resolution.md)和[质量检查](walkthroughs/quality-baseline.md)。追加设计另见下文。当前交付不使提案 accepted，不改变任何现行产品合同；下一阶段的 Spec 与实施仍遵循上述参与边界。

追加交付须能不读源码回答：B/S 各阶段由谁启动什么、依赖何时 ready、谁负责关闭；config/项目列表不打开 Project 的条件；Grid/View 如何接收描述与创建实例；WorldEngine/Plotbench 的配置、工具、数据库及文件资源如何声明与取得；移除可选插件和未来热停用会影响谁。代码路径为候选规划而非已存在实现。

追加设计记录：[B/S 示踪链与插件分层修订](walkthroughs/tracer-design.md)，包含核实源码、主树/共享树边界和调查纠正；本轮不运行旧命令面板验收。

追加交付的独立复核与治理/文档门禁记录见[本轮审查处理](walkthroughs/tracer-resolution.md)，其中明确保留错误审查前提的纠正与原有治理失败。本轮无独立提交 revision，不晋升 Spec。
