# World Engine API / Calendar / EmbeddingText 收口

> Active task。围绕本轮 World Engine 工具调用阻碍报告，收口 `execute_world` 沙箱 API 形态、修复 EmbeddingText 容器初始化死锁，把新项目默认 Calendar 模板与 reference 示例改到可直接工作的现实日历基线，并把 schema/calendar loader 收紧为单文件配置契约。

## Relative documents refs

- `docs/tasks/71-world-engine-codeact-readwrite/README.md`：`execute_world`、`world.gets` / `world.getMany`、`world.editMutations`、`patchId` 与读写合一契约来源。
- `docs/tasks/56-world-engine/agent-tools.md`：当前 Agent 工具契约文档，需要同步 API 命名与 `editMutations` 边界。
- `docs/tasks/76-world-engine-issue-contract/README.md`：WorldIssue catalog 与 UI 展示契约的独立 active task；本任务只同步交叉链接，不把 issue 文案治理并入 API / loader / EmbeddingText 收口。
- `reference/world-engine/README.md`：World Engine reference 入口。
- `reference/world-engine/calendar-system.md`：Calendar 配置、Simple / Gregorian / Custom 说明与示例。
- `reference/world-engine/examples/calendar-simple.ts`：Simple Calendar 示例，已修正 `cycleNames.length === ratio` 规则。
- `reference/world-engine/quick-reference.md`、`reference/world-engine/subject-lifecycle.md`、`reference/world-engine/api-migration-zod.md`、`reference/world-engine/schema-system.md`、`reference/world-engine/recording-principles.md`：可能引用 `world.getMany` / `editMutations` / Calendar 示例或 `/events` 写法的速查文档。
- `reference/agent/leader-default.md`、`reference/agent/novel-writing-workflow.md`、`reference/agent/profile-routing.md`：Agent reference 中仍可能保留旧 World API 名称或 `world.getMany` 示例。
- `assets/workspace/.nbook/agent/skills/novel-workflow-world-engine-init/SKILL.md`：World Engine 初始化 skill。压缩前诊断确认它仍在教旧协议 `execute_world_query` / `write_world_slice`，会继续误导初始化流程。
- `assets/workspace/.nbook/agent/skills/novel-workflow-08-plot-planning/SKILL.md`：剧情事实确认与 World Engine 状态推进的主流程；当前仍残留 `execute_world_query` / `write_world_slice` / `delete_world_slice`、`world.getMany` 和字符串 `/events` 示例。
- `assets/workspace/.nbook/agent/skills/novel-workflow-09-chapter-writing/SKILL.md`、`assets/workspace/.nbook/agent/skills/novel-workflow-writer-execution/SKILL.md`：写作流程 skills 中可能残留旧只读工具名，需要与当前 `execute_world` / writer readonly 契约对齐。
- `assets/workspace/.nbook/agent/profiles/builtin/world.engine.profile.tsx`、`assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`：builtin profile 也是 Agent 工具形态入口，需要同步 `world.gets` / `patchId` / readonly 边界。
- `assets/workspace/.nbook/templates/project-directory-templates/world-engine/calendar.ts`：新 Project Workspace 的默认 Calendar 模板，本任务主要修改点；文件内 Simple / Gregorian 注释示例也要同步修正。
- `workspace/ming-ding-zhi-shi-2/world-engine/calendar.ts`、`workspace/ming-ding-zhi-shi-2/world-engine/schema/index.ts`：用户明确需要同步迁移的现有 Project Workspace。
- `workspace/ming-ding-zhi-shi-2/.nbook/project.sqlite`：该项目已有 World Engine 数据；若 schema 从 `z.array(z.string())` 迁到 `EmbeddingText`，必须同步迁移旧 `/events` patch 数据。
- `scripts/seed-world-engine-demo.ts`、`scripts/seed-heroes-story.ts`、`scripts/write-chapter-01-slices.ts`：仍使用旧平铺 `world.*` API 的脚本，分组 API 落地时需要同步迁移或明确废弃。
- `server/world-engine/codeact-api.ts`：`world.gets` / `world.getMany` / `world.editMutations` 实现。
- `server/agent/world-engine-tool-description.ts`：`execute_world` 对 Agent 暴露的 API 签名和行为说明，必须停止主动展示 `world.getMany`。
- `server/world-engine/patch-operations.ts`：EmbeddingText 容器禁止整块 replace 与 `append` 缺基准问题。
- `server/world-engine/schema-loader.ts`：schema default 与 list / collection 默认空数组收集逻辑。
- `workspace/.nbook/agent/sessions/268.jsonl`：用户点名的本地复现 session。压缩前诊断确认它没有复现 calendar 热加载失败，而是证明首次解析前改好的 calendar 能被 `execute_world` 使用，并暴露 EmbeddingText 初始化死锁。
- [Task 125 Round 04](../125-runtime-artifact-storage-lifecycle/walkthroughs/round-04-workspace-test-isolation.md)：接续本任务 Round 06 的 Windows SQLite 清理，把 World Engine 测试 Project 迁入独立临时 Workspace Root，并删除产品侧测试前缀遮掩。

## User Request / Topic

- 用户提交了 World Engine 工具调用阻碍报告，重点包括：
  - EmbeddingText 字段无法初始化：`replace /events []` 被禁止，`append /events` 又缺少数组基准。
  - Calendar Simple 示例与实现不一致：`cycleNames` 长度必须等于 `ratio`，但示例 `ratio: 90` 只给 4 个季节名。
  - `world.getSlice("subjectId")` 查不到切面，因为它需要的是 `sliceId`。
  - `editMutations.add` 无法绕过数组初始化限制。
  - `world.getMany(ids)` 与 `world.gets(ids)` API 形态重复。
