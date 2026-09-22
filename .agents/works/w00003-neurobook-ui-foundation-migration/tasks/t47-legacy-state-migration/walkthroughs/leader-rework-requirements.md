# t47 返工要求（独立审查后）

依据：[t49 审查记录](../../t49-migration-review/walkthroughs/review.md)（被审 revision `8263726e`，裁定"需修复"）。
探针：`../../t49-migration-review/walkthroughs/probes/`（5 文件 9 例，连跑三次 exit 0）。

| # | 级别 | 要求 | 探针/证据 |
|---|---|---|---|
| R1 | P2 | **续跑必须重新核验已存在的原件副本**：`ensureOriginalBackup` 在清单命中且与浏览器暂存一致时不得直接返回；须至少读回分块并按 `verifyOriginalBackup` 拼回核验（与浏览器暂存侧的每次启动重算摘要口径一致）。分块被截断、两块交换、某块丢失都必须被发现并进入可诊断的失败分类，而不是快照报 `complete`。 | `q3-backup-integrity.probe.test.ts`；对照运行（清掉清单+完成标记）会重写分块并通过核验 |
| R2 | P2 | **定义注册对模块重新实例化保持幂等**：`server/storage/product-definitions.ts` 的模块级数组在 HMR 模块图重载后是新实例，而注册表按实例身份判定，重载后注册插件抛 `STORAGE_DEFINITION_INVALID`（`storage-host-hmr.test.ts` 设计上宿主跨重载存活）。给出真正幂等的注册策略并保留"宿主内已有等价定义可继续服务"的行为。 | `q7-registration-hmr.probe.test.ts`（`vi.resetModules()` + 真实插件与真实注册表） |
| R3 | P3 | **容量声明闭合**：暂存上限按原文 UTF-8 字节，分区容量按记录文件字节（原文里的 `"` 与反斜杠各占两字节）。须让"被暂存接受的原件一定能放进声明的分区"，或在上限处按记录文件字节口径预检并给出如实分类；"可重试"不得掩盖放不进去的原件。 | `q3-capacity-boundary.probe.test.ts` |
| R4 | P3 | **交付记录数字如实**：`walkthroughs/implementation.md` 的聚焦用例数为 44（22 + 15 + 5 + 2），且 `storage-migration-legacy-bucket.test.ts` 为 15 例；不要沿用 49/20。 | 审查者复跑 4 文件 44 例 exit 0 |
| R5 | P3 | **让"完成后重置不重新迁入"用例真正走机制**：当前在 `phase === "complete"` 时调 `retry()`，而 `retry()` 在完成态直接返回快照，断言必然通过。改为新建控制器（等同重启）后断言，使机制被破坏时用例会失败。 | `q5-completion-retry.probe.test.ts` |

## 顺序与协作

- **R2 与 t48 代理（`WorkbenchAuthority`）冲突**：该代理当前正在向 `server/storage/product-definitions.ts` 追加 grid 定义。
  动手改这个文件前先 `hub send` 给 `WorkbenchAuthority` 约定顺序（或等它提交后再做），改完再通知它继续；不要与它并发编辑同一文件。
- R1、R3、R4、R5 与 t48 无文件重叠，可先行。
- 保持既有约束：不改 `shared/storage/**` 既有合同文件、不改 `app/utils/storage/**` 与 `server/storage/**` 既有实现（R2 只改 `product-definitions.ts` 这一新增文件）、不提交、不访问 3001。
- 完成后在本 Task 追加实现记录小节（新增/变更文件、命令、退出码、用例数），并 `hub send` 通知 `MigrationReview` 做追加复核。