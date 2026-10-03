# Round 110: Profile Topology Final Recheck

## Scope

本轮在 Round 28 / Round 30 / Round 109 之后重新比较 profile 拓扑。目标是确认是否还有必要改成别的拓扑，或者继续采用 Director + Brief Compiler。没有改业务代码、没有运行测试。

## Current Evidence

当前代码和 reference 仍有明显落差：

- `leader.default.profile.tsx` 持有 `execute_world(readwrite)` 和 agent 调度工具，不持有 Plot tools。
- `director.profile.tsx` 持有 Plot read/write tools 和 `get_scene_world_context`，但还没有 `get_chapter_writer_brief`。
- `writer.profile.tsx` 持有 `execute_world(readonly)`，不持有 Plot tools。
- `world.engine.profile.tsx` 持有 `execute_world(readwrite)`，不持有 Plot tools。
- `reference/agent/leader-default.md` 和 `reference/agent/profile-routing.md` 仍写着普通写作不路由 Plot / director，这是旧状态，和 Task 78 当前设计冲突。

因此问题不是“拓扑未决”，而是“源码和 reference 还没有落到已决拓扑”。

## Alternatives Rechecked

| Topology | Interface Shape | Current Verdict |
| --- | --- | --- |
| Leader Monolith | `leader.default` 同时负责用户、canon、World Engine、Plot、brief、writer 调度。 | 不采用。Interface 过宽，World Engine 与 Plot 写入规则会集中在一个 profile prompt 中，Locality 下降。 |
| Writer Self-Serve Plot | `writer` 直接持有 Plot/brief tools，自己拉 Scene 和 World Context。 | 不采用。writer 会越过上游的信息控制，且需要理解 Plot 状态、World Context 查询和写作目标三套规则。 |
| World Engine Owns Brief | `world.engine` 兼任 brief compiler。 | 不采用。它会从 World Engine maintenance Module 变成 Plot/正文协作 Module，职责扩张。 |
| Dedicated Brief Profile | 新增 `brief.compiler` profile，只读 Plot/World Context 并输出 writer brief。 | 后置观察项。当前只有一个 adapter，新增 profile 会增加 agent 往返和 discoverability 层数。 |
| Director + Brief Compiler | `director` 负责 Plot Thread/Scene 和 brief 编译，`leader.default` 负责 canon/World Engine，`writer` 只写正文。 | 第一阶段采用。Interface 分工清楚，能把 brief 复杂度收进 `ChapterWriterBriefService` 和 director。 |

## Deletion Test

删除 `director`：

- Plot Thread/Scene 写入规则会回到 `leader.default`。
- `leader.default` prompt 必须同时约束 World Engine 写入、Plot 结构维护、brief 编译和 writer 调度。
- brief 生成前的 Scene 修正会缺少 owner。

这说明 `director` 不是浅转发 Module，它承担 Plot 结构 locality。

删除 `ChapterWriterBriefService`：

- status precedence、World Anchor warning、Thread/Scene writing tip、World Context 摘要和 markdown renderer 会散到 Agent tool、HTTP route 或 director prompt。
- 测试只能从多个 adapter 侧间接证明，Interface 变浅。

这说明 brief compiler 必须是深 Module，不应靠 prompt 串工具替代。

新增 `brief.compiler` profile：

- 可以把 brief 编译从 `director` 拆出，但第一阶段只有一个 adapter，尚未出现第二个真实 Adapter 证明这个 seam 必要。
- 多一个 profile 会让 `leader.default -> director -> brief.compiler -> writer` 变成长链，增加错误面。

按“One adapter = hypothetical seam. Two adapters = real seam.”，当前不新增专门 profile。

## Decision

第一阶段继续采用：

```text
leader.default -> director -> writer
              -> world.engine only for complex World Engine maintenance
```

其中：

- `leader.default` 不直接持有 Plot write tools。
- `director` 持有 Plot read/write 和 `get_chapter_writer_brief`。
- `writer` 不持有 Plot/brief tools，只消费 `invoke_agent.message` 中完整 brief。
- `world.engine` 不持有 Plot/brief tools。
- `ChapterWriterBriefService` 是 deep Module；Agent tool 是 adapter。

## Conclusion

没有新的证据支持换拓扑。当前主要工作是把已决拓扑落地到 profile contract、reference、runtime tool binding 和 compiled artifact，而不是继续引入新 profile 或扩大 leader/writer 工具面。