- 压缩前诊断补充：
  - `session 268` 实际使用当前 `execute_world`，并成功解析修改后的“星辉纪元” calendar，落库 4 个 subject、4 个 slice、13 个 patch；它没有复现 calendar 热加载失败。
  - `session 268` 真正暴露的是 `events: z.array(EmbeddingText()).default([])` 初始化死锁，最后 Agent 删除了所有 `/events` patch 绕过问题。
  - 初始化 skill `novel-workflow-world-engine-init` 仍在教旧协议 `execute_world_query` / `write_world_slice`，即使后端修好，也会继续误导 Agent 走旧流程。
  - 剧情推进主 skill `novel-workflow-08-plot-planning` 也仍在教旧协议，并且示例使用 `world.getMany` 与字符串 `/events`，它是本轮必须迁移的高优先级入口。
  - builtin `world.engine` profile 与 `execute_world` tool description 仍主动展示 `world.getMany`；用户已确认 `getMany` 不再隐藏保留，而是直接删除。
  - 多份 reference / skill 示例把 `/events` 当 `string[]` 写入；若默认 schema 使用 `EmbeddingText`，`append /events` 的 value 应统一为 `{text:"..."}` 形态。统一原因不是偏好，而是避免同一个字段在默认 schema、reference、skill 示例里同时出现字符串数组和 EmbeddingText 对象数组两套语义，导致 Agent 按旧示例写出无法通过 schema / embedding 校验的 patch。
- 用户明确本轮方向：
  1. 讨论并确认 `editMutations` 当前是什么、mutation 是否有 id、能否根据 mutation 改。
  2. World API 形态需要重新讨论设计；已确认 `world.getMany(ids)` 不再保留 alias，直接删除。
  3. World API 改为分组 API；用户已确认 `editMutations` 改名并迁移为 `world.slice.editPatches`。
  4. 分组 API 形态采用 `world.time.*` / `world.subject.*` / `world.search.*` / `world.slice.*`。
  5. 技术术语尽量统一为 `patch` / `patchId`；`mutation` 不再作为当前 API / 类型 / 提示词术语。
  6. 修 Calendar 文档和示例；默认模板应改到 `assets/workspace/.nbook/templates/project-directory-templates/world-engine`，默认使用现实日历系统，format 到分钟、不带秒。
  7. 同步迁移现有项目 `workspace/ming-ding-zhi-shi-2`；该项目已有 SQLite 数据，实施前必须确认 calendar / schema / 旧 patch 数据迁移策略。
  8. Calendar / schema 热加载风险原本先不做；后续已纳入本 task，并按用户确认收紧为单文件配置入口。

## Goal

/goal 完成 World Engine API / Calendar / EmbeddingText 三项收口，verified by：新增或更新针对 EmbeddingText 空容器初始化、分组 World API、`world.slice.editPatches` / `patchId` 文档契约、Gregorian 默认模板 parse/format、schema/calendar 单文件 loader 契约、初始化 / 剧情推进 / 写作 skills 当前协议的测试或静态断言通过；相关 reference / task / bundled skills / builtin profiles 文档与模板一致；`bun run test server/world-engine server/agent/tools` 中受影响用例通过；必要时 `bun run typecheck` 通过。Constraints：calendar/schema 热加载风险已在 Round 03 纳入修复，Round 05 收紧为内容 hash 稳定缓存，Round 07 收紧为单文件配置入口；入口文件内容变化可热加载，本地文件、绝对路径和 URL/protocol import/export 直接报错，只允许包级 import 与 `node:` 内置模块，不做依赖图热加载；不引入 SQL 直写绕过；不改变 WorldPatch 事件溯源核心语义；不破坏 writer readonly 边界；历史 walkthrough / migration 文档可保留 `mutation` 作为历史名词，但当前 API、类型、tool description、profile、skill 和 reference 应尽量统一为 `patch`；迁移 `workspace/ming-ding-zhi-shi-2` 前必须先确认是否改写已有 SQLite 数据。Boundaries：优先修改 `server/world-engine/**`、`server/agent/world-engine-tool-description.ts`、`docs/tasks/56-world-engine/agent-tools.md`、`reference/world-engine/**`、`reference/agent/**`、`assets/workspace/.nbook/agent/skills/**` 中的 World Engine 相关 skill、`assets/workspace/.nbook/agent/profiles/builtin/**` 中的 World Engine 相关 profile、`assets/workspace/.nbook/templates/project-directory-templates/world-engine/calendar.ts`、`assets/workspace/.nbook/templates/project-directory-templates/world-engine/schema/index.ts`、`workspace/ming-ding-zhi-shi-2/world-engine/**`、`scripts/**` 中调用 `execute_world` 的脚本与相关测试；`workspace/ming-ding-zhi-shi-2/.nbook/project.sqlite` 仅在迁移策略确认后处理。Iteration policy：先以最小复现锁定 EmbeddingText 初始化死锁，再修代码和文档；Calendar 先修模板与示例，并同步用户指定现有项目；World API 分组形态已确认，实施时统一修改实现、文档、profile 和 tool description。Blocked stop condition：若允许空容器初始化会破坏 embedding 向量一行一条的存储约束，停止并报告替代设计；若 `ming-ding-zhi-shi-2` 的 schema/calendar 迁移需要重写既有 WorldPatch 数据但策略未确认，停止并报告。

## Initial State Before Round 01

> 以下是创建 task 时的初始盘点，用来保留问题证据链；Round 01 已完成大部分实现，当前状态以 Implementation Walkthrough 和 walkthrough 文件为准。

