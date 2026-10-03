# Round 410: World Bootstrap Preserves Subject Context

## 背景

Round 408 验证了新 Project 可以在同步 `player` 后显式创建 `world` subject，并写入 `world.events`。继续从作者流审查时发现一个更细的卡点：创建 `world` 后，Workbench 会把 `focusedSubjectId` 和 subject filter 都切到 `world`，导致作者随后写 `world.events` 时丢失原来的角色主体文件建议语境。

这会让世界事件写入成功，但不会自然出现 `player` 的 `files 1` / 主体文件建议；作者需要手动再点 `player` 的 `语境` 才能继续维护 `simulation/subjects/player` 六文件。

## 改动

- `WorldEngineWorkbenchDialog.vue`
  - `createWorldSubject()` 在创建前记录当前主体系统语境。
  - 如果当前 `focusedSubjectId` 是主体系统 subject，或当前 subject filter 中有主体系统 subject，则创建 `world` 后恢复该语境。
  - 只有没有任何主体系统语境时，才把选择和 focus 回退到 `world`。
  - 刷新 timeline 后再次设置 `focusedSubjectId`，避免 subject filter watcher 把语境抢回 `world`。
- `world-engine-ide-entry.test.ts`
  - 增加静态契约，锁住 `world` bootstrap 不能无条件覆盖主体文件建议语境。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 1 file passed
  - 3 tests passed

## 浏览器验收

使用临时 Project：

```text
workspace/world-engine-round-410-context-1782185814624
```

fixture：

- schema 声明 `world.events` 与 `character.events/status`。
- `simulation/subjects/player` 有六文件。
- 初始没有 World Engine subject。

流程：

1. 打开主 IDE Workbench。
2. 点击 `同步主体系统`，确认 `player` 变成已注册 subject，左栏显示 `语境中`。
3. 点击 `创建 world subject`。
4. 确认当前视角仍是 `主体(任一 subject) 验收主角`，`player` 仍显示 `语境中`。
5. 新建 slice，写入：

```json
[
  {
    "subjectId": "world",
    "attr": "events",
    "op": "listAppend",
    "value": "验收主角听见世界钟声第二次响起。"
  }
]
```

结果：

- UI 返回 `已写入 slice ...`。
- 当前视角显示 `主体语境 验收主角`。
- slice card 显示 `files 1`。
- Inspector 显示 `当前切片有主体文件建议: 1 proposals`。
- proposal 来源为 `当前主体语境下的 world 事件建议`，目标 subject 是 `验收主角 / simulation/subjects/player`。

清理：

- in-app browser 删除请求一度超时，随后停止 dev server 后直接调用同一内部函数 `deleteProjectWorkspace()` 清理临时 Project。
- 临时 Project 目录已删除。
- dev server 已关闭，`port 3001` 空闲。

## 实际偏差

- 初始 fixture schema 写成了数组形式，当前契约需要 `subjectTypes` map；验收中已修正临时 Project fixture。
- 页面有外部 Statsig 请求超时日志，不影响本地 Workbench 验收。
- 清理时 HTTP DELETE 请求卡住；停止 dev server 后调用 `deleteProjectWorkspace()` 成功。后续如果仍复现，需要继续查 dev server / 浏览器连接是否让删除请求长期悬挂。

## 后续

- `world` bootstrap 不再抢走角色主体文件建议语境。
- 下一步继续看真实作者是否卡在 schema 编写 / 模板选择，而不是继续扩展畸形输入边界。
