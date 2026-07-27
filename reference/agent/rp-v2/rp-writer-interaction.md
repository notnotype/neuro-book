# RP Writer 单通道协作协议（RP v2）

## 概述

rp.writer 是 RP Tick 的用户可见正文渲染 agent。它的 profile initial 为空，每轮只通过 `invoke_agent.message` 接收一份完整 Writer Brief（格式见 [writer-brief.md](writer-brief.md)）。

> 本文是 RP v2 版本（`rp/` 子树路径）；legacy 版本在 `reference/agent/rp-tick/rp-writer-interaction.md`。

核心原则：

- 最新 user message 就是完整 Writer Brief，不需要额外的 invocation 外层包装。
- Writer Brief 不进入 `create_agent.initial`；创建 writer session 时使用 `initial: {}`。
- rp.writer 收到 Brief 后先自检。材料不足就提问；材料足够就写入 Brief 指定路径。
- 提问和完成说明都使用 `report_result.result` 纯文本。

## 调用流程

### 1. 创建 writer session

每个 prose artifact 使用一个新的 rp.writer session。

```ts
create_agent({
    profileKey: "rp.writer",
    initial: {},
    title: "rp.writer: 000002-approach-glasses-girl",
})
```

`initial` 必须保持为空对象。不要把任务阶段、Brief 正文或补充材料放进 profile initial。

### 2. 发送完整 Brief

```ts
invoke_agent({
    sessionId,
    message: writerBrief,
})
```

不要发送空 `continue`。不要把 Brief 拆成检查和渲染两轮固定调用。

### 3. writer 自检

rp.writer 在写作前检查：

- 是否存在 `prose 输出路径`，且是 `rp/ticks/{NNNNNN}-{slug}/prose.md` 形式的 Project-relative 路径。
- 是否有足够的场景底色、角色状态、剧情骨架和视角边界。
- `<context>` 中的 Markdown 链接是否足以支撑 Brief 要求。
- 是否存在需要上级补充、否则会迫使 writer 编造的关键材料。

没有阻塞问题：打草稿、stop-slop 自查、write 成稿、edit 润色、用 `report_result.result` 汇报实际写入路径。有阻塞问题：不写文件，只用 `report_result.result` 纯文本列出问题。

## 提问边界

rp.writer 只能询问会阻塞写作的具体材料。

允许问：设定物的材质/外观/声音/触感；当前场景的物理属性（光源、空间、气味）；Brief 已授权人物状态的可观察表现边界；Brief 明确依赖但路径无法读取或内容不足的前情。

不允许问：人物真实动机、隐藏立场、未说出口的想法；接下来剧情应该怎么发展；用户化身应该做什么；Brief 没有授权的秘密设定或全知信息。

rp.leader 收到越界问题时，不把隐藏答案透露给 writer，只修改 Brief 的可写层，补充用户化身可感知、正文可呈现的信息。

## 补充材料流程

补充不是增量 answer 消息。rp.leader 必须修改或扩展原 Writer Brief，然后再次向同一个 writer session 发送**完整新版 Brief**——一份可独立执行、包含全部可写事实/剧情骨架/context 链接/prose 输出路径的 Brief。writer 不需要从历史消息拼接任务。

## 文件读取边界

rp.writer 不自主检索 `rp/lorebook/`、`rp/manual/`、`rp/characters/`、`agents/` 或 `reference/`；写作模式的根 `lorebook/`、`manual/`、`manuscript/` 更是禁区。

它只允许读取 Writer Brief 中 `<context>` 内 Markdown 链接的目标路径。读取后也只能使用 Brief 授权可写的部分；Brief 外的信息视为不存在。`<materials>`/`<beats>`/`<style>` 或自定义 tag 中出现的路径不自动授权读取。

## 输出路径规则

Brief 必须用独立元数据行指定输出路径：

```text
prose 输出路径：rp/ticks/000002-approach-glasses-girl/prose.md
```

- 路径直接交给文件工具，必须是 `rp/ticks/...` 形式的 Project-relative 路径；不要加项目名前缀，不要使用 legacy 的 `simulation/runs/...`。
- 如果缺少这行或路径不合规，rp.writer 不写文件、不自己生成 tick 编号或默认路径，只用 `report_result.result` 报告缺少可用 prose 输出路径。

写入完成后，rp.writer 用 `report_result.result` 汇报实际落点：

```text
已写入：rp/ticks/000002-approach-glasses-girl/prose.md
```

## writing_reference 隔离

`writing_reference` 只提供文风样本。里面的人名、地点、道具、剧情、项目路径和 tick 路径都不是当前故事事实。rp.writer 不得从中提取当前人物、场景、前情或输出路径；当前可写事实只能来自最新 Writer Brief。