- `editMutations` 已存在于 `execute_world` readwrite 模式：先 `world.getSlice(sliceId)` 读取完整 slice，再按 `patchId` 对 patch 做 `set` / `remove` / `add`，最后调用 `service.editSlice` 整块替换该 slice。
- mutation 术语在实现层已经收口为 patch；DB 表是 `WorldPatch`，每行有 UUID，Agent 读到的是 `patchId`。没有单独的 `mutationId`。
- `editMutations` 能根据 `patchId` 改；不能根据 `subjectId` 自动定位某条 patch。编辑后旧 `patchId` 会失效，需要重新 `getSlice`。
- `world.gets(ids)` 和 `world.getMany(ids)` 当前是同一个函数；用户已确认 `getMany` 直接删除，不再作为旧别名保留。
- `server/agent/world-engine-tool-description.ts` 和 builtin `world.engine` profile 仍在主动展示 `world.getMany`，删除实现时也必须同步移除所有提示面、reference 和测试引用。
- `world.getSlice(id)` 当前只接受 `sliceId`，不接受 `subjectId`。按 subject 查相关切面应使用 `world.slices({withPatches:true})` 后过滤，或未来另加查询便利接口。
- EmbeddingText 容器当前禁止整块 `replace`，这是为了保证“一条 EmbeddingText = 一行 WorldPatch/vector”；但这也拦住了 `replace /events []` 和 `replace /memory {}` 这类空容器初始化。
- schema default 收集逻辑理论上会为 list / collection 建立空数组基准；但 embedding 容器保护会在 reduce 时把空数组初始化视作 `embedding-whole-replace`，导致后续 `append /events` 缺少数组基准。
- reference 与 bundled skills 中仍有多处 `append /events` 的 value 是裸字符串。修复空容器初始化后，如果这些示例不改成 `{text:"..."}`，Agent 仍会写出不符合 `EmbeddingText` schema 的 patch。
- 新项目 Calendar 模板当前默认 `type: 'simple'`，format 是 `{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}:{second:02}`。
- Calendar 默认现实日历 format 已确认到分钟、不带秒：目标输入/输出形态为 `公元2020年4月12日 18:00`。
- Calendar reference、示例和默认模板注释中存在 `ratio: 90` 搭配 4 个 `cycleNames` 的错误示例；当前实现明确要求 `cycleNames.length === ratio`。
- `workspace/ming-ding-zhi-shi-2` 不是空项目：`.nbook/project.sqlite` 当前已有 `WorldSubject=15`、`WorldSlice=11`、`WorldPatch=209`；其中 `/events` patch 存在裸字符串 append。若把该项目 schema 从 `events: z.array(z.string())` 迁到 `EmbeddingText`，需要同步迁移数据库里的旧 patch value。
- `workspace/ming-ding-zhi-shi-2/world-engine/calendar.ts` 当前是 `type: 'simple'`、`eraAfter: '复兴纪元'`，format 带秒；需要确认是改成 Gregorian 公历，还是保留奇幻纪年但去秒 / 修示例。
- `scripts/seed-world-engine-demo.ts`、`scripts/seed-heroes-story.ts`、`scripts/write-chapter-01-slices.ts` 仍使用旧平铺 `world.*` API；分组 API 删除旧入口后这些脚本必须迁移或废弃。
- `session 268` 的真实证据链：项目 `workspace/shi-jie-yin-qing-fu-xian` 在首次 `execute_world` 写入前改好了 `calendar.ts` / `schema/index.ts`，随后 `星辉纪元1年1月1日 00:00` 与 `星辉纪元312年1月5日 06:00` 均解析写入成功。这说明“首次加载前改好的 calendar 能生效”，不能证明热加载失败，也不能排除后续热加载缓存风险。
- `session 268` 最终为了通过初始化删除了 `/events` patches，因此初始化结果缺少经历流数据；这应作为 EmbeddingText 修复后的回归场景。
- `novel-workflow-world-engine-init` 仍在讲 `execute_world_query` / `write_world_slice` 旧协议。Agent 初始化 World Engine 时会读这份 skill，所以它属于本任务的必修文档面。
- `novel-workflow-08-plot-planning` 仍在讲 `execute_world_query` / `write_world_slice` / `delete_world_slice` 旧协议。它是剧情推进和状态写入主入口，优先级不低于 init skill。

## Decisions / Discussion

- **D1：技术术语统一为 patch / patchId**。文档、提示词、类型和公开 API 应说“patch / patchId”，避免继续把 WorldPatch 叫 mutation id。原因：DB 表、类型和投影已经是 `WorldPatch` / `PatchInput` / `patchId`；每条记录也是 JSON Pointer path + op + value 的补丁操作。`mutation` 只可作为面向用户的自然语言“状态变化”描述，不作为 API 术语。
- **D2：删除 `world.getMany(ids)`**。用户已确认不做隐藏兼容 alias；公共 API、sandbox 类型、tool description、reference、profile、skills 和测试统一迁移到分组 API 的 `world.subject.gets(ids)`。
- **D3：World API 改为分组 API**。公共沙箱 API 不再把 subject、slice、time、search 方法平铺在 `world.*` 下；改为按领域分组，例如 `world.subject.*`、`world.slice.*`、`world.time.*`、`world.search.*`，用调用路径降低 Agent 把 subjectId 传给 slice API 的概率。
- **D4：`editMutations` 迁移为 `world.slice.editPatches`**。它是精确修 slice 中的 patch，不是建 subject 或按 subject 查询切面。修错 patch：先 `world.slice.get(sliceId)` 或 `world.slice.list({withPatches:true})` 拿 `patchId`，再 `world.slice.editPatches(sliceId, edits, meta?)`。新 subject 仍走 `world.slice.write` 首写自动建 subject。
- **D4a：分组 API 目标形态**。当前任务按以下公共 API 落地：

```ts
world.time.parse(text)
world.time.format(instant)
world.time.now()

world.subject.get(id)
world.subject.gets(ids)
world.subject.list(type?)
world.subject.findRefs(targetId, sourceType?)

world.search.text(query, options?)

world.slice.list(options?)
world.slice.get(sliceId)
world.slice.write(input)
world.slice.editPatches(sliceId, edits, meta?)
world.slice.delete(sliceId)
```

