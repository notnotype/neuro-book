# t33 续跑说明

上一轮被主 Agent 中断：你把核心机制（`runtime/plugins` 的贡献点、校验与交付账本）整块交给了子代理，子代理只拿到转述的上下文，约 1.5 小时没有落下核心改动。开发者要求：

- **设计与主要编码由你自己完成**，不再把实现交给子代理；子代理只用于调研、审查或批量机械改动这类独立、简单而工作量大的活。
- 先用 `git status` 与 `git diff` 核对中断前已有的修改（目前在 `runtime/application`、`app/runtime/product-browser-runtime.ts`、`scripts/smoke/runtime-foundation`、`server/runtime/product-startup.ts`；`runtime/plugins` 尚无改动），在此基础上继续，按原任务说明完成全部目标、验收场景与完成标准。
- 任务说明已追加上面这条要求，其余不变。
