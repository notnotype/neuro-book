# Round 112: Completion Audit Matrix

## Scope

本轮建立 Task 78 后续 Agent 易用性改造的完成审计矩阵。目标是防止实现后只凭“代码看起来有了”就判断完成。没有改业务代码、没有运行测试。

## Requirement Matrix

| Requirement | Proof Needed | Current State |
| --- | --- | --- |
| Profile topology uses Director + Brief Compiler | profile source、reference、tests 都表达 leader -> director -> writer | 未完成。reference 仍有不路由 director/Plot 的旧语言。 |
| `DirectorOutputSchema` removes simulator contract | `Value.Check()` 新合同通过，旧 `simulator_requests` / `kind: "plot"` / extra fields 失败 | 未完成。当前 schema 仍含 `simulator_requests` 和 `kind: "plot"`。 |
| director prompt removes simulator gate | system/user source 和 active artifact 不含 `Simulation gate` / `simulator_requests` | 未完成。system/user director source 仍含旧语言。 |
| leader can route Scene/Chapter/brief work to director | leader profile/reference/test 命中 director routing 规则 | 未完成。reference 仍排除 director/Plot。 |
| writer consumes upstream brief but has no Plot tools | writer rootToolKeys 无 Plot/brief，prompt 允许 Scene / World Context brief | 部分完成。无 Plot tools 已成立，prompt 注释仍偏旧。 |
| OpenAPI supports explicit catch-all paths | generated spec 同时含 world-context 和 chapter-writer-brief 独立 operation，route-local meta 不静默覆盖 | 未完成。`RouteMetaEntry.path` / `emitRouteMeta` 尚未实现。 |
| `ChapterWriterBriefService` is deep Module | DTO、repository read model、status fixture、markdown assertions 全部存在 | 未完成。service/DTO/read model 尚未实现。 |
| brief tool is selection-free adapter | tool test 证明 input 只有 projectPath/chapterPath，text 是 markdown，details 是 DTO，不写 `plot.selection` | 未完成。tool 尚未实现。 |
| Agent binding stack complete | runtime tool、global registry、typed binding、director toolset、`get_agent_profile`、compiled artifact 全部证明 | 未完成。Round 109 的各层仍缺。 |
| Compiled runtime uses new contract | active system/user manifest `artifactSha` 指向新 artifact，artifact 不含旧 simulator gate | 未完成。当前 artifact 仍有旧合同。 |

## Strong Evidence Rules

完成判断必须使用强证据：

- 文件存在不是强证据，除非检查了具体内容。
- 绿色测试不是强证据，除非测试覆盖对应 requirement。
- source 修改不是 runtime 证据，compiled manifest/artifact 也必须检查。
- `get_agent_profile` 只能证明 toolKeys/schema summary，不能证明 tool description。
- faux harness smoke 只能证明链路，不能替代真实模型行为。

## Minimal Implementation Gates

按四个切片验收：

### Slice 1: Profile Contract Cleanup

必须证明：

- `builtin-contracts.ts` strict 新 schema。
- system/user director source 新 prompt。
- leader.default/profile-routing/novel-writing-workflow 允许 Scene/Chapter/brief 路由 director。
- writer prompt 不再表达“普通写作完全不使用 Plot”，而是“不直接持有 Plot tools，可消费上游 brief”。
- profile/schema tests 通过。
- compiled artifact 更新。

### Slice 2: OpenAPI Explicit Path

必须证明：

- `RouteMetaEntry.path?: string`。
- `emitRouteMeta?: boolean` 或等价 representative 机制。
- generated spec 有独立 paths。
- route-local meta generator 不会同 file 多 entry last-wins。

### Slice 3: Chapter Writer Brief Module

必须证明：

- `ChapterWriterBriefDtoSchema` 在 `shared/dto/plot.dto.ts`。
- `findChapterScenesForBrief()` 拿到 Scene writingTip 和 Thread summary/writingTip。
- Scene entity-level World Context helper 被复用。
- fixture 覆盖 status precedence。
- markdown 正负断言覆盖信息边界。

### Slice 4: Agent Tool Binding

必须证明：

- `get_chapter_writer_brief` tool text/details contract。
- runtime registry、typed binding、director rootToolKeys。
- writer isolation。
- `get_agent_profile("director").toolKeys`。
- compiled artifact。

## Conclusion

当前 Task 78 的架构设计已充分，完成状态仍未成立。后续若进入实现，必须按本矩阵逐项证明，不能用单一测试、单一 source diff 或单一 route 存在来覆盖完整 Agent 易用性目标。