- **D5：EmbeddingText 允许空容器初始化**。允许 `replace /events []` 和 `replace /memory {}` 作为初始化基准；继续禁止 `replace /events [{text: "..."}]` 或 `replace /memory {key:{text:"..."}}` 这类承载实际 embedding 内容的整块写入。
- **D6：Calendar 默认模板改为 Gregorian 现实日历，默认不带秒**。新 Project Workspace 默认应适合现代/校园/现实题材，减少初始化时 parse 失败概率。默认 format 到分钟即可；秒作为 Gregorian 能力保留在 reference / 进阶示例。Simple Calendar 留作进阶示例。
- **D7：修文档示例，不放宽 `cycleNames.length === ratio` 校验**。当前规则是合理的：`cycleNames` 是该单位每个取值的名称表。错误在文档示例，而不是校验。
- **D8：Calendar / schema 热加载风险原计划暂缓，Round 03 已覆盖，Round 05 收紧。** 压缩前诊断发现 `calendar.ts` / `schema/index.ts` 都通过同路径动态 import，理论上有模块缓存风险；`session 268` 没有复现该风险，只证明首次解析前改好的 calendar 生效。Round 03 确认 Bun 同路径 `.ts` import 缓存风险真实存在并修复，Round 05 改为内容 hash 稳定缓存，避免每次调用都制造新的 module cache entry。
- **D9：不建议通过 SQL 直写表绕过 World Engine**。`WorldSlice` / `WorldSubject` / `WorldPatch` 是内部持久层；Agent 和修复方案应走 service / facade / `execute_world`，避免破坏 issue、embedding、reduce 与事务语义。
- **D10：初始化 skill 必须跟随当前工具协议**。`novel-workflow-world-engine-init` 应改为单一 `execute_world`，示例使用分组 API，例如 `world.time.parse` / `world.slice.write` / `world.slice.editPatches`，并解释 writer readonly；不再教 Agent 直接调用旧 `write_world_slice`。
- **D11：剧情推进和写作 skills 也必须跟随当前工具协议**。`novel-workflow-08-plot-planning` 是 World Engine 写入主流程，必须和 init 一起迁移；09 / writer-execution 只保留 readonly `execute_world` 查询说明，不再出现旧工具名作为当前流程。
- **D12：EmbeddingText 示例统一使用对象载荷**。默认 `events: z.array(EmbeddingText()).default([])` 时，`append /events` 的 value 必须写成 `{text:"..."}`；裸字符串示例只适用于明确声明 `z.array(z.string())` 的 schema。
- **D13：同步迁移用户指定现有项目**。除 bundled template 外，本任务还要迁移 `workspace/ming-ding-zhi-shi-2` 的 world-engine calendar / schema，保证该项目不会继续沿用旧默认模板或旧 `/events` 语义。

## Decisions After Round 01

- **Superseded D14：`ming-ding-zhi-shi-2` 的 `/events` 暂不迁到 `EmbeddingText`。** 这是 2026-06-29 的阶段性决定，已被 D27 取代；保留本条只用于解释历史状态。
- **D27：`ming-ding-zhi-shi-2` 的 events + memory 迁到 `EmbeddingText`，SQLite 必须由受控维护脚本同步迁移。** schema 的 world / character / faction / location / item `events` 与 character `memory` 统一使用 `EmbeddingText`。旧 `/events` 非空数组 replace 拆成 `replace []` + 同 slice 独立 append，旧字符串 append / memory replace 改成 `{text}`；迁移默认 dry-run，`--apply` 才先备份、再单事务重写受影响 slice，并做 patch 计数与 slice 级文本 reduce 等价验证。生产 World API 不增加历史数据绕过入口。
- **D28：`world.search.text` 必须区分“无检索能力”和“能力存在但无数据”。** schema 或选定 type 没有 EmbeddingText、显式 type/attr 不合法时返回 400；只有检索范围合法但当前没有 embedding 文本行时才返回 `[]`。校验发生在 embedding 网络请求之前。
- **Resolved D15：`ming-ding-zhi-shi-2` 的 Calendar 保留复兴纪元 Simple Calendar。** 本轮只去掉秒并修正文档示例，不把奇幻纪年强行改成 Gregorian。
- **Resolved D16：readonly 分组 API 不注入写方法。** writer readonly 模式下没有 `world.slice.write` / `world.slice.editPatches` / `world.slice.delete`，tool description、sandbox 类型和测试跟随该形态。
- **Resolved D17：旧脚本直接迁移到分组 API。** `scripts/**` 中的当前 seed / write 脚本不标记废弃，已迁移 `world.slice.*` / `world.subject.*` / `world.time.*`。
- **Deferred D18：World API 下一轮设计。** 本任务只落地已确认的分组 API 与删除 `world.getMany` / `editMutations` 迁移；更大的 API 形态问题，例如 subject 到 slice 的便利查询、批量读取命名、列表过滤 DSL、返回缺失项的语义，应单独讨论，不混入本轮实现。
- **Resolved D19：`EmbeddingText.vector` 不作为 Agent 初始化字段。** Agent 只写 `{text:"..."}`；`vector` 由 embedding / reduce 链路维护，错误信息已明确这一点。

## Decisions After Round 03

