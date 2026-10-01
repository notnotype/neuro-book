# 审查意见 1

上一轮在收尾阶段（恢复注释、比对全量失败）被系统内存不足终止，最终汇报没有写出。先用 `git status` 与 `git diff` 核对现状，再处理下面各项。核心实现（登记结构校验、单条校验推导、交付账本、接收者串行锁、断开先于产出释放）方向正确，13 个场景与 5 条补充回归覆盖到位，不需要重做。

## 必须修改

1. **恢复被删除的已有测试。** `runtime/plugins/plugins.test.ts` 删掉了“机制源码只使用同目录相对导入与 lifecycle/services 入口，不 import 框架、驱动或产品领域”这条用例（连同 `readdir`、`readFile`、`dirname`、`join`、`fileURLToPath`、`moduleDir`）。现有源码的导入都满足它，按 `HEAD` 原样恢复。
2. **恢复 `runtime/plugins/host.ts` 被删掉的注释。** 本文件删了 29 行注释、只加了 6 行。逐条对照 `git show HEAD:packages/neuro-book/runtime/plugins/host.ts`：仍然成立的原样恢复，例如文件头里代次作用域与 `entry-work` 子作用域的分工、工作作用域受管操作等待服务首次释放、`closed` 之后才结束必需借用；`#generations` 的“代次跨登记单调递增”；`#attemptFor`、`#releaseOutput`、`#provide`、`#releaseProvided` 的说明；`activate()` 与 `recover()` 里的分支原因；`#run` 第 1、2、6 步。含义变了的改写到新语义，例如第 3 步产出核对增加接收者，第 4、5 步改为交付账本。另外，在拥有边界处为账本补上不明显的原因，每处一句：
   - 连接在补交前登记到 `#connections`，让并发激活中的贡献方在下一轮看到它；
   - 多连接加锁按连接 id 排序，避免互相等待；
   - 只撤回 `prepare` 成功的交付；
   - 接收者资源依赖激活产出，因此断开先于产出释放。
3. **删除多余的启动路径。** `requiredPlugins` 已经激活必需插件在本位置的全部入口（`bootstrap.ts` 第 175 行）。因此 `app/runtime/product-browser-runtime.ts` 里的 `workbench-browser` 激活门禁是第三条路径，要删除；`nbook.workbench`、`scripts/smoke/runtime-foundation/controlled-manifest.ts` 的 `command-owner`、`runtime/application/application-startup.test.ts` 的 `command-owner` 入口上的 `activationEvents: ["onStartup"]` 也一并去掉。`product-browser-runtime.test.ts` 若断言了门禁 id，就改成断言 `requiredPlugins` 的效果。
4. **撤销无关改动。** `controlled-manifest.ts` 把 `import {provide}` 挪到了 `defineServiceKey` 之后，请恢复原顺序。

## 不返工，写进汇报的“后续切片注意事项”

- 拥有者已接上之后才登记的插件，其顶层声明式贡献不会推送，要等下次接上时补交；之后才登记的重复贡献，也会让已交付的那条变成 `rejected`，但不撤回。这两点都属于声明层的出现与消失（阶段 3 热插拔），本切片不做，只在汇报中说明。
- 重复判定现在跨运行位置。原规则是“同一能力内、同一运行位置上唯一”，在汇报的公开合同变化里写明。

## 完成后

重跑任务说明“验证命令与完成标准”的第 1–3 步，并把输出覆盖写入 `evidences/`；第 4 步全量测试不必重跑，我自己跑。然后按任务说明“最终汇报”的 7 项写汇报，其中第 4 项列出改写过的已有测试，第 6 项逐条写禁止清单的自查结果。
