# t25 user Storage HTTP 增量独立审查

结论：**建议合并**（无阻断缺陷）。

基线：当前 worktree 相对 `3b8d87fb`。审查对象：[t24](../../t24-storage-user-http/README.md) 的 user 受管句柄与 HTTP 值读写增量。
非审查范围（已声明或用户原有）：前端浏览器值适配器/网络订阅（[接续边界](../../t24-storage-user-http/walkthroughs/adapter-next-boundaries.md)）、
Project 接线、`app/utils/workbench/descriptors.ts` 与 `descriptors.test.ts`（mtime 2026-09-15 22:28，用户原有 dirty，未含 Storage 改动）。

## 已查范围（逐点结论）

| 审查重点 | 结论 | 依据 |
| --- | --- | --- |
| 1 注册定义是唯一策略；请求不能提交主体/根/locality；有界 body；公开诊断不泄漏 | 通过 | `shared/storage/action.ts` 全 `.strict()` 判别联合；`storage-actions.ts:readStorageActionRequest` 先查 `content-length`、再用 `raw-body` 独立 limit；`requireStorageActionState` 只回 `registry.resolveAddress` 的注册实例；`runStorageAction` 对 `corrupt`/`unsupported-version` 覆盖固定 `diagnosis`；`contract.ts` 删除 `StorageReclaimOutcome.diagnosis`，`partition-store.ts:reclaimRecord` 只报原因类别 |
| 2 池的打开/最后释放/关闭/容量与失败路径；host pending 与 service 关闭排空 | 通过 | `handle-pool.ts`：容量检查在建立条目之前，容量同时计入 `opening` 与 `released`；`close()` 反复收敛 `opening`+`releases`；关闭竞态中打开的句柄在抛错前登记释放；`host.ts:operate` 把每次操作登记进 `pending` 并由 `closeState` 等待；`storage-service.ts` `finish()` 幂等，池与 service 共享同一次 `handle.release()` |
| 3 上下文撤销/到期、根替换、等锁、替换重试、repair 原件与 reclaim committed | 通过 | `access-context.ts:assertLive`（不续期、失效即抛）；`storage-service.ts:createHandle` 先 `guard?.()` 再决定是否 `canonicalStorageRoot`，有 `expectedRootIdentity` 时不建目录、比对 `storageRootIdentityDigest` 后 `realpath` 归一；`partition-store.ts:assertMutationHealthy` 在异步 `assertContained` 前后各查一次授权；`record-file.ts` 每次替换重试前 `beforeWrite`；`mutate` 给已提交后的领域错误补非枚举 `committed: true`，锁失败始终带 `committed` |
| 4 HMR V2→V3 旧 owner；同版本重载复用状态 | 通过 | `host.ts:createState(null, __nbookStorageHostV2)` 只关闭 V2 的 registry；已核对 `git show 3b8d87fb:.../host.ts`，V2 槽确实只有访问上下文 registry、没有 service/句柄池，因此旧 owner 无法继续写盘；`__nbookStorageHostV3 ??=` 使同版本重载复用同一 owner；`storage-host-hmr.test.ts` 两条用例覆盖 |
| 5 测试打到故障接缝、不靠时间碰巧通过；接口便于后续消费 | 通过 | 故障注入为确定性闸门：`lockAdapter` 在真实锁前设闸门、`fileOptions.replace` 注入真实 adapter 的 EBUSY、`openHandle` 接缝停在已建句柄之后、空闲到期只伪造 `Date`；回收撤销用例先把 `metaPath` 归一到 `realpath` 再比对 |

主 Agent `walkthroughs/leader-progress-review.md` 列出的六项均已不复存在，逐项复核：

