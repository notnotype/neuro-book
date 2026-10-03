# Round 198：P0 真实驾驶测试

## 背景

本轮按用户纠偏执行 P0：停止继续补输入 guard，不写功能代码，不做 P2 分叉迁移，只从作者真实使用角度跑一遍 World Engine，找“第一次拿它写世界时会卡住的地方”。

测试入口：`http://localhost:3000/world-engine.preview`

测试方式：

- 使用当前已运行的 dev server，端口 `3000`。
- 使用 Playwright + 本机 Chrome 打开独立 Preview。
- 以真实 UI 操作为主；为避免被超长 Project 下拉和页面文本干扰，同时用同 Project 的 HTTP API 校验 slices/state。
- 本轮没有修改业务代码，没有新增测试。

## 实际驾驶流程

1. 打开 `/world-engine.preview`。
2. 等待 Project 列表加载并观察首屏。
3. 点击“新建 Project”。
4. 点击“创建示例世界”。
5. 尝试写入后续事件：`erina.hp add -10`。
6. 手动把 slice time 从 `复兴纪元1年 1月1日 00:00:01` 改为 `复兴纪元1年 1月1日 00:00:02` 后再次写入。
7. 点击“查询状态”确认 `erina.hp` 从 `100` 变为 `90`。
8. 载入 `复兴纪元1年 1月1日 00:00:01` 的示例 slice 编辑，追加 `erina.events listAppend "王都门口发生争执"`，保存。
9. 删除最新的 `艾莉娜受伤` slice，确认 state 回到 `erina.hp = 100`。

## 结果摘要

核心后端模型在这条真实链路里站得住：创建 Project、示例世界、写入 slice、编辑已有 slice、删除 slice、queryState 都能通过真实 API 完成，reduce 结果符合预期，issues 为空。

真正的首个卡点在前端写作流：一键示例世界之后，写入表单仍停在示例事件的同一 instant。作者自然会直接写下一件事，结果立刻触发“同 instant 已有切面”错误。错误要求使用 `edit_world_slice`，但页面里的实际路径叫“载入编辑 / 保存 Slice 编辑”，这会让作者停下来理解底层 API，而不是继续写世界。

## 问题清单

### P0：示例世界后的下一次写入默认撞同 instant

操作：新建 Project，点击“创建示例世界”，不改时间，直接用表单写入 `erina.hp add -10`。

实际结果：写入失败，timeline 仍只有 2 个 slice。页面报错：

```text
该时间已有切面，请使用 edit_world_slice 合并到已有切面，或选择相邻时间。
existingSliceId=0459d6e9-af69-49cc-8d2a-14b9cc7613f4,
time=复兴纪元1年 1月1日 00:00:01,
title=示例：艾莉娜抵达王都
```

为什么重要：这是作者完成“创建示例世界”后的第一步自然动作。当前默认值把他直接带进错误分支，而且错误文案使用 Agent/API 工具名 `edit_world_slice`，没有告诉 UI 用户该点哪个按钮。

建议方向：P1 修前端写作流，不改后端契约。可选方案是示例世界完成后把写入表单时间推进到下一个可用 instant，或在同 instant 错误处提供“载入已有 slice 编辑”的明确 UI 路径。

### P1：Project 列表污染和首屏等待过长

观察：

- Project 下拉加载出 342 个历史 Project，绝大多数是 `World Engine Test` / `World Engine API Test`。
- `/api/projects` 单次返回约 186KB，浏览器内测得约 3.65 秒。
- 首屏前 8 秒仍显示 `Schema 未加载`、`0 subjects · 0 slices`、主要按钮禁用；约 13 秒后才恢复可用。
- 新建 Project 流程约 9.8 秒，因为创建后又要重新加载整份 Project 列表。

为什么重要：作者第一次打开不是“开始写世界”，而是被测试项目列表和加载等待拦住。这个问题不是 World Engine reduce 模型问题，是入口选择和数据加载策略问题。

建议方向：P1 做 Project 选择体验收口。例如只显示最近/当前 Project、增加 World Engine 专用过滤、避免每次新建后重新拉全量列表，或清理测试 Project 生成策略。

