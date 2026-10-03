# Round 380 - Real Browser Acceptance Result

## 背景

用户已明确允许按 Round 376 runbook 执行真实浏览器验收。本轮使用本机 Chrome + Playwright 打开 `http://localhost:3000/?project=workspace%2Fming-ding-zhi-shi-2`，实际写入 `workspace/ming-ding-zhi-shi-2/.nbook/project.sqlite`。

验收前再次通过 `WorldEngineFacade` 只读确认 `复兴纪元488年 1月15日 14:00:06..14:00:09` 空闲，`sliceCount: 0`。

## 执行信息

- 执行时间：2026-06-22
- Project：`workspace/ming-ding-zhi-shi-2`
- 浏览器 / 环境：Chrome headless via Playwright，复用本地 `localhost:3000` Nuxt dev server
- 是否允许写入真实 Project SQLite：是
- 是否保留三条 `[验收]` 主线 slice：暂时保留，等待用户决策

## 结果摘要

| Area | Result | Evidence | Follow-up |
| --- | --- | --- | --- |
| 打开真实 Project / Workbench | pass | 主 IDE 可打开 `命定之诗2`；Workbench 显示 `world-engine/schema.yaml`、`world-engine/calendar.yaml`、7 个 World Engine subject，其中 6 个有真实主体系统摘要；`sample-npc` 未显示为待接入主体 | 无 |
| Schema / Calendar 与默认 mutation | pass | 选择 `player / 薇洛丝` 后打开新建 Slice Composer，默认 mutation 为 `world.events listAppend`，没有误回到 `player.hp set` | 无 |
| 连续三步写入 | pass | 三次真实 `POST /api/projects/world-engine/slices` 均返回 200 与 `issues: []`；slice id 分别为 `cd7afcb6-8036-4682-b1e4-19a0585043ee`、`1801820e-3306-4f91-b34c-6e032bfac631`、`19bda0a2-833e-432e-b158-a3e5572ac6cc` | 三条 `[验收]` 主线 slice 已保留 |
| `world.events` 状态 reduce | pass | 完整世界状态展开后 `world.events` 有 3 items，且没有旧 re-settle 文案；读时 `stateIssues: []` | 无 |
| Metadata 编辑 | pass | Step C title 改为 `[验收] 薇洛丝意识到自己未被重点监视（已编辑）`，`POST /edit` 返回 200 与 `issues: []`；facade 只读确认已落库 | 无 |
| 删除专用 slice | pass | `[验收-可删除] 删除动作测试` 写入返回 `sliceId: cbb04bac-c988-4adb-af2c-572841216da2, issues: []`；随后 `DELETE /slices/:id` 返回 `{issues: []}`；facade 只读确认 `14:00:09` 不再存在该 slice | 无 |
| 主体文件建议入口 | fail | 写入后曾在 Inspector 看到 `薇洛丝 / 当前主体语境下的 world 事件建议 / simulation/subjects/player`，但刷新/重新建立视角后，Step C 的 `files 1` 与普通选择路径无法稳定打开 `Subject file proposals`；多次落到普通状态快照或旧 slice proposal | 需要修 Workbench 的 focused subject / selected slice / proposal target 状态链路 |
| 历史 slice proposal 回看 | fail | Step A / Step B / Step C 的普通选择会打开对应 state snapshot，但不能稳定通过 `files 1` 进入对应历史 slice proposal | 同上 |
| Proposal 复制 / 打开目标文件 | partial | 初始 proposal 区能展示 JSONL 形态候选；后续精确操作被入口不稳定阻断。一次非精确点击误打开了左栏 `armand-brauer/events.jsonl`，说明同名 `打开 events.jsonl` 按钮自动化和可访问命名都容易混淆 | proposal 区按钮需要更稳定的目标语义 / test id / 可访问名称 |
| Mutation value 编辑 | fail | Slice Composer 编辑 Step C 时，Builder value 已输入追加句 `她决定暂时不暴露任何异常。`，保存 `POST /edit` 返回 200 与 `issues: []`；但 facade 只读确认 mutation value 仍是原文，追加句未落库 | 需要修 Builder `替换所选` / textarea 同步 / 保存前 mutation source |
| 草稿保护 | skip | 本轮在发现 P0 失败后未继续执行草稿保护，以免扩大真实 Project 写入范围 | 修复上述失败后复验 |

## 写入后的真实数据

Facade 只读确认当前 `14:00:06..14:00:09` 只有三条主线验收 slice：

- `14:00:06` `[验收] 薇洛丝观察召唤大厅余波`
- `14:00:07` `[验收] 眼镜女生试探搭话`
- `14:00:08` `[验收] 薇洛丝意识到自己未被重点监视（已编辑）`

专门的 `[验收-可删除] 删除动作测试` 已删除。三条主线 slice 暂不清理，按 Round 377 策略等待用户决定。

## 需要修代码

- P0：`files N` / hidden Inspector / selected slice proposal 入口在真实浏览器里不稳定。作者保存多步 slice 后，最想做的是处理主体六文件建议；这里如果不能稳定直达，作者第一处真实卡点就是“不知道下一步怎么把世界推进落到角色文件”。
- P0：Slice Composer 编辑模式中 Builder 的 `value` 修改没有进入最终保存 payload，API 返回成功但实际 mutation 未改变。这会让作者误以为已修改世界事件，实际 reduce 状态仍是旧值。
- P1：proposal 区和左栏主体文件按钮有多个同名 `打开 events.jsonl / state.md`，真实用户尚可凭位置判断，但自动化、可访问性和后续测试都容易点错目标。

## 与计划出入

- 本轮按 Round 376 执行了真实浏览器验收，并实际写入 / 编辑 / 删除 Project SQLite。
- 未执行草稿保护完整步骤；原因是已发现两个会阻断作者流的 P0 前端问题，继续覆盖低优先级步骤收益不高。
- 未自动修代码；本轮按真实验收记录问题，等待下一步确认后再进入修复。