1. 释放等待：`StorageHandleLease.release()` 现在返回池的等待；`close()` 收口在途释放 —— 通过。
2. 空条目与容量：`assertCapacity` 前置于 `entries.set`，`dropIfIdle` 清理，`released` 条目计入容量 —— 通过。
3. 双减 `users`：`acquire` 不再有 catch 分支，只由 `open()` 的 catch 减一次 —— 通过。
4. guard 与 mkdir：`assertMutationHealthy` 在异步 `assertContained` 之后复检；`createHandle` 首次 mkdir 前先 `guard?.()` —— 通过。
5. diagnosis 投影与 body 上限：`runStorageAction` 覆盖读取诊断；`raw-body` limit 不依赖声明长度 —— 通过。
6. 非锁失败的 `committed`：`mutate` 对提交后领域错误补标记，回收撤销用例断言 `committed: true` 并重读到新代次 —— 通过。

## 独立复跑

```
bun run --cwd packages/neuro-book test server/storage/handle-pool.test.ts server/storage/storage-action-lifecycle.test.ts
→ Test Files 2 passed (2)；Tests 21 passed (21)；Duration 2.61s
git diff --check → exit 0
```

未复跑主 Agent 已实跑的 190 项聚焦回归、主应用 `typecheck`、Chrome identity smoke 与 `docs:check`（Task 明确要求不重复占用时间）。
这些命令的当前结果沿用主 Agent 记录：均 exit 0。

## 非阻断建议

1. **`unsupported-version` 的 HTTP 投影缺少用例。** `corrupt` 有 HTTP 用例断言响应不含原始内容，`unsupported-version` 与它共用同一条覆盖分支但无用例。
   触发：写入封装版本高于当前支持的记录后读取。影响：仅覆盖缺口，无已知行为缺陷。建议在下一增量的 adapter 用例中补一条同形态断言。
2. **每请求多一次根身份 `stat`。** `host.ts:performStorageUserAction` 在取得句柄后固定调用 `assertLeaseRootIdentity`。触发：任意一次动作请求。
   影响：常数级开销，正确性无损；若后续浏览器长期句柄高频读需要评估，应在 [接续边界](../../t24-storage-user-http/walkthroughs/adapter-next-boundaries.md) 的传输选型里一并确认，而不是现在放宽该检查。
3. **句柄释放失败无出口。** `performStorageUserAction` 的 `finally` 与 `pool.close()` 都把 `handle.release()` 失败吞掉。
   触发：`StorageHandle.finish` 的 `allSettled` 出现拒绝。当前 `finish` 只 allSettled 订阅与已接纳操作，本增量无订阅，实际不会拒绝，因此不是缺陷；
   但下一增量接入订阅后需决定是否上报，避免排空失败静默。
4. **注释把它称为“容量”，实际是并发上限。** 池每请求结束即释放句柄（`handle-pool.test.ts`「释放后重新取得会打开新句柄」已固定该行为），
   所以 `STORAGE_HANDLE_LIMIT`/`STORAGE_HANDLE_CONTEXT_LIMIT` 只约束并发中的访问，与 README「不保留空闲句柄」一致。无需改行为，若后续文档强调“上限”可补一句限定。

## 未验证项

- auth-on 下「撤销 session 后再释放上下文」的 HTTP 行为未在 t24 用例中触发：fixture 用 `resolveSubject` 覆盖走到 auth-off 分支，该路径沿用 t23 的 session 绑定与撤销证据。
  从代码推断：`releaseStorageUserContext` 会先经 `bindSession` 检查并在 `auth-changed` 时 403，注册表层释放本身保持幂等（返回 `false`）。
- `legacy-value` 响应体（含原值与原 revision）未做字段级泄漏断言；它按设计需要把旧值交给 owner 迁移，不属于诊断泄漏。
- 未验证 Windows 以外平台、整套产品启动、真实用户旧键迁移与 Project/文件/备份集成；均不在本增量范围。

## 已知非目标（不计为缺陷）

浏览器长期句柄、网络订阅与背压、断网语义、Project 生命周期接线、旧桶迁移，均由 t24 与接续边界显式声明为下一增量。
