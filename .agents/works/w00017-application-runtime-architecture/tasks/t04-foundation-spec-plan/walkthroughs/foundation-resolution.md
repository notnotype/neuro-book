# 基础两切片：规范与实施规划交付记录

## 范围与身份

本轮正式身份 w00017 / t04 / leader，主工作区 master，HEAD `45906272915ff43e83318653af62afa9ce668206` 加未提交文档；没有独立提交revision。开发者要求前两片Spec、模块/切片、Work、整体实施路径和Task；后续明确决定等待w00003完成并合入master，再考虑从master创建worktree。当前只交付文档，不实施、不创建worktree、不提交/push/合并，不接管w00003。

七项Spec均planned：第一片lifecycle/services/plugins/application，第二片diagnostics/platform.files/platform.sqlite。Proposal接受范围为基础架构和分段方向，热卸载扩展仍评估。后续Lab→Files→Settings→World/Plot的文件、进入/退出和外部作者验收见[整体路径](../../../implementation-plan.md)。只创建首个已知实现单元[t05](../../t05-runtime-lifecycle/README.md)，其产品实施等待合并基线；其余是未来工程单元而非已派发Task链。

## 写作与Leader集成

机制与基础设施两个独立写作切面只改自己Spec，不跑验证。Leader集成application、Proposal/索引、Work、Task与计划，发现并修正：

- “关闭未完成”只是停止中结果；取消等待不等于执行终止，未完成获取与操作必须计入closed门禁，超时不能重入pending清理。
- 必需失败只隔离失败provider和必需消费者，不误伤健康上游；静态预校验与动态等待环的副作用保证区分。
- provider作用域single-flight，子scope复用祖先，单等待方取消不取消共享初始化；长寿命不能捕获短寿命，精确操作借用可用。
- 多贡献接收者准备/提交期间保持调用门禁关闭，失败全部撤暂存项；正常关闭撤可调用实现，不删除静态描述；不承诺跨网络事务。
- 文件trusted-root约束不冒充恶意代码/外部进程沙箱；advisory锁不是fencing；SQLite区分autocommit、显式事务、已知失败和提交结果未知，scope owner不等于进程级插件owner。
- 主树Vitest/tsconfig不直接覆盖新runtime目录且默认测试加载Agent setup：t05明确增加独立配置与命令，未来接入标准入口时保持唯一收集。新命令在本文与Task标明尚不存在。
- 生命周期Spec含双宿主验收，t05单元完成不提前晋升，须首片集成证据覆盖全文。

## 独立运行合同审查与处理

[t02报告](../../t02-runtime-contract-review/walkthroughs/foundation-review.md)首次静态审查无P0/P1，提出9项边界精度问题；不是运行失败，亦非产品验收通过。

| 编号 | 处理 |
|---|---|
| F1 后端只写sink与轮转矛盾 | 区分console只写出口与后端插件拥有的日志位置文件出口；后者可在授予位置追加/轮转/保留，不能向其它插件开放任意文件能力 |
| F2 浏览器缓冲查询owner缺失 | 所有运行实例的有界查询缓冲由诊断提供者拥有；宿主只提供console/紧急通道，不要求write-only通道返回记录 |
| F3 共享日志目录多owner | 不引入新目录布局或多写者仲裁；同位置单个协作file出口owner，冲突降级到本实例缓冲/紧急输出，不抢写/回收；预算按授予位置，非跨进程强fencing |
| F4 来源身份与格式 | 新记录实例/位置必填且由provider写入，利用既有data增补；保留JSONL外层字段含义，不迁移历史。当前查询不读旧日志，无法确认归属的记录不进入查询 |
| F5 根身份与权限授予 | 实际根能力包含独立grant身份/集合/寿命；请求模式不能提升授予，公开根id不等于权限；补同根只读/读写隔离场景 |
| F6 watch释放矛盾 | 采用更严格的消费者边界：释放后不开始回调，OS已排队但未开始的通知被挡住；已开始执行仍计在途。未采纳继续投递全部排队通知的建议 |
| F7 共享激活取消 | 单触发方取消仅撤自身等待/后续调用，不能撤其它等待者的共享激活；owner取消/失败才收口整个activation |
| F8 SQLite借用权 | 仅受限执行/事务/归还，无close/disconnect/转移owner；原驱动在owner/adapter内。失效必须报告，但确认全部资源已释放后可以closed，不永久保留虚假占用 |
| F9 同物理文件身份 | 等价URL/路径/文件系统大小写/链接不能生成第二owner；未知身份拒绝；不存在文件先预留再核实。没钉realpath调用序列或对Windows一概lowercase，补等价身份冲突验收 |

修正均在原Spec，无新capability/SDK/热卸载/业务迁移；审查报告保留原问题，定向复核结果由Reviewer追加。

## 检查与边界

- [上下文检查](../evidences/context-checks.txt)：t04/leader、t05/tasker、t02/reviewer、t03/reviewer实际命令均exit0，failures为空；仅验证登记身份，不代表执行了t05。
- Leader额外相对链接目标检查：当时14文件、153链接无缺失，仅路径存在性，不是全仓anchor审计。正式文档门禁另归档。
- 最近governance:check两项既有失败仍由[历史输出](../../t01-architecture-proposal/evidences/governance-check-tracer.txt)说明；本轮不改相关文件、不重复确认、不声称全仓治理通过。
- 未运行产品测试/typecheck/build/browser/migration/Provider；规范smoke是未来验收目标。没有本轮临时服务、验收数据根或throwaway脚本需要清理。

运行合同Reviewer定向复核确认F1–F9闭合，无剩余阻断。R1/R2概述旧句与R4内存预算已修并获复核；R3“缺同文件身份验收”经Reviewer核对SQLite第10项后确认漏读并撤回，R5实现提示撤回，不把Node API技巧写入黑盒Spec。

## 独立计划与治理审查

[t03报告](../../t03-document-governance-review/walkthroughs/foundation-review.md)结论无阻断，三项P3均已原位处理：

1. Lab切片明确w00016在w00003树交付的命令底座/全局面板归属；将合并基线包含该批次、未来owner交接及三份原Spec宿主边界调整写入进入条件，不倒改历史验收。
2. 插件失败态统一为失败，owner取消/作用域关闭进入停止中并经lifecycle门禁到已关闭；失败scope关闭也有出边。
3. 三份核心Spec批准句统一为开发者接受基础架构与分段方向并明确要求前两片落Spec；不声称逐项批准全部D1–D4矩阵。Proposal旧推荐行标明当时历史阶段。

本轮交付只到规范与治理，产品实现暂停条件仍是w00003完成并合入master后再落实worktree。七Spec全部planned，首个t05未执行；不存在“先在当前树做一点内核”的例外。

t03原Reviewer已定向复核上述三项，全部闭合、无新增问题；t02最终收口同样无剩余阻断。两者仅静态文档审查，不代替未来真实宿主/I/O验证。最终补充路径检查覆盖17文件/172相对链接，目标均存在（非全仓锚点审计）；主要交付内容SHA-256见[指纹清单](../evidences/document-fingerprints.txt)。
