# Round 10 - Preview Demo Seed

## Scope

本轮继续优化 `/world-engine.preview` 的用户视角试用路径。此前 preview 已能手工新建 Project、创建 subject、写 slice、查询 state、编辑 slice 和显式 re-settle，但第一次打开页面时仍需要用户理解 schema、手写或拼装 mutation，才能看到一个完整世界状态例子。

本轮目标是在不改后端契约的前提下，新增“一键示例世界”入口，让用户能在当前 Project 中直接跑通一条真实 World Engine 数据链路。

## Actual Changes

- 更新 `app/utils/world-engine-preview.ts`：
  - 新增 `suggestNextPreviewTime(examples, usedTimes)`，从项目 calendar examples 和已占用 timeline 时间中推导一个未占用的普通 slice 时间。
  - 复用秒级格式推导，优先选择同一分钟内的下一个空闲秒点，避免与 init instant 或重复点击时已有 slice 撞车。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 增加 `suggestNextPreviewTime()` 用例，覆盖 init instant 已占用、重复点击递增到下一秒、非时间字符串兜底到未占用 example。
- 更新 `app/pages/world-engine.preview.vue`：
  - Project 面板新增“创建示例世界”按钮。
  - 按钮会在当前 Project 里通过真实 API 创建 / 跳过示例 subjects：
    - `world` (`world`)
    - `capital` (`location`)
    - `erina` (`character`)
    - `old-sword` (`item`)
  - 写入一条事件 slice：`world.events` 追加示例启动，`erina.location` 指向 `subject://capital`，`erina.inventory` 加入 `subject://old-sword`，`old-sword.durability` 扣 5，并给相关 subject 追加 events。
  - 写入后自动查询 `erina, old-sword, world` 的状态，投影 `hp,location,inventory,events,durability,era`，让页面立即显示 reduce 后结果。
  - 重复点击时跳过已存在且 type 匹配的 subject，并选择新的未占用 slice 时间；如果已有同 id 但 type 不匹配的 subject，会阻止示例写入并提示冲突。
  - 代码审查时发现页面常规 timeline 只加载最近 12 个 slice，不足以作为重复点击判重依据；已改为创建示例前额外拉取最多 80 个 slice 时间参与判重。

## Decisions

- 示例世界只做 preview 层编排，不增加后端 seed API。原因：当前目标是降低调试台第一次试用门槛，不需要把示例数据变成核心领域能力。
- 重复点击允许继续写新的示例事件 slice。这样可以顺便验证 timeline 追加和 listAppend / collectionAdd 的累积效果。
- 示例 subject 使用默认模板 schema 中已有的 `world / location / character / item` 类型，不为 demo 改 schema。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts`
  - 通过：1 个测试文件，6 个用例。
- `bun run typecheck`
  - 通过。

## Browser Testing

仍未自动浏览器验证。项目指令要求不要自动浏览器验证；当前页面下一步需要在用户确认后实际打开 `/world-engine.preview` 验证：

1. 新建 Project。
2. 点击“创建示例世界”。
3. 确认 subjects 出现 `world / capital / erina / old-sword`。
4. 确认 timeline 出现示例事件 slice。
5. 确认 State Query 展示 `erina` 的 location / inventory / events 和 `old-sword` 的 durability。
6. 重复点击一次，确认不会重复创建 subject，且会写入新的示例 slice。

## Code Review Notes

- 这轮只在 preview 层增加 orchestration，不改变 `writeSlice`、`createSubject`、`queryState` 的核心语义。
- 时间冲突处理会在创建示例前额外读取一批 timeline 时间；真实并发写入造成的极小概率冲突仍由后端唯一约束兜底报错。
- 还需要真实浏览器验证用户体验：按钮位置、加载状态、错误提示和查询结果是否足够清楚。

## Walkthrough Delta

计划与实际一致。本轮没有遇到堵塞或绕道；浏览器验证因项目约束仍待用户明确确认后执行。
