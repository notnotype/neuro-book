# Round 371 - Real Project Preflight

## 背景

真实浏览器验收还没有执行。本轮先做只读预检，确认 `ming-ding-zhi-shi-2 / 命定之诗2` 当前磁盘状态是否仍匹配 round 363 验收清单和主体文件建议设计。

## 本轮目标

- 只读检查目标 Project Workspace。
- 核对 `world-engine/schema.yaml`、`world-engine/calendar.yaml` 和 `simulation/subjects` 是否存在。
- 核对 `player` 六文件格式是否与主体文件建议候选一致。
- 不修改 Project 文件，不执行浏览器验收。

## 预检结果

- Project Workspace 存在：`workspace/ming-ding-zhi-shi-2`。
- `project.yaml` 标题为 `命定之诗2`。
- World Engine 配置存在：
  - `workspace/ming-ding-zhi-shi-2/world-engine/schema.yaml`
  - `workspace/ming-ding-zhi-shi-2/world-engine/calendar.yaml`
- `simulation/subjects` 存在，当前至少包含：
  - `armand-brauer`
  - `glasses-girl`
  - `lolita-girl`
  - `mage`
  - `motion-boy`
  - `player`
  - `sample-npc`
- `player` 六文件存在：
  - `events.jsonl`
  - `memory.jsonl`
  - `mind.md`
  - `soul.md`
  - `state.md`
  - `subject.md`

## 对验收清单的确认

- `character` schema 仍没有 `events` attr，角色事件需要通过 `world.events` 回退语境或主体文件建议承接；round 363 关于 `world.events` 回退的验收假设成立。
- `player/state.md` 使用作者可读区块：
  - `当前位置`
  - `资源`
  - `持有物品`
  - `身体与姿态`
  - `关系压力`
  - `短期目标`
- 这些区块与 `state.md review` 的映射一致。
- `player/events.jsonl` 使用 `{"text": "...", "time": "..."}` 形态，和 proposal 的 event 候选一致。
- `player/memory.jsonl` 使用 `{"topic": "...", "view": "..."}` 形态，和 proposal 的 memory 候选一致。

## 需要验收时观察的风险

- 现有历史 `events.jsonl` 行里仍有 `复兴纪元488年 风信之月15日 ...` 这类旧月名。
- 当前 `calendar.yaml` 使用数字月格式：`{era}{year}年 {month}月{day}日 {hour:02}:{minute:02}:{second:02}`，并注释“旧 `风信之月` 本轮映射为 `1 月`”。
- 后续新 slice / proposal 可能产生数字月时间，与旧六文件历史事件中的旧月名并存。

这不是本轮要修的代码问题，但浏览器验收时应观察作者是否能接受这种 legacy/current 时间文本混用；若不能接受，需要另开日历显示 / 旧事件迁移策略讨论。

## 验证

本轮只运行只读 PowerShell 检查，没有修改代码，没有运行测试，没有执行浏览器验收。

## 与计划出入

- 原目标仍是完整跑通真实作者流；本轮只是为后续浏览器验收做目标 Project 预检。
- 没有自动迁移 `events.jsonl` 的历史时间文本。
