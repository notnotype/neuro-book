# Round 142 Leader-Owned Reference and Test Gate

## Goal

补齐 Round 141 后暴露的系统性遗漏：普通写作主链已经在 `leader.default` profile 中改为 leader 直接负责 Plot / Scene，但稳定 reference 和测试门禁仍存在旧 director 主链或假测试路径。

本轮目标：

```text
剧情初步设计 -> 推进 World Engine -> 剧情设计 -> 更新 Plot -> get_chapter_writer_brief -> 调用 writer
```

## Changes

- `reference/agent/novel-writing-workflow.md`
  - 普通写作主链改为 `leader.default` 直接负责 Plot / Scene、World Engine 推进、`get_chapter_writer_brief` 和 writer 调度。
  - 删除普通流程中的“Plot 由 director 管理”“调度 director / writer”“结构化 Thread / Scene / Chapter Plot 交给 director”。
  - `director` 只保留为高级或手动剧情导演 profile。
- `reference/plot/system.md`
  - Agent Tools 增加 `get_chapter_writer_brief`。
  - Agent Consumption 改为调用 writer 前优先编译 brief；status 非 `ready` 时再补 Plot、World Anchor 或 World Context。
- `reference/plot/agent-spec.md`
  - Scene 落库责任从 “Director” 改为 “Leader（或手动 director）”。
  - writer 遇到 Scene 粒度、World Context 或事实矛盾问题时默认回报 leader。
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` 与 active user 覆盖版
  - writer brief 来源改为 “leader（或手动 director）”，避免普通提示词继续暗示 director 是默认上游。
- `server/agent/profiles/writer-profile-contract.test.ts`
  - 迁移原 assets writer test 的有效断言到 server 测试面，确保默认 Vitest include 能收集。
  - 增加 Scene / World Context brief 消费语言和 legacy `threadIds/sceneIds/plotIds` 不进入 writer input context 的断言。
- `server/agent/profiles/leader-owned-plot-reference.test.ts`
  - 新增稳定 reference contract 测试，防止普通写作主链回退到 director。
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts`
  - 删除。该文件不在当前 `vitest.config.ts` include 范围内，传给 Vitest 也不会被执行，不能作为门禁。
- `docs/drafts/writer-profile-testing-guide.md`
  - 测试命令改为 `server/agent/profiles/writer-profile-contract.test.ts`，避免继续指向已删除的 assets 测试。

## Actual Result vs Plan

与计划一致：

- 稳定 reference 已统一到 leader-owned Plot / Scene 主链。
- 不扩大 `vitest.config.ts` include；writer profile contract 迁到 server 侧。
- 历史 walkthrough 不批量重写，只在当前 Round 记录中说明旧 director-only 内容是历史过程。

计划外但必要：

- 同步更新 writer profile system/user 两份源码。原因是 writer prompt 自身仍写 “leader/director 生成的 brief”，会削弱最小 director 口径。

## Verification

已执行：

- `bun scripts/build/profile.ts check builtin/leader.default.profile.tsx --system`
- `bun scripts/build/profile.ts check builtin/leader.default.profile.tsx`
- `bun scripts/build/profile.ts check builtin/writer.profile.tsx --system`
- `bun scripts/build/profile.ts check builtin/writer.profile.tsx`
  - 结果：全部通过。
- `bunx vitest run server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/simulation-director-profiles.test.ts server/agent/profiles/writer-profile-contract.test.ts server/agent/profiles/leader-owned-plot-reference.test.ts server/agent/tools/plot-tools.test.ts server/plot/services/chapter-writer-brief.service.test.ts server/plot/services/scene-world-context.service.test.ts --reporter=dot`
  - 结果：7 个测试文件、36 个测试通过。
- 编译 profile artifacts：
  - `bun scripts/build/profile.ts compile builtin/leader.default.profile.tsx --system`
  - `bun scripts/build/profile.ts compile builtin/leader.default.profile.tsx`
  - `bun scripts/build/profile.ts compile builtin/writer.profile.tsx --system`
  - `bun scripts/build/profile.ts compile builtin/writer.profile.tsx`
- active manifest 检查：
  - system/user `leader.default` 均为 `loaded`，active artifactSha 为 `ea8fa5e1233cf0838d47ebe97478bd445c9b89de2eb4df5f9110d03995a5ca69`。
  - system/user `writer` 均为 `loaded`，active artifactSha 为 `580af8f84ecc5ecefa3b4c88addafbf89a51ff88bbb5f494266ad31209039e63`。
  - `typeDiagnostics` 均为空。
- active artifact 静态搜索：
  - `leader.default` artifact 包含 `get_chapter_writer_brief` 和新主链文案。
  - `writer` artifact 包含 `leader（或手动 director）生成的 Scene / World Context brief`。
  - active artifacts 未命中旧规则：`结构化 Thread / Scene / Chapter Plot 交给 \`director\``、`由 \`director\` 管理`、`Thread / Scene / Chapter Plot / writer brief 编译转`、`上游 leader/director`。
- 稳定 reference / 草稿静态搜索：
  - `reference/`、`docs/drafts/`、Task 78 README 和 `PROJECT-STATUS.md` 未命中旧普通写作转 director 规则或旧 assets writer test 命令。
  - `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts` 已不存在。
