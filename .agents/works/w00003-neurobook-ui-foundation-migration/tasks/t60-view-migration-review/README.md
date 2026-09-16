---
schema: nbook.task/v2
taskId: t60-view-migration-review
role: reviewer
---

# 视图迁移增量独立复核（t55 / t56）

**状态：待复核。** t55（`files` 视图接入）与 t56（尺寸归属收尾）引入了**新的共享迁移原语与会话范式**，此后所有视图迁移都会复用它们，因此按本 Work 惯例做独立对抗复核（前例：t46 检查点 A、t49 迁移、t51 检查点 B）。

被审 revision：`c2152f83`（含 `aec1e0d8` t55、`4bf1562a` t56、`ef51c81b` t57、`6f9813c1` t59）。依据：[清单 §2.1/§2.6/§2.7](../../view-migration-inventory.md)、[storage.persistence](../../../../../docs/specs/storage/persistence.md)、[storage.boundaries](../../../../../docs/specs/storage/boundaries.md)、[迁移合同](../../../../../packages/neuro-book/docs/migrations/storage-state.md)。

## 只读约束

- 不改产品代码、不改产品测试；只在 `walkthroughs/` 下新增探针与 `review.md`。
- **不启停 3001**（开发者使用中）；**不启动第二个 dev server**（共享 `.nuxt`）；需要真实浏览器先 `hub send` 报 Main。
- 不提交、不 push、不联网；不覆盖用户 dirty `app/utils/workbench/descriptors{,.test}.ts`；命令用 worktree 绝对 cwd。

## 问题清单

- **Q1 迁移原语正确性**（`app/utils/workbench/legacy-record-migration.ts`）：状态机（deferred/settled/notice）与各失败分类是否穷尽且互斥；「只在记录缺失时条件初始化」是否在所有竞态下成立；**回读一致后才删旧键**是否会被绕过（例如读回失败、并发第二次调用、诊断分支）；旧键保留语义是否与迁移合同一致。
- **Q2 单写者**：`files` 展开项（`files-view-session.ts`）、两个窗口尺寸（`window-size-session.ts`）、World Engine 三处尺寸（`world-engine-session.ts`）是否各有且仅有一条写路径；组件内是否残留旧键读写、store 直写或第二套默认值；`novel.ide.local` 是否已不再承载已迁字段。
- **Q3 会话接线**（`user-record-session.ts`）：首读门禁（读取完成前不提交、缺失不落默认）、跨工作面切换（Project A/B、user-assets、非 Project 上下文）、释放/订阅语义、失败可见（不静默）是否成立；`files-view-session.ts` 抽取后对外 API 与行为是否与抽取前等价（对照 `aec1e0d8` 版本）。
- **Q4 记录定义**：`shared/storage/workbench-files.ts`、`workbench-window-sizes.ts`、`workbench-world-engine.ts` 的 owner/key/schemaVersion/limits/默认值/校验是否符合 `persistence.md` 的归属与 `boundaries.md:103/121`；注册是否只经唯一入口 `server/storage/product-definitions.ts`；重复注册与 HMR 幂等是否仍成立（对照 t49 的 F2 修复）。
- **Q5 视图解析**（`product-catalog.ts` + `WorkbenchViewHost.vue`）：`when` 求值、懒实例化、未知 factoryKey 的失败可见、t55 修过的 `DescriptorResult` 包装层缺陷是否被回归覆盖；`viewFactoryResolver` 注入缝隙默认路径是否真的不被产品使用、且不会在缺省时改变行为。
- **Q6 断言强度**：审计 t55/t56/t59 新增测试（`files-view-session`、`window-size-session`、`world-engine-session`、`product-catalog`、`WorkbenchViewHost`、`WorkspaceFilePanel`）是否真能失败；指出等价类缺口；特别核对被改写的契约测试 `world-engine-workbench-preview.test.ts` 是否**加严**而非放宽。
- **Q7 旧实现与待办**：t55/t56 声称删除的旧路径（`index.vue` 未用 import、占位块、裸键读写、World Engine 尺寸 ref）是否确实不再存在；四个 legacy 组件「因契约测试断言而保留」的结论是否成立（核对 `world-engine-ide-entry.test.ts` 的具体断言）。
- **Q8 文档与实现一致性**：`WorkbenchViewHost.md`、`WorkspaceFilePanel.md` 的契约与实现是否一致（含 t59 自述的两处收窄：重命名/递归确认失败为未捕获拒绝、树读取失败无专门文案）；Lab 可挂载性判定（挂载 / 阻断理由）是否与标签规则一致。

## 交付

- `walkthroughs/probes/`：至少 3 个对抗探针（优先 Q1 回读失败与并发、Q2 第二写路径、Q5 注入缝隙缺省行为），每个说明试图证伪哪条声明。
- `walkthroughs/review.md`：结论先行（需修复 / 建议合并）、逐问题裁定与证据、被审文件 SHA256、命令与退出码、未验证项、非阻断观察。
- 若判定需修复，缺陷交回对应 Task（t55 或 t56）闭合，修复后在本 Task 追加「追加复核（修复后）」再给最终裁定。