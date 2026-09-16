---
schema: nbook.task/v2
taskId: t40-workbench-storage-context
role: tasker
---

# 工作台 Storage 消费上下文与插件内存样例

当前实现已完成两轮修复；[最终独立审查](../t42-storage-context-review/walkthroughs/review-final.md) 建议合并，Leader独立复跑6文件94用例通过。最终证据见 [本地收口](walkthroughs/leader-acceptance.md)，旧裁定仅保留修复历史。

Work：[w00003](../../README.md)；[计划](../../storage-implementation-plan.md)切片3中不依赖grid的宿主增量。
t35浏览器公共接口已在 `70c7168d` 验证并提交；t37/t38并行修grid与Splitter，本Task不等待也不改它们。

## 结果

每个工作台显式持有自己的Storage消费上下文。插件按声明的user/project scope取得已验证访问，
project必须来自有效的精确ready，不能从残留projectRoot推断。非持久共享选择属于该工作台的Project内存上下文，
同一上下文的两视图共享它；换代或释放后旧引用不能复活，新工作台独立。

合同：[storage.boundaries](../../../../../docs/specs/storage/boundaries.md)、[storage.persistence](../../../../../docs/specs/storage/persistence.md)。

## 范围与排除

- 新增 `packages/neuro-book/app/utils/workbench/storage-context.ts` 与同名测试、文档；必要的纯上下文helper保持同目录清晰归属。
- 新增同目录 `storage-plugin-sample.ts` 与测试，提供无真实业务数据的第二消费者示例：user/local偏好、project对象记忆、Project内存选择。
  样例定义可在测试中用真实服务注册，不加入产品全局 registry，不注册真实插件，不做 UI。
- grid版布局样例、原始快照合成、主页面接线、迁移与标题栏留后续。不能因为未接UI就声称切片3完成。
- 只读已有 `app/utils/storage/**` 源码；允许同步其 README 的工作台消费说明，不复制transport/订阅实现，不改服务端、shared合同、Work/Spec、两个用户dirty `descriptors{,.test}.ts`。
- 旧 `resolveViewStateLayer` 仅为路径描述，不是访问授权；新消费路径不调用它。读取descriptor的stateScope类型可以，但不能把路径resolve包装成有效上下文。
- 不开代理、不联网、不提交/push，不访问3001、不操作真实用户数据。纯测试采用仓库Temp支持；不启动产品宿主。

## 实现要求

1. 沿用 `openStorageUserContext` / `openStorageProjectContext` / `openStorageOwnerHandle` / `closeStorageContext`，
   提供可注入适配器的宿主，不依赖全局Pinia、不操作Project open/presence。
   由持有ProjectSession的宿主明确传入ready与失效信号/动作；捕获目标，禁止切换期间隐式改写。
2. 同一工作台的同scope/owner可复用有效句柄；实例间绝不共用可变singleton。初始化与release交错必须回收迟到资源。
   release先禁止新借用，再等待已接纳初始化/句柄释放，再关闭对应session；重复release共同等待。
   正常离开与强制失效的接口含义清楚；没有已确认的project时project请求明确不可用，不fallback到user。
3. 跨Project保留合法user上下文；Project变更释放旧Project内存与访问，user仍可用。整个workbench释放再关user。
   不引入session/window Storage scope，不持久化选择/焦点，不在内存共享API保存任意领域正文。
4. 样例以稳定owner/key/resource说明偏好和对象记忆地址；两个实例共享同一恢复地址时仍各自拥有投影/释放权。
   对象是否仍存在由样例owner校验。不创建隐含local/shared同步，不在helper中通用合并JSON。
5. 明确错误与可用状态，保存失败交由消费UI展示，不能后台吞掉；不要先构造泛化事件总线或新插件框架。

## 验证与交付

覆盖同一上下文复用与跨工作台隔离；A/B/空闲/用户资产显式目标；ready缺失、失效、同路径新代次；
await初始化时切换/释放的迟到资源回收；释放等待在途请求且不关闭其它工作台；Project内存两消费者共享、换代清空、user偏好继续可用。
至少一条用真实owner adapter+注入传输贯穿样例read/save/reopen，不只验证自写stub调用次数。测试与当前vitest include相符。
按 package.json 跑聚焦测试，主Agent统一typecheck。先写 `walkthroughs/implementation.md` 进行中，完成后列命令/退出码/文件与用例数、API用法和未运行项。
最终回复具体结果，不返回空文本或句点。
