# Round 372 - Real Project SQLite Preflight

## 背景

Round 371 已确认 `ming-ding-zhi-shi-2 / 命定之诗2` 的 Project Workspace、World Engine 配置和 `simulation/subjects` 六文件存在。本轮继续做只读预检，查看 Project SQLite 里真实 World Engine 当前数据，避免后续浏览器验收误以为目标 Project 是空白世界。

## 本轮目标

- 只读查询 `workspace/ming-ding-zhi-shi-2/.nbook/project.sqlite` 对应的 World Engine 数据。
- 通过 `WorldEngineFacade` 查询真实 service 语义，而不是直接读裸表。
- 记录 subjects、slices、当前 `player` state 与读时 issues。
- 不修改 DB，不执行浏览器验收。

## 查询方式

- `sqlite3` 命令行在当前环境不可用。
- 改用项目自身 `WorldEngineFacade`：
  - `getWorldSchema(project)`
  - `listWorldSubjects(project)`
  - `listSlices(project, {withMutations: true, limit: 100})`
  - `queryState(project, {subjectIds: ["player"]})`
  - `queryState(project, {type: "character", attrs: [...]})`

## 预检结果

- Project SQLite 存在：`workspace/ming-ding-zhi-shi-2/.nbook/project.sqlite`。
- 当前 World Engine subjects 共 7 个：
  - `world`
  - `player`
  - `armand-brauer`
  - `mage`
  - `motion-boy`
  - `lolita-girl`
  - `glasses-girl`
- `simulation/subjects/sample-npc` 存在于文件系统，但当前 Workbench 工具层会显式忽略该示例主体，不会把它作为待接入 subject 展示。
- 当前 timeline 共 6 个 slice，全部 `issues: []`：
  - `15148908000`：`创建 命定之诗世界`，初始化 `world` 与 6 个角色的 `hp / maxHp / inventory / events`。
  - `15148908001`：`旧主体链接初始化`，写入 `sourcePath / legacyKind / controlledBy / profile / canonicalSource`。
  - `15148908002`：`主体系统六文件初始化`，曾把六文件正文、计数和版本写入 World Engine。
  - `15148908003`：`主体经历记忆初始化`，把各角色 `events.jsonl` 作为 `events listAppend` 写入 World Engine。
  - `15148908004`：`主体系统拓扑初始化`，写入 `subjectFiles / actorImportPath / leaderOnlyPath / directStatePath / ragIndexSources`。
  - `15148908005`：`主体系统信息边界收口`，移除 `subjectFile / soulFile / visibleState / mind / memory / events` 全文或镜像字段，保留路径、拓扑与计数。

## 当前状态观察

- `player` 当前 state 保留：
  - `hp / maxHp / inventory`
  - `sourcePath / legacyKind / controlledBy / profile / canonicalSource`
  - `eventCount / memoryCount / subjectSystemVersion`
  - `subjectFiles / actorImportPath / leaderOnlyPath / directStatePath / ragIndexSources`
- `player` 当前没有 `events / memory / subjectFile / soulFile / visibleState / mind` 全文镜像；这符合“主体系统信息边界收口”后的方向。
- `player` 的 `queryState` 返回 `issues: []`。
- `type: "character"` 且投影 `subjectFiles / actorImportPath / directStatePath / ragIndexSources / events / eventCount / memoryCount` 时，所有已注册角色返回 `issues: []`。
- 各角色 `eventCount / memoryCount` 当前为：
  - `player`: events 7, memory 7
  - `armand-brauer`: events 8, memory 4
  - `mage`: events 11, memory 5
  - `motion-boy`: events 5, memory 5
  - `lolita-girl`: events 20, memory 7
  - `glasses-girl`: events 7, memory 4

## 对作者流验收的影响

- 目标 Project 不是空白世界，而是已有 6 个初始化 / 迁移 slice 的真实时间线。
- 后续浏览器验收应该从“已有主体系统拓扑 + 旧事件已迁移但正文镜像已移除”的状态继续推演。
- `sample-npc` 不能作为 pending subject 验收点：它是显式忽略的示例主体。若要验收待接入主体路径，需要使用真实未注册主体目录，或在验收前创建一个非示例 subject。
- 新写 slice 后，作者真正会卡住的地方仍是六文件桥接：World Engine 只写 Project SQLite，`simulation/subjects` 仍需通过主体文件建议人工处理。
- 当前所有读时 issues 为 0；后续验收若出现 issue，更可能来自新写入 / 编辑 / 删除操作，而不是既有基线脏数据。

## 验证

本轮只运行只读 facade 查询，没有修改代码或 DB，没有运行测试，没有执行浏览器验收。

## 与计划出入

- 原计划是继续完整真实作者流验收；本轮仍属于验收前预检。
- 没有为了构造 issue 或空项目而修改真实数据。