- **Resolved D20：按 subject 查切面走 `world.slice.list` 过滤，不重载 `world.slice.get`。** `world.slice.get(sliceId)` 继续只读单个切面；CodeAct `world.slice.list` 暴露已有后端 `subjectIds` / `subjectMode` 能力，用于 `subjectId -> slices` 查询。
- **Resolved D21：task checklist 保持分支局部状态，但真实 turn 内双写 immediate + savePoint。** immediate 写入保证同一轮后续工具能读到，savePoint 写入保证 transcript 持久化后任务状态仍在当前 active path 上；不改成全 session projection。
- **Resolved D22：calendar/schema 热加载风险已按单文件配置契约收紧。** Bun 对同一路径 `.ts` import 会复用编译缓存，URL query 不足以破缓存；loader 导入同目录内容 hash 临时副本并在导入后删除。Round 05 改为进程内按 hash 复用 import promise，避免随机文件名导致长期运行中 module cache 无界增长。Round 07 按用户决策收紧为单文件配置入口：`world-engine/calendar.ts` 与 `world-engine/schema/index.ts` 的入口内容变化可热加载；本地文件、绝对路径和 URL/protocol `import` / `export ... from` 直接报错；包级 import（如 `zod`、`nbook/world-engine/schema`）与 `node:` 内置模块继续允许。Round 11 把 hash 临时模块从 `.ts` 改为转译后的 `.mjs` 再导入，避免旧 Node / 非 Bun 宿主依赖 TypeScript import 支持。不做多文件依赖图热加载，也不假装支持拆分文件。
- **Resolved D23：运行时生成 `.mjs` 统一走 server 原生动态 import seam。** 用户 Product 报错证明 Nitro/Rollup/esbuild 会把普通 `await import(variable)` 接管为 bundle resolver，导致 World Engine hash `.mjs` 这类运行时文件在 Windows Product Root 下从空 importer resolve 失败。Round 12 新增 `importRuntimeArtifact()`，World Engine loader、profile artifact store、profile artifact compiler 校验导入和 variable definition artifact 导入统一走该 seam；artifact path、`pathToFileURL`、原生动态 import 与按 cache key 命名的物理缓存都由该 Module 统一处理。它只用于 server 内部 artifact 文件导入，不进入 CodeAct 沙箱，也不改变配置入口或 artifact 格式。
- **Resolved D25：World Engine loader 补齐物理 artifact cache。** 用户后续错误路径仍指向 Project Workspace 下短生命周期 `.world-engine-*.mjs`，说明 Round 12 虽已统一 import seam，但 World Engine 调用未使用 `cacheKey/cacheNamespace/expectedBytes`。Round 13 将 calendar/schema 转译产物导入补齐到 `runtime-artifact-import-cache/world-engine-<label>/<hash>.mjs`，Project 目录临时 `.mjs` 只作为中转并继续清理；导入失败时包装 source、artifact、hash 与原始错误，避免把临时文件清理误判为配置或数据库损坏。
- **Resolved D26：World Engine runtime artifact 归入 Project Workspace `.nbook`。** 2026-07-18 发现 Round 13 把物理 cache 放在 `world-engine/**/.runtime-artifact-import-cache`，会被 Project watcher/history 当成外部内容变更。calendar/schema cache 与转译中转文件迁入 `.nbook/runtime-artifact-import-cache`；源码旁旧 cache 在新路径成功导入后清理。`.staging/.world-engine-*` 的清理范围覆盖写入本身：即使 `writeFile` 只写入部分内容后抛错，本轮文件也会在最外层 `finally` 删除，且写入错误保留原始 I/O 语义，只有 native import 失败才包装为 World Engine artifact 错误。native dynamic import seam、内容 hash 热加载与 cache namespace 保持不变。
- **Resolved D23：EmbeddingText 公共写入拒绝 `vector` / `model`。** `vector` / `model` 是系统维护字段；Agent/API 只写 `{text:"..."}`，向量列由 WorldPatch embedding 链路维护。
- **Resolved D24：World Engine 测试清理不再使用生产删除 fallback。** `WorldEngineFacade.runInTransaction` 改为普通 client 显式 `BEGIN/COMMIT/ROLLBACK`，避免 `@libsql/client.transaction()` 在 commit 后遗留 native Database 句柄；`collectReleasedSqliteHandles` 同时支持 Bun GC 与 Node/Vitest GC；`world-engine.facade.test.ts` 恢复严格 `fs.rm` 清理，若 SQLite 句柄未释放应直接失败。

## Overall Review Addendum

这轮不是三个互不相关的小修，而是一次 World Engine 当前协议面的收口：运行时 API、Agent 文案、bundled template、reference、skills、profiles、测试和现有 Project Workspace 数据会同时受到影响。实现时应把它当成“破坏性 API 迁移 + 默认模板修正 + 可选数据迁移”处理，不要只修后端函数名。

建议按四层验收：

1. **Runtime contract**：`execute_world` 沙箱只暴露分组 API；`world.getMany` 与旧平铺写入口不再作为当前 API 存在；readonly/write 边界由测试覆盖。
2. **Agent instruction surface**：tool description、builtin profiles、bundled skills、reference 不再教 Agent 使用旧工具名、旧平铺 API、`mutation` 技术术语或字符串 `/events` 默认写法。
3. **Template / reference baseline**：新 Project Workspace 默认 Calendar 能直接解析现实时间 `公元2020年4月12日 18:00`；Simple Calendar 示例合法；默认 schema 的 `EmbeddingText` 写法和文档一致。
4. **Existing workspace data**：`workspace/ming-ding-zhi-shi-2` 不能按新模板机械覆盖；它已有 SQLite 数据和字符串 `/events` patch，必须先确认 schema/calendar 策略，再决定是否做受控数据迁移。

实现中的关键护栏：

- 删除旧 API 时不要用隐藏 alias “温柔兼容”回来；这会继续让 Agent 学到两套入口。若内部需要辅助函数，应保持在实现内部，不暴露到 sandbox / tool description / profiles / skills。
- `world.slice.editPatches` 的语义是编辑某个 slice 的 patch 列表，不是按 subjectId 修改状态。调用者必须先拿到 `sliceId` 和 `patchId`；编辑后旧 `patchId` 可能失效，文档要提醒重新读取 slice。
- EmbeddingText 修复只允许空容器基准初始化。非空内容仍应一条文本一条 patch 写入，避免破坏“一条 EmbeddingText = 一条可嵌入/可追踪 patch”的核心约束。
- 如果允许空容器 replace 后仍然出现 `append /events 缺少已存在的数组基准`，优先排查 schema default / reduce 初始化链路，不要通过文案要求 Agent 手写 SQL 或绕过 service。
- Calendar 默认模板与示例已收口；热加载风险已纳入 Round 03/05/07。实现中继续避免把热加载变成运行时自动编译、依赖图猜测或 SQL 直写绕过。
- 脚本、测试、skills、profiles 中的旧调用是迁移对象，不是“历史兼容证据”。只有 archived / walkthrough / migration 说明里可以保留旧名作为历史描述。
- 本任务需要实际 walkthrough 文件记录实现轮次、偏离原 task 的设计选择、验证结果和未决策项；不要只在 README 的总览段落里追加流水账。

