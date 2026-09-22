# B/S 示踪与插件分层：本轮审查处理

## 交付边界

修订原提案，不新增平行架构正文。三项已批准取舍统一标识 A1–A3；新增状态、门禁、模块布局与热卸载机制仍为 `reviewing`。本轮独立报告使用 `tracer-review.md`，不复用首轮 review.md 作为新设计通过证据。

## 文档与读者审查

原报告：[t03 第二轮](../../t03-document-governance-review/walkthroughs/tracer-review.md)。Reviewer 未发现阻断交付/批准的问题，提出五项精度与一致性问题；结构化结果以 `incorrect` 表达需要修正，不将其改写成首遍无发现。

| 发现 | Leader 处理 |
|---|---|
| 三项批准未枚举 | 状态与决策记录统一 A1–A3；已有确认方向单列，继续有效，不降级成未确认偏好 |
| 插件实例身份不一致 | 统一为插件 id + 入口 + 所在运行实例的作用域 + 激活代次；每入口单独装配，同位置也不隐式合并 |
| 工作台生命周期缺终止 | 名称统一工作台实例；补停止中 → 已关闭及撤回入口/实例责任 |
| 日志插件名无对应 | `runtime-diagnostics` 明确承担 D1 的日志/诊断服务，宿主紧急输出保持独立 |
| Work/Task 产物计数过时 | 去除固定四项计数；验收枚举全部新设计，并将原有质量记录明确标为首轮 |

五项均已由 Leader 原位修改，原 Reviewer 定向复核均已闭合；结果保留在原报告第十一节。本次定向复核不替代人类批准。

## 运行时语义审查

原报告：[t02 第二轮](../../t02-runtime-contract-review/walkthroughs/tracer-review.md)。原审查发现四项；Leader 核对源码后接受 F1/F3 的设计缺口，接受 F2 的表述修正，纠正 F4 的现状前提：

| 发现 | Leader 处理 |
|---|---|
| F1 configuration ↔ Agent 依赖未拆明 | 配置核心无 Harness；Profile 设置适配显式消费独立 Catalog；Catalog/Harness 可消费配置核心，不能反向回设置适配。插件表补边，所有现有默认参数调用点纳入迁移。当前 readConfigBootstrap 未触发这些默认参数，不夸大成所有启动读取都会创建 Harness |
| F2 缺工具 Profile 拒绝机制易被误读为现状 | 明标目标要求；点名当前 toolOverrides 对解析不到的工具跳过，新的调用前诊断/拒绝需要随工具目录迁移，不是已存在门禁 |
| F3 Project SQLite 多连接 owner 不清 | 唯一 owner 是 Project 代次内 database 资源，不是进程级 sqlite 插件；World/Plot/agent-sql 全部通过它借用并登记，先收口消费者再关闭连接，失败保留占用 |
| F4 把 State Root 检查误判为当前 fail-closed 门禁 | 不采纳“缺失拒绝门禁”的前提：product-startup.ts:40-52 仅 warn，随后执行迁移检查。补充现有只读检查/可见告警，但不擅自升级成禁止启动或处理用户数据 |

新增机制仍属提案；未修改上述产品源码。原运行时 Reviewer 已对最终正文 `32ce39ea…` 定向复核：F1–F3 闭合；F4 的 fail-closed 前提撤回，现有检查/告警被明确保留，未遗留阻塞项。报告末章保留两处现状纠正与最终结论，不删除原发现记录。

## 本轮验证与交付边界

这是文档与源码推导的架构审查，不证明新运行时已运行。无产品改动、迁移、真实 Provider/Model、浏览器或发布动作。本轮治理原始结果见 [governance-check-tracer.txt](../evidences/governance-check-tracer.txt)：两项既有失败仍存在，未篡改他人 Task/根治理文件或检查器。

- 本轮 t01/leader、t02/reviewer、t03/reviewer 的 `bun run governance:context -- --work w00017-application-runtime-architecture --task <taskId> --role <role>` 均 exit 0、`failures: []`，解析到正确 Work/Task/role；t02/t03 在最后集成期间再次核验。
- 验证基线：主工作区 `master` / `45906272915ff43e83318653af62afa9ce668206` 加本轮未提交文档，尚无独立 revision。上下文输出仍包含其他 Work 的改动；本轮没有暂存、提交、push、合并或远端更新。
- 纯文档修订不运行产品测试、typecheck、build、浏览器、迁移或真实 Provider/Model；新运行时未实施也未运行。没有临时脚本、服务、浏览器实例或测试数据根需要清理。
- 最终提案 SHA-256：`32ce39ea62810801893434d798df9d12b9ee906e41f4bcbcfcf81cf296f12270`。新增设计的文档门禁原始输出单独归档为 `evidences/docs-check-tracer.txt`（相对 t01），不使用首轮 5535 文件/旧指纹作为本轮通过证据。
