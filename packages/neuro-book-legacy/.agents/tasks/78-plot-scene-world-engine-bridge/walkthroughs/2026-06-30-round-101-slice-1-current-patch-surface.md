# Round 101: Slice 1 Current Patch Surface

## Scope

本轮只读复核 Slice 1 `Profile Contract Cleanup` 的当前补丁面。目标是把“要改哪些文件、拒绝哪些旧语义”压到当前 worktree 证据。没有改业务代码、没有运行测试。

## Current Evidence

`server/agent/profiles/builtin-contracts.ts`:

- `DirectorOutputSchema.plot_updates[].kind` 仍允许 `"plot"`。
- `DirectorOutputSchema` root 仍包含 `simulator_requests`。
- root object 和 `plot_updates[]` item 没有显式 `additionalProperties: false`。
- 尚无 `world_engine_requests` 字段。

`assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`:

- tools 已是 Scene-only Plot tools，没有旧 `create_story_plot`，这是已完成部分。
- prompt 仍写“用户、leader.default 或 simulator.leader 确认后的剧情结构落库”。
- prompt 仍写“在需要未裁决世界状态时调用 simulator.leader，或在 simulator_requests 中列出”。
- workflow 仍有 `Simulation gate`。
- report contract 仍要求 `simulator_requests`。

`workspace/.nbook/agent/profiles/builtin/director.profile.tsx`:

- user root 也仍包含 `simulator.leader`、`simulator_requests`、`Simulation gate`。
- 因为 user root 会覆盖 system root，Slice 1 不能只改 `assets/workspace/...`。

`leader.default` / reference:

- `reference/agent/leader-default.md` 仍写 leader.default “不维护 Plot 系统”且“plot / simulator / director / emulation 都不在 leader.default 的职责内”。
- `reference/agent/profile-routing.md` 仍写 `leader.default` 不路由到 Plot / simulator / director / RP。
- `reference/agent/novel-writing-workflow.md` 仍写 writer 不读取 Plot，leader 只先推进 World Engine 后调 writer；没有 Scene/brief compiler 路径。
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx` 的 system prompt 也仍写“不要立刻写入 Plot/Lorebook”，World Engine 段未引入 director/brief compiler 角色。

`writer`:

- writer root tools 正确：有 `execute_world`，无 Plot tools。
- writer system prompt 当前职责是“基于 brief 和 World Engine 状态”写正文，这方向正确。
- 但 `normalizePayloadContext()` 注释仍写“写作模式不使用 Plot 系统”，应改为“writer 不直接持有 Plot tools；可消费上游完整 Scene / World Context brief；payload 中旧 ids 不渲染”。

## Patch Surface

Slice 1 应按这个补丁面推进：

1. `server/agent/profiles/builtin-contracts.ts`
   - 删除 `simulator_requests`。
   - 新增 `world_engine_requests: string[]`。
   - 删除 `plot_updates[].kind = "plot"`。
   - 给 root 和 `plot_updates[]` item 设置显式 strict。

2. `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
   - 删除 simulator gate 语言。
   - 改为：director 不写 World Engine；未决世界状态通过 `world_engine_requests` 返回 leader。
   - 保持 director 是 Plot write owner 和 future brief compiler。
   - 说明 `get_chapter_writer_brief` 是后续工具，未落地前不能写成当前可调用能力。

3. `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
   - 普通写作链路应承认 director 是 Scene/Chapter/brief specialist。
   - 第一阶段不把 Plot tools 给 leader.default；涉及 Scene/Chapter/brief 时创建/调用 director。
   - leader 仍是用户/canon/World Engine owner。

4. `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
   - 不加 Plot tools。
   - 修正文案：writer 不直接使用 Plot tools，但可消费上游完整 Scene / World Context brief。
   - 保持旧 `threadIds/sceneIds/plotIds` 不渲染给 writer。

5. `reference/agent/leader-default.md`
   - 删除“director 不在职责内”的写法。
   - 改成 leader.default 不直接拥有 Plot write tools；需要 Scene/Chapter/brief 时路由 director。

6. `reference/agent/profile-routing.md`
   - leader.default 的错位建议应包含 director。
   - director 的错位建议应把世界状态未决交回 leader/default World Engine owner，而不是 `simulator.leader`。

7. `reference/agent/novel-writing-workflow.md`
   - 主链改为 leader 与 director 协作准备 Scene / World Context brief，再由 leader 调 writer。
   - writer 仍不直接读取 Plot tools；它消费完整 message brief 和 `input.path`。

8. `workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
   - 通过非 force user assets sync 或手工同步机制处理，不允许留下 active user shadow 指向旧 prompt。

## Test Surface

Slice 1 测试应至少覆盖：

- `DirectorOutputSchema` 新合同通过。
- 旧 `simulator_requests` root 字段失败。
- 旧 `plot_updates[].kind = "plot"` 失败。
- root extra 字段失败。
- item extra 字段失败。
- director prompt 包含 `world_engine_requests`，不包含 `simulator_requests` / `Simulation gate` / `simulator.leader`。
- leader.default prompt/reference 可路由 director。
- writer profile 无 Plot tools，但 prompt/注释允许消费上游 Scene / World Context brief。

## Stop Condition

如果实现时无法同时处理 user root shadow，不应声称 runtime profile contract 已完成。最多只能声明 system source 已更新；active catalog / compiled artifact 仍需另行验证。

## Conclusion

Slice 1 的补丁面已经明确，且与 Round 100 的入口结论一致。后续实现不需要等待 `ChapterWriterBriefService`；先把 director/leader/writer 的 profile contract 从旧 simulator gate 切到 World Engine request + Scene/brief compiler 协作模型。
