# Round 379 - Browser Acceptance Result Template

## 背景

Round 376 已提供真实浏览器验收 runbook，Round 377 明确验收 slice 的保留 / 清理策略，Round 378 确认 runbook 时间窗口当前空闲。为了授权后能直接执行并沉淀证据，本轮补一份结果记录模板。

本轮只更新文档，不执行浏览器验收，不修改代码或真实 Project 数据。

## 使用方式

执行浏览器验收时，复制本模板内容到新的结果 walkthrough，例如：

`2026-06-22-round-380-real-browser-acceptance-result.md`

然后边执行 round 376 runbook 边填写：

- `Result`：`pass` / `fail` / `skip`
- `Evidence`：观察到的 UI 文案、返回结果、截图描述或错误信息
- `Follow-up`：无需处理、需修代码、需改文档、需用户决策

## 验收结果模板

### 0. 执行信息

- 执行人：
- 执行时间：
- Project：`workspace/ming-ding-zhi-shi-2`
- 浏览器 / 环境：
- 是否重新确认 `14:00:06..14:00:09` 时间窗口空闲：
- 是否允许写入真实 Project SQLite：
- 是否允许保留三条 `[验收]` 主线 slice：

### 1. 打开真实项目

| Check | Result | Evidence | Follow-up |
| --- | --- | --- | --- |
| `/?project=workspace%2Fming-ding-zhi-shi-2` 可打开主 IDE |  |  |  |
| World Engine Workbench 可打开 |  |  |  |
| 左栏显示 `world-engine/schema.yaml` |  |  |  |
| 左栏显示 `world-engine/calendar.yaml` |  |  |  |
| 左栏显示 6 个真实主体摘要 |  |  |  |
| `sample-npc` 未显示为待接入主体 |  |  |  |

### 2. Schema / Calendar 检查

| Check | Result | Evidence | Follow-up |
| --- | --- | --- | --- |
| 点击 `world-engine/schema.yaml` 可走主 IDE 文件打开链路 |  |  |  |
| 有草稿时会先确认放弃 |  |  |  |
| 回到 Workbench 后 schema 仍加载正常 |  |  |  |
| 选择 `player` 后新建 Slice Composer 可打开 |  |  |  |
| 默认 mutation 回退到 `world.events listAppend` |  |  |  |
| 默认 mutation 没有误写 `player.hp set` |  |  |  |

### 3. 连续写入三步 slice

| Check | Result | Evidence | Follow-up |
| --- | --- | --- | --- |
| Step A `14:00:06` 写入成功 |  |  |  |
| Step A 使用 `写入并继续下一步` 后 Composer 保留打开 |  |  |  |
| Step A 后仍保留 `player` 上下文 |  |  |  |
| Step B `14:00:07` 写入成功 |  |  |  |
| Step B 后 timeline 定位到新 slice |  |  |  |
| Step B card 显示 `files N` |  |  |  |
| Step C `14:00:08` 写入成功 |  |  |  |
| Step C 后 `world.events` 未导致 proposal 消失 |  |  |  |

### 4. 主体文件建议

| Check | Result | Evidence | Follow-up |
| --- | --- | --- | --- |
| 点击 Step C `files N` 会选中 slice |  |  |  |
| 点击 Step C `files N` 会打开 Inspector |  |  |  |
| 点击 Step C `files N` 会滚到 `Subject file proposals` |  |  |  |
| source label 为 `当前主体语境下的 world 事件建议` |  |  |  |
| `events.jsonl draft` 是第一人称经历草稿 |  |  |  |
| event JSONL 为 `text/time` 形态 |  |  |  |
| event JSONL `text` 不重复包含时间前缀 |  |  |  |
| 无 memory mutation 时 memory candidates 可缺省 |  |  |  |
| 复制单个 proposal 成功或失败有反馈 |  |  |  |
| 复制全部 proposal 成功或失败有反馈 |  |  |  |
| 复制 `events.jsonl` 行成功或失败有反馈 |  |  |  |
| 打开 `events.jsonl` 路径成功 |  |  |  |
| 打开 `memory.jsonl` 路径成功 |  |  |  |
| 打开 `state.md` 路径成功 |  |  |  |
| 未自动写入 `simulation/subjects` 六文件 |  |  |  |

### 5. 历史 slice 回看

| Check | Result | Evidence | Follow-up |
| --- | --- | --- | --- |
| Step A `files N` 可点击 |  |  |  |
| 点击后选中 Step A 而不是 Step C |  |  |  |
| Inspector proposal 内容对应 Step A |  |  |  |
| Step B `files N` 可点击 |  |  |  |
| 点击后 proposal 内容对应 Step B |  |  |  |

### 6. 常用操作

| Check | Result | Evidence | Follow-up |
| --- | --- | --- | --- |
| Step C metadata title 可编辑并保存 |  |  |  |
| 保存后 timeline card 标题同步更新 |  |  |  |
| Step C mutation value 可编辑并保存 |  |  |  |
| 保存后 proposal 重新计算并反映新 value |  |  |  |
| 查询当前 slice 触及主体状态成功 |  |  |  |
| 展开完整世界状态成功 |  |  |  |
| `issues` 展示清楚，且无旧 re-settle 文案 |  |  |  |
| `[验收-可删除]` slice 可写入 |  |  |  |
| 删除入口出现二次确认 |  |  |  |
| 删除后 `[验收-可删除]` 不再显示 |  |  |  |
| 删除返回 issues 未错挂到刷新后的当前 slice |  |  |  |

### 7. 草稿保护

| Check | Result | Evidence | Follow-up |
| --- | --- | --- | --- |
| Composer 有未保存草稿时关闭会确认 |  |  |  |
| 取消关闭后草稿仍保留 |  |  |  |
| Workbench 关闭时能汇总未保存草稿确认 |  |  |  |

### 8. 执行后处理

| Check | Result | Evidence | Follow-up |
| --- | --- | --- | --- |
| 三条 `[验收]` 主线 slice 已先保留供记录 |  |  |  |
| `[验收-可删除]` slice 已删除，或已记录删除失败 |  |  |  |
| 是否需要清理三条 `[验收]` 主线 slice 已交给用户决策 |  |  |  |

## 总结

### 通过项

- 

### 失败项

- 

### 跳过项

- 

### 需要修代码

- 

### 需要改文档

- 

### 需要用户决策

- 

## 与计划出入

- 是否完全按 round 376 runbook 执行：
- 若未执行浏览器验收，原因：
