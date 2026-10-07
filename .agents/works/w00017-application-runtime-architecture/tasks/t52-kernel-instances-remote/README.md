---
schema: nbook.task/v2
taskId: t52-kernel-instances-remote
---

# NeuroBook v2 第 5 步 K1：内核的开放运行位置、按调用方门面、远程服务与子实例

## 目标与范围

按 [多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md)（2026-10-07 `accepted`）第 11 节的 K1，在 `packages/nb-runtime` 实现拓扑需要的内核机制，并先修订对应 Spec。只改内核与 Spec，不接产品：真实 WebSocket 与浏览器宿主归 K2，项目子进程归 K3，Storage 归 K4，插件状态 store 归 K5。

实施计划：[plan.md](plan.md)（2026-10-07 开发者在计划模式中批准）。

行为合同（本 Task 修订）：[`runtime/lifecycle.md`](../../../../../docs/specs/runtime/lifecycle.md)、[`runtime/services.md`](../../../../../docs/specs/runtime/services.md)、[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)、[`runtime/application.md`](../../../../../docs/specs/runtime/application.md)、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)、[`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md)、[`runtime/plugin-hot-plug.md`](../../../../../docs/specs/runtime/plugin-hot-plug.md)。

## 开发者决定（2026-10-07）

- K1 一个 Task，内部按计划分片逐片提交；
- `runtime/plugin-channel.md` 原地改写为“远程服务与 RPC 协议”，保留路径与 capability；
- 本 Task 实现通用的“拥有者定义的激活事件”机制，`onRemote` 是第一个使用者；
- 主 Agent 编码，omp（默认模型）只读审查；内核可依赖 TypeBox。

## 当前状态

2026-10-07 S0–S10 已按 [plan.md](plan.md) 完成，omp（默认模型）只读审查后修正完毕。开发者决定 K1 等 K6 完成后一起验收。

- **改动**：Spec 修订（S0 `7ff926e8`）；运行位置开放与注入时钟（S1 `98f742b2`）；调用方身份与按调用方门面（S2 `13ef87b9`）；委托（S3 `145ebcec`）；拥有者定义的激活事件（S4 `c0966ff4`）；远程服务合同与协议、TypeBox 依赖（S5 `95186a13`）；节点、路由、进程内链路、插件接线与订阅（S6–S7 合为一次提交 `d9699de1`）；激活期超时上限与等待环（S8 `c837dd78`）；子实例与租约、`{project}` 租约核对（S9 `ff223cec`）；Spec 实现合同与证据、远程模块源码守卫（S10 `07421696`）；审查修正（本次提交）。
- **与计划的出入**：S6、S7 合并提交，订阅场景写在 `routing.test.ts`；S9 发现只靠根作用域资源排不出“子实例先停”，改为应用停止前的内部停止阶段，已先改 plan.md 第 8 节。
- **omp 审查**：[omp-review.txt](evidences/omp-review.txt)，10 条（重要 5、建议 5），无阻断，逐条核实均成立：
  - 1 等待环误判已结束激活的入口：改为只在链上入口仍在激活中时判环，补回归；
  - 2、3 门面“提供者释放时作废”与缓存键的代次维度缺测试：补两例；`ServiceRevokedError` 增加结构化的 `reason`，测试不再依赖消息文本；
  - 4、10 绑定旧项目代次不改投、提供方侧断开以 `target-gone` 结束订阅缺测试：补一例同时覆盖；
  - 5 跨实例传不能序列化的值抛出未捕获异常并残留等待条目：`Peer` 接住链路编码失败，参数为 `invalid-input`、结果为 `provider-error`、事件结束订阅，传输接口写明 `send` 的抛错语义，补三例；
  - 6 节点门面键补上代理代次（今天不可达，防跨实例委托时复用旧实现）；7 删除没有发送方的 `resync` 帧；8 门面与远程实现工厂拒绝 async 函数，补测试；9 本地请求结算时移除取消监听。
  - 另自查去掉了远程节点与插件宿主里不必要的非空断言与 `as never`。新增测试都做过变异检查。
- **证据**：[test-affected-typecheck.txt](evidences/test-affected-typecheck.txt)（`bun run test:affected --typecheck`：nb-runtime 两套 typecheck 与 231 例、neuro-book typecheck、173 例 bun 与 47 例 vitest，全部通过）；`docs:check`、`governance:check` 无失败。失败码与路由的实例身份核对（S5–S7）、等待环（S8）、子实例状态表与停止顺序（S9）、源码守卫（S10）以及审查补的测试都做过变异检查（改坏实现后对应测试失败）。
- **未验证的边界**：真实 WebSocket、断线与浏览器刷新（K2）；真实子进程、进程间通信与强制结束（K3）；TypeBox 进入浏览器构建后的体积（K2 测量）。
- **已知限制**（已写入对应 Spec）：委托只在同一实例内；合同版本只做整数精确匹配；等待环只沿单条激活链检测，激活链不记代次；`{project}` 租约在建立请求或订阅时核对，订阅建立后租约释放不取消订阅；拓扑稿第 10 节“服务端向项目推送事件不需要租约”尚无对应原语；`runtime/plugin-channel.md`、`plugin-manifest.md`、`plugin-hot-plug.md` 保持 `planned`。
- **下一步**：K2 见 [t53](../t53-rpc-port-browser-connection/README.md)；K1 随 K6 完成后一起验收。
