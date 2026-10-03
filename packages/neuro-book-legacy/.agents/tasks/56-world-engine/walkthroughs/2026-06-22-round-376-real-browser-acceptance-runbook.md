# Round 376 - Real Browser Acceptance Runbook

## 背景

Round 363 / 370 / 374 已有浏览器验收清单，Round 371 / 372 已确认 `ming-ding-zhi-shi-2 / 命定之诗2` 的真实 Project 起点，Round 373 / 375 已补前端静态入口和底层链路测试证据。本轮把验收清单进一步变成可执行 runbook：明确用哪个 subject、哪些时间、写什么 slice、哪些动作只观察不落地。

本轮仍不自动执行浏览器验收。

## 当前起点

只读确认：

- 最新 slice：`复兴纪元488年 1月15日 14:00:05`，标题 `主体系统信息边界收口`。
- 下一组验收时间建议使用：
  - `复兴纪元488年 1月15日 14:00:06`
  - `复兴纪元488年 1月15日 14:00:07`
  - `复兴纪元488年 1月15日 14:00:08`
- Round 378 只读预检确认 `14:00:06` 到 `14:00:09` 当前没有已存在 slice；若正式验收延后，执行前应重新确认该窗口仍空闲。
- `character` schema 当前没有 `events` attr。
- `world.events` 是 `list text`，可作为角色事件的结构化世界日志承接点。
- `player` 是已注册 World Engine subject，且有 `simulation/subjects/player` 六文件摘要，可用于主体文件建议验收。

## 验收前注意

- 以下写入会修改 `workspace/ming-ding-zhi-shi-2/.nbook/project.sqlite` 的 World Engine timeline。
- 主体文件建议只复制 / 打开目标文件，不把建议写入 `simulation/subjects` 六文件。
- 不使用 `sample-npc`；它是被 Workbench 显式忽略的示例主体。
- `同步主体系统` 是条件项：当前 Project 默认跳过，除非另行准备真实未注册 subject。

## 浏览器操作脚本

### 1. 打开真实项目

1. 打开主 IDE：`/?project=workspace%2Fming-ding-zhi-shi-2`。
2. 打开 World Engine Workbench。
3. 检查左栏：
   - 能看到 `world-engine/schema.yaml`。
   - 能看到 `world-engine/calendar.yaml`。
   - 能看到 6 个真实主体摘要。
   - 不应把 `sample-npc` 显示为待接入主体。

### 2. Schema / Calendar 检查

1. 点击左栏 `world-engine/schema.yaml` 路径。
2. 若 Workbench 有草稿，确认会先询问是否放弃；无草稿则应打开文件。
3. 回到 Workbench。
4. 选择 `player`。
5. 打开新建 Slice Composer。
6. 检查默认 mutation：角色没有 `events` attr 时，应回退到 `world.events listAppend`，而不是 `player.hp set`。

### 3. 连续写入三步 slice

使用 `player` 作为当前上下文主体。若 UI 自动生成的 mutation 不是下面内容，手动替换 mutations JSON。

#### Step A

Metadata:

- time: `复兴纪元488年 1月15日 14:00:06`
- kind: `event`
- title: `[验收] 薇洛丝观察召唤大厅余波`
- summary: `薇洛丝在召唤大厅中保持沉默，继续观察符文光、法师和其他被召唤者的反应。`

Mutations:

```json
[
    {
        "subjectId": "world",
        "attr": "events",
        "op": "listAppend",
        "value": "[验收] 薇洛丝在召唤大厅中保持沉默，继续观察符文光、法师和其他被召唤者的反应。"
    }
]
```

保存方式：使用 `写入并继续下一步`。

期望：

- 新 slice 出现在 timeline。
- Composer 内显示上一条 slice 已写入回执。
- Workbench 保留 `player` 上下文，而不是跳到 `world`。
- 成功提示提到右侧 Inspector 可查看主体文件建议。

#### Step B

Metadata:

- time: `复兴纪元488年 1月15日 14:00:07`
- kind: `event`
- title: `[验收] 眼镜女生试探搭话`
- summary: `眼镜女生压低声音询问薇洛丝是否害怕，薇洛丝没有立刻回答，而是继续观察她脚下符文的变化。`

Mutations:

```json
[
    {
        "subjectId": "world",
        "attr": "events",
        "op": "listAppend",
        "value": "[验收] 眼镜女生压低声音询问薇洛丝是否害怕，薇洛丝没有立刻回答，而是继续观察她脚下符文的变化。"
    }
]
```

保存方式：使用 `写入并继续下一步`。

期望：

- 时间默认继续推进到下一秒。
- timeline 定位到新 slice。
- `files N` 徽标出现，且数量按 `player` 语境计算。

#### Step C

Metadata:

- time: `复兴纪元488年 1月15日 14:00:08`
- kind: `event`
- title: `[验收] 薇洛丝意识到自己未被重点监视`
- summary: `薇洛丝意识到子爵和法师的注意力暂时不在自己身上，这给了她继续观察出口和守卫站位的机会。`

Mutations:

```json
[
    {
        "subjectId": "world",
        "attr": "events",
        "op": "listAppend",
        "value": "[验收] 薇洛丝意识到子爵和法师的注意力暂时不在自己身上，这给了她继续观察出口和守卫站位的机会。"
    }
]
```

