# @notnotype/nb-canon

作者视角的世界引擎内核（w00039）：在任意一章的开头或末尾算出每个设定当时的样子，每一处变化都有描述和出处。

- 行为合同：[`docs/specs/canon/`](../../docs/specs/canon/)（components、model、revisions、rendering、project 五份）。
- 取舍：[ADR 0037](../../docs/adr/0037-world-engine-story-change-log.md)（剧情变更日志与修订）、[ADR 0038](../../docs/adr/0038-world-engine-entry-text-is-whitelisted-mdx.md)（白名单 MDX）、[ADR 0039](../../docs/adr/0039-world-engine-segmented-revision-log.md)（分段的只追加日志）。
- 入口：`.` 前后端共用；`./node` 是只在 Bun 里用的分段日志存储。
- 验证：在本目录 `bun test` 与 `bun run typecheck`。
