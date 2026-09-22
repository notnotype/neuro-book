---
schema: nbook.task/v2
taskId: t05-runtime-lifecycle
---

# 资源生命周期与独立验证入口

## 目标与范围

实现第一切片的首个独立单元：[runtime.lifecycle](../../../../../docs/specs/runtime/lifecycle.md)。调用方能够创建作用域、登记资源和在途获取、执行操作、关闭或显式恢复失败收口；scope/owner/代次与结果可查询。不是仅有类型，也不代表环境适配、小内核全部或正式产品已完成。

[整体实施路径](../../implementation-plan.md) 拥有切片顺序；[Work](../../README.md) 拥有授权与 checkout。执行者直接按当前 Task 和合同实现，不加载正式角色。本文是准备好的实施计划，本轮文档交付没有执行它。

## 进入条件与开发者参与

1. **等待 w00003 完成并合并到 master。**这是开发者的明确进入条件，当前不得提前实现纯内核、在 w00003 继续开发或从其中途检查点分叉。合并后核实所需实现／Spec 与完整 master OID，再按 [编号合同](../../../README.md#编号分配与记录位置) 从 master 创建 w00017 worktree，不要求登记共同祖先。
2. 执行 `bun run governance:context -- --work w00017-application-runtime-architecture --task t05-runtime-lifecycle`，确认真正 checkout／branch／Spec。主树不得切分支；不 stash/reset/覆盖他人改动。
3. 本 Task 不需要产品数据库迁移、真实 Provider 或浏览器；只操作自身测试临时资源。提交、push、合并仍分别授权。发现须改变 Spec 行为／数据策略或扩大文件 owner 时报告所需取舍，不自行弱化验收。

## 文件边界

相对应用包 `packages/neuro-book/`：

- 新 `runtime/lifecycle/`：先用最少文件实现公共生命周期合同；一个主模块及相邻 `*.test.ts` 足够时不建空index/types/factory层。必要类型/错误仍由此模块拥有。
- 新 `vitest.runtime-foundation.config.ts`：显式包root与 `nbook/*` alias，只收 runtime基础合同；`@notnotype/neuro-book-test-support/vitest` setup第一项和globalSetup必须存在，不带Agent/product初始化。后续适配器/基础服务测试接同一配置，不再开第二套。
- 新 `tsconfig.runtime-foundation.json`：strict、无`.nuxt`依赖，显式覆盖新模块/消费者；ESM与仓库语言规范一致。
- 包 `package.json`：增加 `test:runtime-foundation`、`typecheck:runtime-foundation`，命令按整体计划。不得顺带改版本/exports/依赖。
- 规范成熟度只在实现与证据覆盖全文时原位更新 `docs/specs/runtime/lifecycle.md` 和注册表；其余runtime Spec保持planned。

不改app页面、LabShell、Nuxt/Nitro hook、Project/Agent/Config/Storage、现有产品启动与关闭入口，不接真实数据库。不修改现有全量测试配置以屏蔽失败。

## 修改步骤

1. 核对相邻资源工具和原shutdown的错误/取消风格；仅复用不引入产品反向依赖的机制。公开符号修改前有LSP则先references，无server时记录文本引用清单。
2. 固定最小公共类型：运行实例/作用域/资源身份、资源状态、取消与结束原因、关闭结果及结构化失败。区分调用方借用与唯一关闭owner；返回只读状态，不暴露可变内部集合。
3. 先写能因真实边界缺失而失败的合同场景，再实现资源登记、在途获取、接纳与停止。停止中迟到资源仍能被owner收口，但不可发布；closed前必须确认全部受管资源结束。
4. 实现依赖先后关闭、独立失败聚合、幂等正常close；保留被未结束消费者使用的provider。失败只由显式恢复动作重试失败资源，不重复已成功副作用，不自动循环。
5. 加入独立Vitest/typecheck入口，确认新测试实际被收集且没有加载产品根。标准测试覆盖确定性故障，另运行一次公共入口消费的临时smoke；不把测试文件当实际smoke。
6. 通过后移除临时脚本，记录实际公共入口/证据/限制。本Task验证后端可执行机制，生命周期Spec还要求真实浏览器复用：保留 `planned` 至首片集成证据覆盖全文，不凭单个单元或测试宿主晋升；其它runtime Spec同理。

## 验收

- 两个运行实例、父子与独立作用域不串状态；借用者不能关闭共享provider；取消只影响指定操作，不假装回滚已发生副作用。
- 关闭阻止新业务，已接纳消费者仍可用依赖完成清理；创建失败/取消/迟到完成只释放本次资源，旧代次不可发布；消费者先于provider结束。
- 重复close不重复清理；一个cleanup失败不跳过独立资源；仍使用中的依赖不提前关；失败/超时不能报closed；显式恢复只重试失败收口，保留可定位owner，不能重入仍pending的清理。
- 公开API无Vue/Nitro/数据库/Project/Agent import，无顶层I/O/global singleton。没有empty-success handler、any逃逸或用超时强行宣称资源已关。

## 验证命令与证据

以下脚本须由本Task建立后执行，当前尚不存在；cwd应用包：

```text
bun run test:runtime-foundation
bun run typecheck:runtime-foundation
```

临时smoke用本模块公共入口创建两个scope，登记一个真实定时资源或标准事件订阅及依赖消费者，实际调用/取消/关闭；观察consumer清理时provider仍可用、结束后订阅不再交付、重复close不重复副作用；再故障注入cleanup失败并显式恢复。脚本放测试支持包分配的系统Temp，结束清理，不写仓库业务数据；普通有限命令运行不创建常驻服务。该smoke不验证浏览器或完整环境适配，后续单元另做。

最终运行 `bun run docs:check`（仓库根）；只在改动使先前证据失效时扩大重跑。报告区分 focused/全量、当前/既有失败；不得用旧w00016或w00003结果代替本Task证据。

## 交付与继续

Task 快照记录公开接口、实际文件／提交基线、测试与 smoke 结果、未运行项和失败资源处理；必要历程与原始证据按需链接。确认合同闭合后按实际 API 创建下一服务装配 Task，不等待形式化角色交接。第一片总验收仍需 services、plugins、后端／浏览器适配和真实宿主 smoke，不因本 Task 完成宣称底座全部完成。
