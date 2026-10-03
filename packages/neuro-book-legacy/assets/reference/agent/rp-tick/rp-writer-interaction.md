# RP Writer 单通道协作协议

## 概述

rp.writer 是 RP Tick 的用户可见正文渲染 agent。它的 profile initial 为空，每轮只通过 `invoke_agent.message` 接收一份完整 Writer Brief。

核心原则：

- 最新 user message 就是完整 Writer Brief，不需要额外的 invocation 外层包装。
- Writer Brief 不进入 `create_agent.initial`；创建 writer session 时使用 `initial: {}`。
- rp.writer 收到 Brief 后先自检。材料不足就提问；材料足够就写入 Brief 指定路径。
- 提问和完成说明都使用 `report_result.result` 纯文本，不使用 `report_result.data` 的结构化字段。

## 调用流程

### 1. 创建 writer session

每个 prose artifact 使用一个新的 rp.writer session。

```ts
create_agent({
    profileKey: "rp.writer",
    initial: {},
    title: "rp.writer: 000001-awakening",
})
```

`input` 必须保持为空对象。不要把任务阶段、Brief 正文或补充材料放进 profile initial。

### 2. 发送完整 Brief

```ts
invoke_agent({
    sessionId,
    message: writerBrief,
})
```

`message` 的内容就是完整 Writer Brief，通常包含 `<writer_brief>` XML 结构和末尾的 `prose 输出路径：...` 行。

不要发送空 `continue`。不要把 Brief 拆成检查和渲染两轮固定调用。不要使用外层 invocation XML。

### 3. writer 自检

rp.writer 在写作前检查：

- 是否存在 `prose 输出路径`。
- `prose 输出路径` 是否是当前 Project Workspace 的 Project-relative 路径，形如 `simulation/runs/ticks/{id}-{slug}/prose.md`。
- 是否有足够的场景底色、角色状态、剧情骨架和视角边界。
- `<context>` 中的 Markdown 链接是否足以支撑 Brief 要求。
- 是否存在需要上级补充、否则会迫使 writer 编造的关键材料。

如果没有阻塞问题，writer 直接执行写作流程：打草稿、stop-slop 自查、write 成稿、edit 润色、用 `report_result.result` 汇报实际写入路径。

如果有阻塞问题，writer 不写文件，只用 `report_result.result` 以纯文本列出问题。

## Writer Brief 结构

Writer Brief 的稳定骨架很小：

```xml
<writer_brief>
  <context>
  - [前情：被召唤](simulation/runs/ticks/000001-summoned/prose.md)
  - [召唤术式](lorebook/magic/召唤术式.md)
  </context>

  <materials>
    场景底色、人物状态、可感知环境事件、必要设定材料。
  </materials>

  <beats>
    <beat>必须覆盖的剧情节拍</beat>
    <turning_point>允许自定义 tag 表达更准确的剧情语义</turning_point>
  </beats>

  <style>
    可选写作提示、环境音使用建议、远近景权重。
  </style>
</writer_brief>

prose 输出路径：simulation/runs/ticks/000001-awakening/prose.md
```

`<materials>`、`<beats>` 和 `<style>` 内允许自定义 tag，只要能更好表达意思即可。自定义 tag 不改变文件读取权限。

## 提问边界

rp.writer 只能询问会阻塞写作的具体材料。

允许问：

- 设定物的材质、外观、声音、触感、使用规则。
- 当前场景的物理属性，例如光源、空间大小、气味、温度、可见障碍。
- Brief 已授权呈现的人物状态的可观察表现边界。
- Brief 明确依赖但路径无法读取或内容不足的前情。

不允许问：

- 人物真实动机、隐藏立场、未说出口的想法。
- 接下来剧情应该怎么发展。
- 用户化身应该做什么或说什么。
- Brief 没有授权的秘密设定、全知信息或 simulator 推理。

rp.leader 收到越界问题时，不把隐藏答案透露给 writer。它应修改 Brief 的可写层，只补充用户化身可感知、正文可呈现的信息。

## 补充材料流程

补充不是增量 answer 消息。rp.leader 必须修改或扩展原 Writer Brief，然后再次向同一个 writer session 发送完整新版 Brief。

```ts
invoke_agent({
    sessionId,
    message: updatedWriterBrief,
})
```

updatedWriterBrief 应仍然是一份可独立执行的完整 Brief，包含全部可写事实、剧情骨架、context 链接和 prose 输出路径。writer 不需要从历史消息拼接任务。

## 文件读取边界

rp.writer 不自主检索 `lorebook/`、`manual/`、`simulation/`、`agents/` 或 `reference/`。

它只允许读取 Writer Brief 中 `<context>` 内 Markdown 链接的目标路径：

```xml
<context>
- [前情：被召唤](simulation/runs/ticks/000001-summoned/prose.md)
- [召唤术式](lorebook/magic/召唤术式.md)
</context>
```

读取后也只能使用 Brief 授权可写的部分。Brief 外的信息视为不存在。

`<materials>`、`<beats>`、`<style>` 或自定义 tag 中出现的路径不自动授权读取；需要读取时，必须把路径放进 `<context>` 的 Markdown 链接列表。若 `<context>` 为空或不存在，writer 不获得任何额外 read 权限。

## 输出路径规则

Brief 必须用独立元数据行指定输出路径：

```text
prose 输出路径：simulation/runs/ticks/000001-awakening/prose.md
```

这条路径会直接交给 Agent 文件工具。Project-bound Agent 的 File Scope 是当前 Project Workspace，因此输出路径必须使用 `simulation/runs/...` 这样的 Project-relative 路径；不要重复添加 Project slug 前缀。

如果缺少这行，或输出路径不是可用的 Project-relative 路径，rp.writer 不写文件，不自己生成项目名、tick slug 或默认路径，只用 `report_result.result` 报告缺少可用 prose 输出路径。

写入完成后，rp.writer 用 `report_result.result` 汇报实际落点，例如：

```text
已写入：simulation/runs/ticks/000001-awakening/prose.md
```

## writing_reference 隔离

`writing_reference` 只提供文风样本。里面的人名、地点、道具、剧情、项目路径和 tick 路径都不是当前故事事实。

rp.writer 不得从 `writing_reference` 中提取当前人物、场景、前情或输出路径。当前可写事实只能来自最新 Writer Brief。
