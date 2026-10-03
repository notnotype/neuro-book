# Round 334: Real Author Flow Content Bridge Audit

## Context

本轮从真实作者流重新审查 `ming-ding-zhi-shi-2`，不继续补 UI busy guard 或畸形输入边界。目标是回答：作者真的拿 World Engine 写世界时，第一个会卡住在哪里。

只读文件：

- `workspace/ming-ding-zhi-shi-2/world-engine/schema.yaml`
- `workspace/ming-ding-zhi-shi-2/world-engine/calendar.yaml`
- `workspace/ming-ding-zhi-shi-2/simulation/subjects/player/subject.md`
- `workspace/ming-ding-zhi-shi-2/simulation/subjects/player/state.md`
- `workspace/ming-ding-zhi-shi-2/simulation/subjects/motion-boy/subject.md`
- `workspace/ming-ding-zhi-shi-2/simulation/subjects/motion-boy/state.md`
- `workspace/ming-ding-zhi-shi-2/simulation/subjects/glasses-girl/subject.md`
- `workspace/ming-ding-zhi-shi-2/simulation/subjects/glasses-girl/state.md`

## Findings

- `ming-ding-zhi-shi-2` 的 `character` schema 没有 `events` attr；角色的叙事事实主要落在六文件主体系统的 `subject.md / soul.md / events.jsonl / memory.jsonl / mind.md / state.md`。
- 当前 World Engine 对角色的结构化 schema 主要是 `hp/maxHp/location/faction/inventory` 和主体系统路径 / 计数字段；这能注册和索引主体，但不能直接表达 `state.md` 里的“当前位置、身体状态、关系压力、短期目标、最新动态”。
- 当前默认 mutation 在角色没有 `events` 时会回退到 `world.events`。这避免了第一屏写成 `hp set 100`，但也意味着作者选中 `player` 或 `glasses-girl` 继续推演时，第一条可写内容更像世界日志，不会更新角色自己的 `state.md` 或 `events.jsonl`。
- 因此真正的 P0 不是再补一个输入 guard，而是明确 World Engine slice 和 subject 六文件状态的桥接策略：slice 是结构化真相源、六文件是叙事工作区，还是两者需要一个显式同步 / 投影动作。

## User-Visible First Blocker

作者在 `ming-ding-zhi-shi-2` 里最可能卡在这里：

1. 选中真实角色，例如 `player` 或 `glasses-girl`。
2. 点击新建 Slice，准备记录“眼镜女生向薇洛丝搭话后，薇洛丝回应 / 情绪 / 关系压力变化”。
3. Builder 默认可写项落到 `world.events` 或少量结构字段，作者看不到一个自然入口来更新角色当前 `state.md` 中的“短期目标 / 最新动态 / 关系压力”。
4. 写入后 World Engine timeline 有 slice，但角色六文件正文没有变化；作者会怀疑“这个世界引擎到底有没有推进角色状态”。

## Decision Needed

后续不要在这里继续顺手补边界。需要先定一个产品方向：

- A. World Engine 只管结构化状态，六文件主体系统继续由 Agent / 作者单独维护；UI 必须把这个边界说清楚，并避免暗示 slice 会更新 `state.md`。
- B. World Engine slice 增加“叙事状态 patch”能力，能显式更新 `simulation/subjects/{id}/state.md` 或追加 `events.jsonl`；这会跨 Project SQLite 与 Project Workspace 文件写入，需要新的 API / Agent 工具契约。
- C. 保持 slice 结构化，但增加从 slice issues / mutation / summary 生成 subject 六文件修改建议的审查队列；作者确认后再写文件，避免自动覆盖长文档。

## Actual Result

- 本轮没有改代码。
- 本轮没有运行测试。
- 本轮只把真实项目审查结果记录到任务文档，作为下一阶段产品决策输入。

