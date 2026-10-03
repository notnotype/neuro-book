# Round 109: Agent Tool Binding Acceptance Matrix

## Scope

本轮把 Slice 4 `Agent Tool Binding` 的验收矩阵压成逐层清单。前置 Slice 1-3 仍然不能跳过；本轮只说明 brief service 完成后，怎样证明它真的成为 Agent 可用能力。没有改业务代码、没有运行测试。

## Binding Stack

`get_chapter_writer_brief` 从 Plot service 到 director 可用，至少穿过这些层：

1. `PlotFacade.getChapterWriterBrief(projectPath, chapterPath)`。
2. HTTP route / OpenAPI route-map entry。
3. `server/agent/tools/plot-tools.ts` runtime tool。
4. `server/agent/tools/index.ts` global builtin registry。
5. `server/agent/profiles/profile-tools.ts` typed binding：`builtin.plot.getChapterWriterBrief`。
6. system director source `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx` root toolset。
7. active user director source `workspace/.nbook/agent/profiles/builtin/director.profile.tsx`，或明确消除 user shadow。
8. compiled manifest + active artifact。
9. `get_agent_profile("director")` discovery result 的 `toolKeys`。

任意一层缺失，都只能说明 service 或 route 存在，不能说明 Agent 可用。

## Acceptance Matrix

| Layer | Evidence | Failure Mode |
| --- | --- | --- |
| Facade | `PlotFacade` 暴露 `getChapterWriterBrief()` 并返回 `ChapterWriterBriefDto` | Agent tool 需要绕过 facade 直接 import service。 |
| HTTP/OpenAPI | `/_openapi.json` 含 `GET /api/projects/plot/chapter-writer-brief`，query 为 `projectPath/chapterPath` | UI/外部调用可用性不可证明，catch-all operation 可能覆盖。 |
| Runtime tool | `createBuiltinTools()` 含 `get_chapter_writer_brief`，description/params 正确 | profile 绑定 key 存在但 runtime registry 缺工具。 |
| Tool result | text 为 `suggestedBriefMarkdown`，details 为完整 DTO | director 默认看到 JSON dump，handoff 成本上升。 |
| Typed binding | `builtin.plot.getChapterWriterBrief` 存在 | director source 只能用 untyped `pluginTool()` 或字符串绕过。 |
| Director source | system/user director toolset 都包含 brief tool，prompt 指导调用 | system 改了但 user shadow 仍跑旧 source。 |
| Writer isolation | writer toolKeys 不含 Plot/brief tools | writer 可能绕过 director 直接读 Plot，职责重新混乱。 |
| Discovery | `get_agent_profile("director").toolKeys` 含 brief key | leader 无法确认 director 有 brief 能力。 |
| Compiled runtime | active `profiles.director.artifactSha` 指向的新 artifact 含 brief key，不含旧 simulator gate | 源码测试绿但运行仍用旧 artifact。 |

## Test Placement

建议测试分布：

- `server/agent/tools/plot-tools.test.ts`：tool key、参数 schema、description、text/details、selection-free。
- `server/agent/tools/agent-collaboration-tools.test.ts`：`get_agent_profile` 只返回 toolKeys/schema summary 的发现口径保持稳定。
- `server/agent/profiles/simulation-director-profiles.test.ts`：director rootToolKeys 包含 brief tool，prompt 含 brief workflow，不含旧 simulator gate。
- writer profile 测试：writer 仍无 Plot tools，但 prompt 不再说“完全不使用 Plot”，而是“可消费上游 Scene / World Context brief”。
- compiled proof：profile compile/status 后检查 system/user manifest `profiles.director.artifactSha` 和 `.compiled/artifacts/<sha>.mjs` 内容。

## Slice Ordering Guard

Slice 4 不能提前于 Slice 1-3：

1. 如果 director contract 仍有 `simulator_requests`，brief tool 会被绑到旧输出协议上。
2. 如果 OpenAPI explicit path 未完成，HTTP route-map 会继续有 catch-all 多 operation 表达缺口。
3. 如果 `ChapterWriterBriefService` 未完成，tool adapter 会被迫承担业务逻辑，破坏 locality。

因此实现顺序保持：

```text
Profile Contract Cleanup -> OpenAPI Explicit Path -> Chapter Writer Brief Module -> Agent Tool Binding
```

## Conclusion

Agent 可用性不是“有一个函数”或“有一个 route”，而是 runtime tool、global registry、typed profile binding、director exposure、discovery result 和 compiled artifact 同时成立。Slice 4 的验收必须逐层证明，尤其不能漏掉 active user root 和内容寻址 artifact。