保存方式：普通保存并关闭 Composer。

期望：

- timeline 定位到 Step C。
- `player` 语境仍能生成主体文件建议。
- `world.events` 不会导致 Inspector 建议消失。

### 4. 主体文件建议检查

对 Step C 执行：

1. 点击 slice card 的 `files N`。
2. 确认右侧 Inspector 打开并滚到 `Subject file proposals`。
3. 检查 proposal：
   - source label 应显示 `当前主体语境下的 world 事件建议`。
   - `events.jsonl draft` 应是第一人称经历草稿。
   - event JSONL 应为 `{"text":"...","time":"复兴纪元488年 1月15日 14:00:08"}` 形态。
   - `text` 中不应重复包含时间前缀。
   - 若没有 memory mutation，`memory.jsonl candidates` 可以不存在。
   - `state.md review` 只在相关状态 attr 出现时存在。
4. 测试复制：
   - 复制单个 proposal。
   - 复制全部 proposal。
   - 复制 `events.jsonl` 行。
   - 若有 state review，复制 state review。
5. 测试打开目标文件：
   - 打开 `events.jsonl`。
   - 打开 `memory.jsonl`。
   - 打开 `state.md`。
6. 不把复制内容粘贴进六文件；本次只验收建议与打开链路。

### 5. 历史 slice 回看

1. 回到 Step A 或 Step B 的 slice card。
2. 点击该卡片的 `files N`。
3. 确认：
   - 选中对应历史 slice。
   - Inspector 打开。
   - 自动滚到 `Subject file proposals`。
   - proposal 内容对应被点击的历史 slice，而不是最新 Step C。

### 6. 常用操作覆盖

#### Metadata 编辑

1. 选中 Step C。
2. 在 Inspector 中把 title 改成：`[验收] 薇洛丝意识到自己未被重点监视（已编辑）`。
3. 保存 metadata。
4. 期望 timeline 卡片标题同步更新，slice 不被过滤挡住。

#### Mutation value 编辑

1. 仍选中 Step C。
2. 在底部 Mutation Editor 中把 value 末尾追加：`她决定暂时不暴露任何异常。`
3. 保存 value。
4. 期望保存成功后主体文件建议重新计算，event draft 反映新的 value。

#### State Query

1. 查询当前 slice 触及主体状态。
2. 展开完整世界状态。
3. 期望 `issues` 区域为空或清楚展示返回 issues，不应出现旧 re-settle 文案。

#### 删除测试

为避免删除主要三步验收记录，建议新建一条专门删除用 slice：

- time: `复兴纪元488年 1月15日 14:00:09`
- kind: `event`
- title: `[验收-可删除] 删除动作测试`
- summary: `这条 slice 只用于验证删除入口。`
- mutations:

```json
[
    {
        "subjectId": "world",
        "attr": "events",
        "op": "listAppend",
        "value": "[验收-可删除] 这条 slice 只用于验证删除入口。"
    }
]
```

保存后执行删除：

1. 选中 `[验收-可删除] 删除动作测试`。
2. 点击删除 slice。
3. 确认浏览器二次确认出现。
4. 确认删除后 timeline 不再显示该 slice。
5. 确认删除返回 issues 不会错挂到刷新后的当前 slice。

### 7. 草稿保护

1. 打开 Slice Composer。
2. 修改 title 或 mutations，但不保存。
3. 尝试关闭 Composer。
4. 期望出现未保存草稿确认。
5. 取消后草稿仍保留。
6. 再尝试关闭 Workbench。
7. 期望 Workbench 级草稿确认出现。

### 8. 执行后处理

验收完成后先不要立刻删除三条 `[验收]` 主线 slice；先把实际结果写入 walkthrough，保留可回查证据。

专门的 `[验收-可删除] 删除动作测试` slice 应在第 6 节删除测试中删除。如果验收结束后它仍存在，应记录为删除步骤未完成或失败。

后续由用户决定：

- 保留三条 `[验收]` slice，作为 World Engine 作者流演示记录。
- 或通过 Workbench UI 搜索 `[验收]` 并逐条删除，恢复真实小说 timeline。

不要直接改 `.nbook/project.sqlite`，也不要把主体文件建议自动写入 `simulation/subjects` 六文件。

## 通过标准

- 能打开 `ming-ding-zhi-shi-2` 并看到真实 schema / calendar / subject 摘要。
- 能用 `player` 上下文连续写入 3 个 slice。
- `world.events` 回退不会丢失 `player` 主体文件建议。
- `files N`、隐藏 Inspector 恢复入口、Inspector proposal 区域能互相对齐。
- proposal 复制与目标文件打开入口可用。
- metadata 编辑、mutation value 编辑、state query、完整 state、删除、草稿保护都能按预期工作。
- 不自动写入 `simulation/subjects` 六文件。

## 与计划出入

- 本轮只准备 runbook，没有执行浏览器验收。
- Runbook 会写入真实 Project SQLite；执行前仍需用户明确允许。
- 如果用户不希望污染 `ming-ding-zhi-shi-2`，需要先准备副本 Project 或改用测试 Project。
