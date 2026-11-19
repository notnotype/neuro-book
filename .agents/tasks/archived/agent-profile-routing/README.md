# Agent Profile Routing

## 用户需求

用户反馈当前 Agent 系统里用户经常选错 agent。入口型 leader 之间需要知道彼此和常用专用 profile 的简单介绍；当 agent 发现当前任务与自身职责不同时，应建议用户创建并转到对应 agent。

## 目标

- 新增共享 profile 路由参考，让入口 leader 统一获得职责地图。
- 让 `leader.default`、`leader.assets`、`rp.leader`、`simulator.leader` 导入该路由参考。
- 不改变 `AgentCatalog` 的轻量索引职责，不新增前端 UI。
- 更新测试、reference 索引和用户文档入口，避免 prompt、文档和测试漂移。

## 调研结论

- `AgentCatalog` 当前只渲染 profile key/name/description/source，并有测试明确约束“不展开 schema 和工具细节”。路由规则不应塞进默认 catalog 文案。
- 系统 profile 运行真相来自 `.compiled` artifact；修改 builtin `.profile.tsx` 后必须重新编译系统 profiles。
- `leader.default` 已导入 `reference/agent/leader-default.md`，但 `rp.leader`、`simulator.leader` 和 `leader.assets` 不适合直接导入它，因为其中包含默认主创 leader 的专属深度协议。

## 实现记录

- 新增 `reference/agent/profile-routing.md`：
  - 覆盖入口 leader：`leader.default`、`leader.assets`、`rp.leader`、`simulator.leader`。
  - 覆盖专用 profile：`director`、`writer`、`rp.writer`、`retrieval`、`researcher`、`llmlint`。
  - 写明职责、适合/不适合任务、错位时建议转向和交接 checklist。
- 更新四个 builtin leader profile，在 `AgentCatalog` 附近导入 `reference/agent/profile-routing.md`。
- 更新 reference 和 docs 入口：
  - `reference/agent/README.md`
  - `docs/agent/index.md`
  - `docs/index.md`
- 更新 profile 测试断言，覆盖四个入口 profile 的新 reference 导入和错位路由关键词。

## 计划与实际出入

- 计划不改前端 UI，实际也未改前端 UI。
- 计划不改 `AgentCatalog`，实际也未改 `AgentCatalog`。
- 计划新增共享 reference 并导入四个入口 profile，实际按计划完成。

## 验证

- `bun scripts/build/profile.ts check --all --system`：通过。
- `bun scripts/build/profile.ts compile --all --system`：通过，刷新 13 个系统 profile artifact。
- `bun scripts/build/profile.ts status --all --system`：全部系统 profile 为 `loaded`。
- `bun scripts/build/prepare-system-assets.ts`：通过，系统变量 definition 1 个、系统 profile 13 个，compiled stale 数量为 0。
- `bun test C:/Users/<user>/Documents/CodeRepository/GithubProjects/neuro-book/server/agent/profiles/leader-assets-profile.test.ts C:/Users/<user>/Documents/CodeRepository/GithubProjects/neuro-book/server/agent/profiles/rp-profiles.test.ts C:/Users/<user>/Documents/CodeRepository/GithubProjects/neuro-book/server/agent/profiles/simulation-director-profiles.test.ts`：通过，22 tests passed。
- `rg -n "profile-routing|当前任务与自身职责" assets/workspace/.nbook/agent/profiles reference docs PROJECT-STATUS.md`：通过，确认 profile 源码、reference、docs、walkthrough 和 PROJECT-STATUS 均已同步。
- `rg -n "profile-routing" assets/workspace/.nbook/agent/profiles/.compiled -uuu`：通过，确认四个入口 profile 的 compiled artifact 均包含新 Import 路径。

备注：直接运行相对路径形式 `bun test server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/rp-profiles.test.ts server/agent/profiles/simulation-director-profiles.test.ts` 时，Bun 同时匹配到 `product/server/...` staged 镜像测试；该镜像的 compiled profile 状态和部分旧断言未随本轮 source 改动刷新，因此该形式不是本轮主路径验证结果。
