---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: agent.session-store-lease
owners:
  - neuro-book
---

# Agent Session Store 租约

## 目标与非目标

目标是在同一 Workspace Root 上保护 Agent Session Store 的单进程写入所有权：正常持有者持续续期，第二个进程不能同时取得租约，持有者确认失去所有权时停止继续写入并按既有退出合同关闭。

本规范不承诺阻止非协作程序删除或替换锁目录，不定义真实 Provider/Model、浏览器验收或远端发布行为，也不把 owner metadata 当作互斥依据。

## 术语与参与者

- **Workspace Root**：Agent Session Store 所属的持久化根。
- **运行租约**：位于 `.nbook/agent/migrations/runtime.lease` 的锁文件及其 `.lock` 目录；锁库通过目录 mtime 维护心跳。
- **持有者**：已成功取得租约并负责继续写入的当前进程。
- **竞争者**：尝试取得同一 Workspace Root 租约的其他进程。
- **失去所有权**：锁库报告 `ECOMPROMISED`；不是普通正文文件占用。

## 输入与前置条件

- Session Store 通过 async 或 sync lease API，以 Workspace Root 和 `runtime` 或 `migration` kind 取得租约。
- runtime lease 使用 `stale=30000`、`update=15000`；migration 与 runtime 共用同一物理锁。
- 锁所在文件系统必须能按锁自身实际可观测的 mtime 精度完成 `utimes -> stat` 往返；不能只按盘符或操作系统猜测。

## 输出与可观察行为

- 首个持有者成功取得租约并写入最小 owner metadata；metadata 只用于竞争诊断，不决定互斥。
- 活跃持有者经过多个心跳周期仍可继续工作；竞争者在活跃锁存在时收到 `ELOCKED`。
- 释放完成后，下一竞争者可取得同一租约。
- 运行时确认 `ECOMPROMISED` 后，Product 进入 shutdown controller 并以 `AGENT_SESSION_STORE_LEASE_COMPROMISED` / 退出码 `75` 收口；不得继续使用旧所有权写入。

## 状态与转换

| 状态 | 事件 | 下一状态 | 结果 |
| --- | --- | --- | --- |
| 未持有 | 成功 mkdir、mtime 探测和获取 | 持有 | 启动心跳并允许 Session Store 写入 |
| 未持有 | 现有锁未 stale | 未持有 | 返回 `ELOCKED`，不修改已有锁 |
| 持有 | 心跳前 mtime 仍为自身值、utimes 往返成功 | 持有 | 更新下一次心跳基准 |
| 持有 | mtime 被外部改变或心跳不可完成至 stale 边界 | 已失效 | 报告 `ECOMPROMISED`，停止继续持有 |
| 持有 | 显式 release 成功 | 未持有 | 删除本持有者锁目录 |
| 遗留锁 | mtime 超过 stale | 持有 | 通过锁库 stale 协议接管；不依据 metadata PID 杀进程 |

并发语义：在没有 stale 接管、长时间暂停或时钟跳变的正常协作窗口内，同一物理锁最多允许一个协议认可的非 stale 持有者；`ELOCKED`、`ECOMPROMISED` 和 release 失败保持不同含义。若旧进程在 `mkdir → probe` 或心跳期间暂停超过 stale，或时钟跳变使锁被接管，新的持有者可能已经重建锁目录，而旧持有者在下一次 mtime 检查前尚未收到 `ECOMPROMISED`。本规范不把该 advisory lock 当作带 fencing 的强互斥协议，本补丁也不消除这个 dual-owner 窗口。

## 副作用与数据

- 租约文件和 `.lock` 目录由 Session Store 与锁库共同管理；正常释放清理本持有者锁目录。
- owner metadata 只写入 schema、leaseId、kind、pid、acquiredAt、runtime 和 runtimeVersion，不记录 argv、cwd、环境变量、token 或正文。
- mtime 精度探测不得在锁库 fs 对象之间共享未经验证的结果；探测失败后新建锁必须清理，禁止留下可误判的半成品。

## 失败与恢复

- 无法精确完成支持的 mtime 往返时，获取失败并返回明确的 `ENOTSUP`；该错误不得被 lock retries 重复包装成其他错误。
- 普通 I/O 错误继续遵守现有锁库重试和清理合同。
- `ECOMPROMISED` 不得通过删除 `.lock`、抢回旧锁、延长 stale 或忽略回调恢复；应用按既有 shutdown/退出码 75 合同收口。
- stale 接管只允许在锁 mtime 已超过 configured stale 后发生；接管过程不读取 metadata PID 作为杀进程依据。

## 边界与兼容

- Product 与 Manager 的既有构建和运行入口必须继续消费本租约的公开行为：租约接口、竞争错误、失去所有权错误和退出码保持兼容；依赖选择、构建投影和载荷布局不属于本黑盒合同。
- 保持 `acquireAgentSessionStoreLease`、`acquireAgentSessionStoreLeaseSync`、`AgentSessionStoreLeaseHandle` 和现有错误/退出码接口不变。
- Windows exFAT 是本行为的目标兼容边界；NTFS 对照必须继续通过。没有真实 exFAT 证据时不能把规范晋升为 `implemented`。

## 验收与 Smoke

1. 给定 1ms、1000ms、2000ms mtime 量化的局部 fs adapter，持有者经过三次 15 秒受控心跳仍保持健康，竞争者返回 `ELOCKED`；旧 4.1.2 在 2 秒量化场景先红。
2. 给定同一个 fs 对象先后用于不同精度的两把锁，两把锁均按自身精度运行，不串用精度缓存。
3. 给定 utimes 不改变 mtime，获取失败为 `ENOTSUP`，即使配置 retries 也不重复获取。
4. 给定持锁后 lock directory mtime 被真正改变，持有者收到 `ECOMPROMISED`，不继续写入。
5. 在真实 Windows NTFS 与 exFAT Portable Product 中，运行至少 120 秒；活跃服务不因误报租约失效退出，竞争者得到 `ELOCKED`，释放后可重取。

实现闭合后运行对应聚焦 Vitest、Session Store/Project Lock 测试、Product/Portable smoke 和 `bun run docs:check`；证据完整前保持 `planned`。

## 实现合同

尚未实现。

## 证据

- [ADR 0010：Desktop storage loopback shutdown](../../../packages/neuro-book/docs/adr/0010-desktop-storage-loopback-shutdown.md)
- [Issue #123](https://github.com/notnotype/neuro-book/issues/123)