### P1：写入/编辑后 State Query 不自动刷新

操作：

- 成功写入 `复兴纪元1年 1月1日 00:00:02` 的 `erina.hp add -10` 后，API 查询已返回 `hp=90`。
- 页面 `STATE QUERY` 仍显示旧的 `hp=100`，直到手动点击“查询状态”。
- 编辑 `00:00:01` slice 追加 `erina.events` 后，API state 已包含新事件，页面 `STATE QUERY` 仍停在旧事件列表，直到再次查询。

为什么重要：作者写完后最想确认“世界现在变成什么样”。当前 timeline 已刷新但 state query 不刷新，容易误以为写入没有生效，或者 reduce 有 bug。

建议方向：P1 在写入 / 编辑 / 删除成功后，如果 State Query 表单已有 scope，则自动刷新 query；或把 query result 标记为 stale，提示用户重新查询。

### P1：同 instant 错误文案暴露工具名而不是 UI 行动

当前错误给的是 `edit_world_slice`。这对 Agent/API 是准确的，但 Preview 用户看到的是“载入编辑”“保存 Slice 编辑”，两套语言不一致。

建议方向：API 继续返回稳定错误；前端对这个错误做业务级提示，指向当前页面操作：“此时间已有 slice，可在 Timeline 点击该 slice 的编辑图标载入合并，或把时间改到相邻刻。”

### P2/UX：编辑、删除入口是无文本图标，发现性不足

Timeline 中每个 slice 的编辑和删除按钮对自动化读取为正文空文本，只能通过 `title="载入编辑"` / `title="删除 slice"` 识别。视觉用户如果不悬停，不容易知道这是同 instant 合并和物理回退的核心路径。

建议方向：在真实产品化 UI 中给当前关键动作加可见文字或更明确的 hover/tooltip/状态说明。尤其因为同 instant 禁止后，“编辑已有 slice”不是边缘功能，而是主路径。

### P2/UX：默认 Project 名称和 slug 难读

默认标题为：

```text
世界引擎试用 2026620
```

生成 slug：

```text
workspace/shi-jie-yin-qing-shi-yong-2-0-2-6-6-2-0
```

为什么重要：作者会在超长 Project 列表中靠 title/slug 找项目。当前日期缺分隔，slug 把每个数字拆开，辨认成本高。

建议方向：默认标题使用带分隔的日期时间，例如 `世界引擎试用 2026-06-20 22-xx`；slug 生成规则避免数字逐字拆开。

### 观察项：删除确认在 headless 自动化里表现不稳定

源码使用 `window.confirm`。本轮自动化点击删除后，API 显示 slice 已删除、state 回到 `hp=100`，但页面文本中仍出现确认文案“确定要删除 slice「艾莉娜受伤」吗？此操作不可恢复。”，且 Playwright 没捕获到原生 dialog。

暂不把它列为确定 bug：这可能是 headless / DevTools / 浏览器确认框捕获的自动化差异。建议后续人工浏览器复验删除确认是否必须点确定、取消是否真的不删除、确认 UI 是否会残留。

## 后续建议

P1 不要继续补校验，优先修作者首轮写作链路：

1. 示例世界后下一条 slice 的默认时间不要撞同 instant。
2. 同 instant 错误在前端转成 UI 行动提示。
3. 写入 / 编辑 / 删除后让 State Query 自动刷新或显式 stale。
4. Project 选择入口降噪和提速。

P2 append-only 分叉仍是大活，涉及 Prisma schema 和 repository 查询面。开始前应单独出迁移与实现计划，确认后再动手。

## 验证

未运行测试；本轮是 P0 产品驾驶报告。

已用真实 API 校验：

- 示例世界后有 4 个 subject、2 个 slice。
- 写入 `erina.hp add -10` 到 `00:00:02` 后，`queryState` 返回 `erina.hp = 90`。
- 编辑 `00:00:01` 示例 slice 后，该 slice mutation 数从 9 变为 10，`queryState` 返回新增事件。
- 删除 `00:00:02` slice 后，timeline 回到 2 个 slice，`queryState` 返回 `erina.hp = 100`。
