---
schema: nbook.task/v2
taskId: t53-rpc-port-browser-connection
---

# NeuroBook v2 第 5 步 K2：服务端 RPC 端口与浏览器宿主连接

## 目标与范围

按 [多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md)（2026-10-07 `accepted`）第 11 节的 K2：服务端宿主开内核 RPC 专用端口（WebSocket，校验 `Origin`），固定握手字段与重连规则，浏览器窗口启动时连上它并在断线后重连；引导接口告知 RPC 端口。只做未绑定项目的客户端，项目绑定与项目子进程归 K3。

实施计划：[plan.md](plan.md)（2026-10-07 开发者确认）。

行为合同（本 Task 修订）：[`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md)、[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)、[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)、[`runtime/api-docs.md`](../../../../../docs/specs/runtime/api-docs.md)。

## 前置

K1 [t52](../t52-kernel-instances-remote/README.md)：内核远程服务、路由与协议（进程内链路）已实现并经 omp 审查修正。

## 开发者决定（2026-10-07）

计划末尾的 4 项全部确认：没有 `Origin` 的连接放行、带了的只放行本服务页面与 `NBOOK_ALLOWED_ORIGINS`；服务端重启后显示“服务端已重启”、由用户刷新，不自动刷新；开发模式页面直连后端 RPC 端口，不经 Vite 代理；握手带客户端身份、不带各插件版本，RPC 端口缺省由系统分配。K1 改为随 K6 完成后一起验收。

## 当前状态

2026-10-07 S0–S8 已按 [plan.md](plan.md) 完成，交 omp（默认模型）在后台只读审查。

- **改动**：Spec 修订（S0 `bb9138c1`）；握手字段、wire 先核对、服务端重启识别、重连接管与 JSON 编解码（S1 `7a7184a8`）；路由停止接纳、排空与关闭（S2 `fb83da0f`）；服务端 RPC 端口、`Origin` 与启停顺序（S3 `1d349a2c`）；开发模式传端口与来源（S4 `7729c8c6`）；浏览器首连、客户端身份与断线重连（S5 `7a0a7120`）；离线横幅与服务端已重启页（S6 `20d7983d`）；真实 Chrome 的 e2e（S7 `da38fe4a`）；Spec 实现合同、smoke 与证据（S8，本次提交）。
- **与计划的出入**（均已先改 plan.md）：
  - 升级请求先过门、再核对 `Origin`：HTTP 端口为 0 时允许的来源要等 `nbook.http` 监听后才知道；门复用 HTTP 准入。
  - 套接字链路放在两端共用的 `src/shared/rpc-socket.ts`，没有分成服务端与浏览器两个文件；探针合同放在 `src/shared/testing/`（服务端测试插件与浏览器测试插件都引用）；e2e 测试外壳输出到 `dist/e2e/web`（随 `dist/` 被忽略）。
  - 路由停止的测试并进 `routing.test.ts`，复用其中的四实例拓扑。
  - 实现中发现并修正：进程内测试链路会丢掉“关闭前已发出”的帧（路由回完拒绝帧立即关链路时对端读不到原因），改为先送达再通知关闭，并改用与 WebSocket 相同的 JSON 编解码；窗口启动流程抽成 `src/web/boot.ts`，产品入口与 e2e 测试外壳共用。
  - 服务端正常停止时插件先于链路关闭，客户端订阅以 `provider-stopped` 结束；`server-restarted` 结束订阅只在链路意外断开后连到新进程时出现（内核测试覆盖）。
- **证据**：[test-affected-typecheck.txt](evidences/test-affected-typecheck.txt)（`bun run test:affected --typecheck --since dd98a1fc`：nb-runtime 与 neuro-book 的类型检查与全部测试）、[smoke-server.txt](evidences/smoke-server.txt)（S1–S6，S6 为 RPC 握手与来源核对）、[test-e2e.txt](evidences/test-e2e.txt)（36 条，含 `rpc.e2e.ts` 6 条）；`docs:check`、`governance:check` 无失败。验收映射的每条判据都做过变异检查（改坏实现后对应测试失败）；变异检查发现“重连成功后退避归零”与 `start.ts` 的来源接线没有测试守住，已补测试。
- **未验证的边界**：项目绑定、超过宽限期的重连与服务端停止项目子实例（K3）；TUI 客户端；鉴权、Cookie 与 wss/TLS；反向代理；Windows；发送背压。
- **已知限制**（已写入对应 Spec）：不做发送背压与应用层心跳；同一实例重连按描述一致接管、不核对凭据；鉴权上线前不带 `Origin` 的本机进程都能连 RPC 端口。
- **e2e 中途的失败与处理**：前两次完整 e2e 里 `lab.e2e.ts` 的同一条用例在刷新那一步失败（一次是 Vite 开发服务动态加载 `LabPage.vue` 失败，一次是 Chrome 页面崩溃）；单独跑与按原顺序跑 Lab 相关文件都通过。当时机器内存紧张（交换区已用约 14.6 GB），且有一个开发会话测试进程遗留在后台约 45 分钟：S4 做变异检查时 `run.test.ts` 的用例中途失败，走不到发停止信号的那一步，监督进程没有停止通道就一直活着。清理遗留进程与临时目录后重跑完整 e2e，36 条全部通过（即 [test-e2e.txt](evidences/test-e2e.txt)）。`run.test.ts` 已补用例结束后的收口（改坏用例使其中途失败，确认不再留下进程）。
