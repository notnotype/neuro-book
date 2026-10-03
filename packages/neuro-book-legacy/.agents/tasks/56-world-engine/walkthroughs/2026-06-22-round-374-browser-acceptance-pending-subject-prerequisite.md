# Round 374 - Browser Acceptance Pending Subject Prerequisite

## 背景

Round 373 确认 `sample-npc` 会被 Workbench 显式忽略，不能作为待接入主体路径验收点。继续回看 round 363 浏览器验收清单时发现：清单仍把“同步主体系统”写成必测步骤，但 `ming-ding-zhi-shi-2 / 命定之诗2` 当前真实状态下没有可用的待接入主体。

如果按旧清单执行，验收者会在“同步主体系统”步骤卡住，并可能错误地使用 `sample-npc` 作为测试对象。

## 本轮目标

- 修正浏览器验收清单，让它按当前真实 Project 状态可执行。
- 明确 `sample-npc` 不可作为 pending subject 测试对象。
- 保留同步主体系统验收项，但把它改成有前置条件的条件项。
- 不修改代码，不修改真实 Project 数据，不执行浏览器验收。

## 调整内容

更新 `2026-06-22-round-363-real-author-flow-browser-acceptance-plan.md`：

- 在“打开真实 Project”阶段说明：
  - 当前 `ming-ding-zhi-shi-2` 已注册 6 个真实主体。
  - `sample-npc` 被 Workbench 忽略。
  - 正常验收应确认不会误显示待接入主体。
- 把“同步主体系统”章节改为“同步主体系统（条件项）”：
  - 只有存在真实未注册 subject 时才执行。
  - 当前 Project 默认跳过此项。
  - 若要覆盖此路径，需要先准备非示例 subject 目录，或换一个存在 pending subject 的 Project。
  - 不得使用 `sample-npc`。
- 通过标准中的“完成主体同步”改成条件要求，避免把当前不可执行的步骤当成必过门槛。

## 当前验收策略

默认浏览器验收应先覆盖：

- 打开 `ming-ding-zhi-shi-2`。
- 查看 schema / calendar。
- 使用已注册真实主体推演多步 slice。
- 回看历史 slice。
- 检查主体文件建议、复制和打开目标文件。
- 覆盖编辑 / 删除 / 查询 / 过滤 / 草稿保护等常用操作。

同步主体系统另列为条件项：

- 当前 Project 没有可用 pending subject 时跳过。
- 如需要完整覆盖，需要用户允许在测试 Project 或当前 Project 中准备一个真实未注册主体目录。

## 验证

本轮只更新文档，没有运行测试，没有执行浏览器验收。

## 与计划出入

- 原计划继续推进浏览器验收前准备；实际发现清单本身还有不可执行步骤，因此先修清单。
- 没有用 `sample-npc` 构造验收路径，因为这会违背当前 Workbench 的显式忽略逻辑。