## Task Review Addendum

本 task 的主要风险不是单点 bug，而是“协议面漂移”：后端实现、tool description、profile、skill、reference、脚本和现有 Project Workspace 只要有一处继续教旧写法，Agent 就会重新走回旧路径。因此实现时要把扫描对象分成两类：

- **当前协议面**：runtime API、tool description、builtin profiles、bundled skills、reference quickstart / workflow、未归档 task 文档、seed / demo 脚本。这里不应再推荐旧工具名、旧平铺 `world.*` API、`world.getMany`、`editMutations` 或 `mutation` 技术术语。
- **历史 / 迁移说明**：archived、walkthrough、migration 对照表、旧问题复盘。这里可以保留旧名，但必须明确它们是历史名词或迁移前 API。

需要补充关注的遗漏点：

- **错误信息也要改**：EmbeddingText 修复不能只改校验逻辑。非空整块 replace 被拒绝时，错误应说明“空容器 replace 可用于初始化，真实文本请用 append / path-level replace 一条条写入”，否则 Agent 仍然不知道正确替代路径。
- **`/events` 不是必须统一为对象的偏好问题**：统一 `{text:"..."}` 只适用于默认 schema 使用 `EmbeddingText` 的当前协议面。若某个现有项目明确保留 `z.array(z.string())`，它的项目内示例和数据迁移可以继续使用字符串，但必须和默认模板 / reference 分开说明。
- **现有项目迁移要拆成两条线**：`ming-ding-zhi-shi-2` 的 Calendar 迁移和 `/events` schema 迁移相互独立。Calendar 可以只去秒或改 Gregorian；events 可以保留 string 或迁到 EmbeddingText。任何组合都要先做只读盘点，再决定是否改 SQLite。
- **不要用 API 重命名掩盖查询语义问题**：`world.slice.get(sliceId)` 只按 `sliceId` 查 slice；它不能因为命名迁移而继续让 Agent 误以为可以传 `subjectId`。subject 到 slice 的便利查询属于 OD5 的后续 API 设计。
- **脚本不是边缘文档**：`scripts/**` 里的旧 API 在删除平铺入口后会直接坏掉。要么迁移到分组 API，要么在 walkthrough 中明确标记废弃和原因。
- **静态扫描要带白名单**：最终扫描旧词时，应把当前协议面和历史说明分开统计，避免为了“零命中”把有价值的迁移记录也删掉。
- **测试要覆盖破坏性删除**：除了验证新 API 可用，还要覆盖旧平铺 API / `world.getMany` 不再暴露，避免未来有人为了兼容又悄悄加回 alias。

## Reproduction Notes

**EmbeddingText 初始化死锁：**

```text
schema: events = z.array(EmbeddingText()).default([])

首次创建 subject 需要建立 /events 基准
→ replace /events []
→ embedding 字段 /events 禁止整块 replace

改用 append /events {text:"..."}
→ append /events 缺少已存在的数组基准
```

预期修复后：

```text
replace /events []       ✅ 允许，空容器初始化
append /events {text:""} ✅ 允许，真实 embedding 内容一条 patch 一条文本
replace /events [{...}]  ❌ 仍禁止，避免一行 patch 承载多个向量
```

**Calendar 示例错误：**

```ts
{ name: "month", parent: "day", ratio: 90,
  cycleNames: ["春之月", "夏之月", "秋之月", "冬之月"] }
```

当前实现要求 `cycleNames.length === ratio`，所以这个示例必定加载失败。应改成合法 Simple 示例，或把默认模板改为 Gregorian。

## Verification / Test

- EmbeddingText：
  - 补 `patch-operations` 或 service 级测试，覆盖空 `replace /events []` / `replace /memory {}` 允许。
  - 覆盖非空整块 replace 仍被拒绝。
  - 覆盖新 subject 首写后 `append /events {text:"..."}` 不再缺基准。
- World API：
  - 按已确认的分组 API 目标形态更新实现、tool description / profile / reference 测试。
  - 删除 `world.getMany`，不保留 alias；sandbox 类型、实现、tool description、profile、skills、reference、测试中不再出现当前可用 API 形态的 `getMany`。
  - 公共 API 改为分组 API；覆盖 subject / slice / time / search 等分组的 tool description、profile、reference 和 sandbox 类型。
  - `editMutations` 迁移为 `world.slice.editPatches`；文档和示例统一使用 `patchId`，不再使用 mutationId / mutation 作为技术术语。
  - 实现层命名也尽量跟随 patch：例如 `WorldMutationEdit`、`applyMutationEdits` 这类当前 API 支撑类型 / 函数应迁移为 patch 命名；只在历史文档或明确迁移说明中保留旧词。
  - readonly 模式下的分组 API 能力边界有测试覆盖：writer 不能调用 `world.slice.write` / `world.slice.editPatches` / `world.slice.delete`。
  - 旧平铺 API 与 `world.getMany` 有“不可用”测试或静态断言覆盖，避免隐藏 alias 回流。
  - `scripts/**` 中仍保留的 `execute_world` 脚本迁移到分组 API，或明确标记废弃。
- Error UX：
  - EmbeddingText 非空整块 replace 的错误信息说明为什么拒绝、空容器初始化是否允许、正确写入方式是什么。
  - `world.slice.get(sliceId)` 的文档和示例明确只接受 `sliceId`；不要暗示可传 `subjectId`。
- Calendar：
  - 模板默认 Gregorian 能 parse / format 现实时间：`公元2020年4月12日 18:00`。
  - 默认 format 到分钟、不带秒；reference 可保留带秒作为可选格式示例。
  - Simple Calendar 示例不再触发 `cycleNames 长度必须等于 ratio`。
  - `workspace/ming-ding-zhi-shi-2` 按确认后的 calendar 策略完成迁移。
