---
schema: nbook.task/v2
taskId: t49-migration-review
role: reviewer
---

# t47 迁移门禁与备份边界的独立审查

**状态：待审查。** 对 [t47](../t47-legacy-state-migration/README.md) 的迁移门禁、浏览器暂存、data 备份边界与条件导入做对抗性复核；结论只按证据。

被审 revision：`8263726e`（t47 增量）。合同依据：[迁移合同](../../../../../packages/neuro-book/docs/migrations/storage-state.md)、[storage.persistence](../../../../../docs/specs/storage/persistence.md)、[storage.boundaries](../../../../../docs/specs/storage/boundaries.md)。
审查者的历史口径参考：[t46 检查点 A 审查](../t46-checkpoint-a-review/walkthroughs/review.md)（同为 Adversarial 审查：等价类、断言强度、失败静默）。

## 只读约束

- 不改产品代码、不改产品测试、不改 t47 目录；只在 `walkthroughs/` 下新增探针与 `review.md`。
- 不提交、不 push、不联网、不访问 3001；不覆盖用户 dirty 文件 `app/utils/workbench/descriptors{,.test}.ts`。
- 命令用 worktree 绝对 cwd；探针夹具放本 Task 的 `walkthroughs/probes/`。

## 问题清单（逐条给结论与证据）

- **Q1 暂存早于旧 writer**：`enforce:"pre"` + 等 `staged` 的假设是否成立？对抗验证：模块加载期不读旧桶、首次实例化才水合、门禁在写回前生效；已有原件时不读旧桶、不覆盖；其它版本冲突；
  多标签并发创建暂存（同浏览器两个上下文/两次插件执行）是否真的不会双写或覆盖。
- **Q2 冻结语义**：serializer 是否只固定三个源字段（原本缺失保持缺失），未迁字段是否仍由原 writer 正常持久化；
  完整旧 JSON 损坏时的处理是否与合同一致（合同只要求"其它字段使用各自默认并允许正常保存"）；冻结期是否存在把运行期值写回旧桶的第二条路径。
- **Q3 备份完整性**：分块/清单/回读核验能否发现截断、缺块、块被改写、块顺序错乱；多字节字符跨块与 UTF-8 字节度量是否正确；
  8 MiB 上限与"无法先保留原件才冻结整桶"的边界是否如实现声明。
- **Q4 条件导入**：`value`/`legacy-value`/`deleted`/`missing`/`unsupported-version`/`corrupt` 六分类是否各自落到正确结局；
  目标墓碑（用户重置）与备份边界墓碑相反处理是否有合同依据且不会误伤；条件写冲突后是否绝不覆盖目标。
- **Q5 进度与完成标记**：目标删除/分区回收后不重新导入；完成标记读取失败不得当作未迁移；其它版本/来源不能改写；
  `retry()` 是否可能重复导入或回滚已有目标。
- **Q6 状态可观察**：`blocked` 分类是否互不混同（暂存失败 / 身份不可恢复 / 后端不可达 / 备份失败 / 导入失败 / 进度或完成标记读写异常）；
  是否存在把失败静默成成功的路径（对照 t46 的 P2 教训）。
- **Q7 生产注册入口**：`server/storage/product-definitions.ts` + `server/plugins/storage-definitions.ts` 的重复注册幂等性与 dev HMR；
  未注册时的失败是否可见且可诊断；t48 追加定义的约定是否明确。
- **Q8 断言强度**：审计 t47 四个测试文件的断言是否真能失败（等价类、重复谓词、只断言不抛、把实现细节当行为）；
  指出"缺一例就漏一类缺陷"的空洞。

另：Leader 已修一处测试类型断言（`novel-ide-legacy-writer.test.ts` 的 `globalThis` 断言改为模块级替身变量，`?` 项目规则 `ts-no-inline-cast-access`）——请核对修后语义未变（仍是同一替身、检查仍在）。

## 交付

- `walkthroughs/probes/`：至少 3 个对抗探针（优先 Q1 多标签、Q3 块改写/截断、Q5 完成标记读取失败或 retry 幂等），每个探针说明它试图证伪哪条声明。
- `walkthroughs/review.md`：结论先行（需修复 / 建议合并）、逐问题裁定与证据、被审文件 SHA256、命令与退出码、未验证项、非阻断观察。
- 可复现命令与工作树状态；不修改任何产品文件。

## 继续条件

若判定需修复，缺陷交回 t47（原 Task 内闭合），修复后在本 Task 追加「追加复核（修复后）」小节再给最终裁定。