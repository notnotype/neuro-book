---
schema: nbook.task/v2
taskId: t46-checkpoint-a-review
---

# 检查点 A 独立审查：公共类型、身份、生命周期与插件消费

**状态：待审查。** 计划切片 3 的收口门禁：在开始大量主页面接线（切片 4）之前，独立复核 grid 持久化宿主的公共边界是否真的满足 [ui.nested-grid](../../../../../docs/specs/ui/nested-grid.md) 与 [storage.persistence](../../../../../docs/specs/storage/persistence.md)，并可被后续主工作台直接复用。

Work：[w00003](../../README.md)。被审对象：t44 的宿主实现与其消费者契约。
只读审查：不修改产品代码；发现缺陷写复现与建议，由 Leader 分派修复。

## 被审对象

- `packages/neuro-book/app/utils/workbench/storage-grid-host.ts` 与 `storage-grid-host.test.ts`（t44，本轮新增）
- 相邻边界：`app/utils/workbench/storage-context.ts`、`storage-plugin-sample.ts`（t40，已提交 `7a5d04de`）、`app/utils/storage/**`（t26/t35）、`shared/storage/**`
- 原语合同：`packages/nb-ui/src/components/layout/grid.md`、`Splitter.md`、`app/components/workbench/workbench-branch-layout.ts`（百分比→px 既有口径）
- 证据：[t44 implementation](../t44-plugin-grid-storage-host/walkthroughs/implementation.md)、[核心验证](../../storage-core-validation.md)

## 必须回答的问题

1. **公共类型与边界**：`defineGridLayoutState`/`createGridLayoutHost`/`composeGridLayoutRecord` 是否支撑后续主工作台直接复用（记录格式、寻址、字段级意图、诊断）；有没有与既有约定重复的第二套（状态投影、错误分类、手势换算、合并策略）；是否引入 Vue/Pinia/文件系统依赖。
2. **身份与寻址**：resource 是否满足共享 action 合同；`records: "single" | "identified"` 的使用是否有歧义；Project scope 是否只经有效 ready 取得句柄、禁止从残留 projectRoot 或 user scope 兜底；同名叶/同 owner 多资源是否可能串记录。
3. **生命周期**：`release()` 是否先停接纳再排在途；失效/换代后旧引用是否真的拒绝新写（无补写失效句柄）；工作台上下文释放与宿主释放的责任划分是否清晰、有无泄漏或双释放。
4. **原件合成**（重要数据边界）：未知字段、未知引用叶（含位置与顺序）、未知兄弟结构在保存后是否逐项保留；是否任何路径都可能用过滤后的 `serialize()` 覆盖原件；`skipped`/`applied` 分类是否可解释且不丢字段。
5. **手势与外来确认**：一次手势是否只提交一次且只含主动字段（不得把被动补偿写成偏好）；订阅是否只更新已确认基线、不重挂呈现、不打断手势；迟到初始快照或乱序更新是否会污染当前显示或基线。
6. **CAS 冲突与失败分类**：冲突重读只重放本次主动字段；二次冲突是否真的停止自动重试并保留未保存意图；`committed === null` 的未确认结果是否既不报已保存也不报未写入；`retry()`/`abandon()` 的语义是否与 Spec 的「重试/放弃入口」一致且不清其它记录；读取失败是否区别于缺失（不得把 I/O/损坏当 `missing` 写默认值）。
7. **planning 一致性**：`legacy-value`/`unsupported-version`/`corrupt`/结构非法是否一律禁止普通保存并保留原件，且与 `projectStorageState` 投影一致。

## 证据要求

- 在 worktree 内 `packages/neuro-book` 绝对 cwd 复跑 t44 聚焦测试并记录用例数；只读复核不得改测试。
- 对上述每条给出**探针**：最小复现片段（临时测试文件写进 `walkthroughs/probes/` 或直接给出命令与结果），逐条标注 通过 / 不成立 / 未验证；不得只引用作者报告。
- 关注测试质量：断言是否只覆盖实现细节（调用次数、字段拷贝）而缺少可观察行为；列出**缺失用例**清单（例如 deleted 与 missing 的分类、结构编辑落点、订阅乱序）。
- 结论固定到所审文件的 SHA256 与 git revision；给出「建议合并 / 需修复」及阻断项、非阻断观察。

## 产物

`tasks/t46-checkpoint-a-review/walkthroughs/review.md`：范围、方法、命令与退出码、逐条结论与探针、缺失用例、阻断/非阻断清单、hash 与 revision。
不修改产品代码、不提交、不 push、不联网、不访问 3001。最终回复具体结论，不返回空文本或句点。