- Existing Project Data：
  - `workspace/ming-ding-zhi-shi-2` 的 schema 迁移策略明确记录：保留 string events，或迁移到 `EmbeddingText` 并同步改写 SQLite 旧 `/events` patch value。
  - 若迁移 SQLite，先备份或通过受控迁移脚本执行，并验证 `WorldSubject` / `WorldSlice` / `WorldPatch` 计数与 `/events` reduce 结果。
  - Calendar 与 `/events` schema 分开做迁移决策和验证，不把“去秒”“改 Gregorian”“迁 EmbeddingText”混成一个不可回滚的大动作。
- Skills / Agent reference：
  - 初始化 skill 不再出现 `execute_world_query` / `write_world_slice` 作为当前协议。
  - `novel-workflow-08-plot-planning` 不再出现 `execute_world_query` / `write_world_slice` / `delete_world_slice` 作为当前协议，状态推进统一使用 `execute_world` + 分组 World API。
  - 写作流程 skill 若保留旧工具名，需迁移为 readonly `execute_world` 查询说明。
  - Agent reference 不再主动推荐 `world.getMany`，统一改为 `world.subject.gets(ids)`。
  - builtin profiles 不再主动推荐 `world.getMany`，并统一说明 `patchId` / `sliceId` 边界。
  - reference / skills 中默认 `EmbeddingText` 的 `/events` 示例统一为 `{text:"..."}`；只有明确 `z.array(z.string())` 的 schema 示例可以保留字符串 value。
  - 静态扫描当前协议文档、skills、profiles、tool description：旧工具名不再作为推荐流程出现；历史 walkthrough / archived / migration 文档可以保留旧名用于迁移说明。
  - 静态扫描当前协议文档、skills、profiles、tool description：旧平铺 API 不再作为推荐流程出现，包括 `world.get(`、`world.gets(`、`world.list(`、`world.slices(`、`world.getSlice(`、`world.parseTime`、`world.formatTime`、`world.writeSlice`、`world.editMutations`、`world.deleteSlice`。
- 建议命令：
  - `bun run test server/world-engine`
  - `bun run test server/agent/tools`
  - `bun run typecheck`

### 2026-07-18 D26 实际验证

- `bun run test server/world-engine/single-file-typescript-config-import.test.ts server/world-engine/codeact.test.ts server/utils/runtime-artifact-import.test.ts`：覆盖 `.nbook/runtime-artifact-import-cache` 精确落盘、`.staging` 在写入/导入成功或失败后的本轮清理、calendar/schema 同 Facade 热加载、旧源码旁 cache 成功清理、导入失败保留旧 cache，以及清理失败后同 hash 加载重试；新增 partial write 回归确认原始 I/O 错误不被 import 包装覆盖。
- runtime artifact 测试只使用各自临时 Project；不读取固定共享 cache 根。native dynamic import seam 与 cache namespace 未改。

## Implementation Walkthrough

> 状态：Round 01-14 已完成运行时 API、EmbeddingText、Calendar、loader 与 artifact cache 收口。Round 15 取代旧 D14：为 `ming-ding-zhi-shi-2` 实现 events + memory EmbeddingText schema、搜索能力 preflight、写入脚本同步与受控 SQLite migration；真实 `--apply` 已执行并生成备份。迁移脚本可安全重跑，已完成数据库会正常报告 already migrated。详见 [walkthroughs/2026-07-19-round-15-project-embedding-migration.md](walkthroughs/2026-07-19-round-15-project-embedding-migration.md)，早期轮次仍见本目录既有 walkthrough。

建议实施顺序：

1. **EmbeddingText 最小复现与修复**：先写失败测试，确认空容器初始化被误伤；修 `patch-operations` / service 校验；跑相关测试。
2. **World API 分组迁移**：按已确认的 `world.time.*` / `world.subject.*` / `world.search.*` / `world.slice.*` 形态改实现、tool description、builtin profiles、reference、Task 56 agent tools；`world.getMany` 直接删除、不做 alias，`editMutations` 迁移为 `world.slice.editPatches`，技术术语统一为 patch / patchId，并解释 `patchId` / `sliceId` 边界。
3. **确认现有项目迁移策略**：在改 `workspace/ming-ding-zhi-shi-2` 前确认 `/events` 是否迁到 `EmbeddingText`、Calendar 是否改 Gregorian，以及是否需要 SQLite 数据迁移。
4. **初始化与剧情推进 skill 协议迁移**：更新 `novel-workflow-world-engine-init` 与 `novel-workflow-08-plot-planning`，把旧两工具流程迁到单一 `execute_world`，并把 EmbeddingText 写入示例改成修复后的合法写法。
5. **Calendar 模板与示例**：将 Project Workspace 默认 `calendar.ts` 改成 Gregorian，format 到分钟、不带秒；修 `calendar-system.md` 与 `examples/calendar-simple.ts` 的 Simple 示例；同步迁移 `workspace/ming-ding-zhi-shi-2`。
6. **验证与报告**：跑 World Engine 与 Agent tool 相关测试；若改动影响 profile artifact、skill 静态测试或 seed demo，记录绕道和结果。

## TODO / Follow-ups

- [x] 修复 EmbeddingText 空容器初始化死锁。
- [x] 按已确认的分组 API 目标形态迁移 World API。
- [x] 删除 `world.getMany`，不保留 alias；迁移实现、sandbox 类型、tool description、builtin profiles、skills、reference 和测试引用。
- [x] 将公共 API 迁移为分组 API。
- [x] 将 `editMutations` 迁移为 `world.slice.editPatches`；技术术语统一为 patch / patchId，不再使用 mutationId / mutation 作为 API 术语。
- [x] 清理当前 API 支撑代码、tool description、profile、skills 和 reference 中的 mutation 技术术语；历史 walkthrough / migration 文档可保留旧词用于说明迁移。
- [x] 明确 readonly 分组 API 能力边界，并补 writer readonly 测试。
- [x] 改进 EmbeddingText 相关错误信息，说明空容器初始化与真实文本写入的正确路径。
- [x] 迁移或废弃 `scripts/**` 中仍使用旧平铺 World API 的脚本。
- [x] 更新 `novel-workflow-world-engine-init`：当前协议改为单一 `execute_world`，删除 `execute_world_query` / `write_world_slice` 旧示例。
- [x] 更新 `novel-workflow-08-plot-planning`：当前协议改为单一 `execute_world`，删除 `execute_world_query` / `write_world_slice` / `delete_world_slice` 旧示例，并把 `world.getMany` 改为 `world.subject.gets(ids)`。
- [x] 检查写作流程 skills、builtin profiles（`leader.default` / `world.engine`）和 agent reference，迁移旧 World Engine 工具名与 `world.getMany` 示例。
- [x] 统一 reference / skills 中默认 `EmbeddingText` 的 `/events` 示例：`append` value 使用 `{text:"..."}`，不再用裸字符串误导 Agent。
- [x] 默认 Calendar 模板切到 Gregorian 现实日历，format 到分钟、不带秒。
- [x] 原 D14 已被 D27 取代：`workspace/ming-ding-zhi-shi-2` 的 events + memory 改用 `EmbeddingText`，受控 SQLite migration 已实现并完成真实库 `--apply`；脚本支持重复执行并在已迁移库上正常退出。
- [x] 确认 `workspace/ming-ding-zhi-shi-2` 的 Calendar 策略：保留 `复兴纪元` Simple Calendar，但去秒并修示例。
- [x] 将 `workspace/ming-ding-zhi-shi-2` 的 Calendar 迁移与 `/events` schema 迁移拆开记录和验证。
- [x] 已同步 `workspace/ming-ding-zhi-shi-2/world-engine/**` 的 EmbeddingText schema；`.nbook/project.sqlite` 已由受控脚本 `--apply` 单独改写并保留备份。
- [x] 修复 Simple Calendar `cycleNames` 示例、reference 文档和默认模板注释。
- [x] 补充或更新相关测试。
- [x] 创建 `docs/tasks/75-world-engine-api-calendar-embedding-cleanup/walkthroughs/` 下的实现 walkthrough，记录每轮实现、验证、偏离原 task 的设计选择和未决策项。
- [x] 按 Runtime contract / Agent instruction surface / Template reference baseline / Existing workspace data 四层检查本任务验收结果。
- [x] 确认删除旧平铺 API 后没有通过隐藏 alias 重新暴露到 sandbox、tool description、profiles、skills 或当前 reference。
- [x] 增加静态验证：当前协议文档、skills、profiles、tool description 不再把旧工具名作为推荐流程；允许历史 walkthrough / archived / migration 文档保留迁移说明。
- [x] 增加静态验证：当前协议文档、skills、profiles、tool description 不再推荐旧平铺 `world.*` API；允许历史 walkthrough / archived / migration 文档保留迁移说明。
- [x] Round 02 补漏：当前 reference / bundled skills 的主示例统一到默认 Gregorian 格式 `公元2020年4月12日 18:00`，不再使用 `星辉历` / `春之月` 作为可照抄流程。
- [x] Round 02 补漏：默认 schema 语境下 `/events` 示例统一为 `EmbeddingText` 载荷 `{text:"..."}`；`schema-system.md` 简化 schema 也同步到 `EmbeddingText`。
- [x] Round 02 补漏：首写 subject 示例补齐 `type` / `name`，并修正 `world.search.text` 的 `types` / `attrs` 语义说明。
- [x] Round 02 决策：用户确认本轮只修文档，不新增 docs/static contract lint 或自动测试；后续若要彻底防回归，另开独立任务。
- [x] Round 03：修复 calendar/schema 热加载风险，验证同一 facade 在文件修改后读到新内容。
- [x] Round 03：修复 `task_create` / `task_set_status` 真实 turn 内任务状态易丢问题，保持分支局部语义。
- [x] Round 03：CodeAct `world.slice.list` 暴露 `subjectIds` / `subjectMode`，按 subject 查切面不再误用 `world.slice.get(subjectId)`。
- [x] Round 03：公共写入拒绝手写 EmbeddingText `vector` / `model`，并拒绝 `/events/0`、`/memory/key/vector` 等内部路径绕过。
- [x] Round 05：`server/world-engine` 测试迁到 Vitest，统一 `bun run test ...` 验收入口。
- [x] Round 05：calendar/schema 热加载改为内容 hash 稳定缓存，不再每次调用使用随机临时模块路径。
- [x] Round 07：schema/calendar loader 收紧为单文件配置入口；入口内容变化可热加载，本地文件、绝对路径和 URL/protocol import/export 被清晰拒绝，包级 import 与 `node:` 内置模块保持可用。
- [x] Round 05：全量重新编译 system profiles，确保 `.compiled` runtime artifact 同步当前 `execute_world` description。
- [x] Round 06：修复 Windows 下 World Engine SQLite 句柄释放和测试清理残留，不再用生产 `deleteProjectWorkspace()` 掩盖单测 cleanup 失败。
- [x] Round 08：`execute_world` 的字符串 `data` 直接作为工具文本展示；tool description、builtin profiles 与 migration reference 明确要求已知 schema 时优先返回文本摘要，不默认回传原始 attrs JSON。
- [x] Round 09：`EmbeddingText` 公共写入严格收口为唯一 `{text:"非空文本"}`；Task 56 当前契约、Task 76 交叉链接和 issue catalog 测试分层完成审查修复。
- [x] Round 10：公共 `WorldIssue` 去重落地；`writeSlice` / `editSlice` 对 schema 明确的数组 append 自动插入显式 `replace []`，不改 reducer 严格语义。
- [x] Round 11：schema/calendar loader 改为转译 hash `.mjs` 再导入；Product runtime 补齐 `nbook/world-engine/schema` helper。
- [x] Round 12：运行时生成 `.mjs` artifact 导入统一走 server 原生动态 import seam，覆盖 World Engine loader、profile artifact 与 variable definition artifact。
