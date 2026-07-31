# Writer Brief 剧本格式（RP v2）

Writer Brief 是 rp.leader 发给 rp.writer 的完整叙事剧本。rp.writer 不持有世界状态，它只消费 Brief 中的信息来渲染正文：先打草稿、用 stop-slop 自查、再把成稿写入 Brief 指定的 prose 路径并润色。

传递方式：Writer Brief 通过 `invoke_agent.message` 作为完整消息载荷发送给 rp.writer。rp.writer 的 profile initial 为空，Brief 不进入 `create_agent.initial`，也不需要外层 invocation XML 或显式阶段参数。

> 本文是 RP v2 版本（`rp/` 子树路径 + 权威 Tick 编号）；legacy 版本在 `reference/agent/rp-tick/writer-brief.md`，其 `simulation/runs/` 路径在 v2 中已废除。

## 核心原则

### Brief 本身就是信息过滤器

Brief 里有什么，writer 就知道什么。Brief 里没有的，writer 永远不知道。不需要单独列"信息控制""do_not_reveal"——不写进 Brief 的信息对 writer 来说就不存在。

### Brief 的核心结构

Writer Brief 使用少量稳定标签提供骨架，其余表达可以自由：

- `<writer_brief>`：根节点。
- `<context>`：唯一 read 白名单入口。内部只写 Markdown 链接列表，prose 前情和设定引用统一放在这里。
- `<materials>`：素材层。场景底色、人物状态、环境事件、可感知异常、写作原料。
- `<beats>`：剧情节拍层。必须覆盖的事件顺序。
- `<beat>`：单个剧情节拍。关键台词可完整给出，但不要把演绎句式写成成品正文。
- `<style>`：可选写作提示。环境音使用建议、节奏要求、远近景权重。

允许自定义 tag（如 `<reveal>`、`<turning_point>`、`<choice_point>`）。自定义 tag 只表达语义，不改变读取权限；只有 `<context>` 内 Markdown 链接的目标路径可被 writer 读取。

### Brief 是剧情骨架（不是完整剧本）

**Brief 给什么**：剧情骨架（事件逻辑，不是成品句式）、素材层、`<context>` 上下文引用。

**Writer 做什么**：把骨架演绎成具体措辞；根据人物状态选择具体表现（"紧张" → "冠冕又歪了一点，手指攥紧权杖"）；按剧情密度选用环境音。

缺失且阻塞写作的设定细节（如"卷轴材质"）writer 可通过 `report_result.result` 提问；缺失的剧情逻辑（如"接下来发生什么"）不应由 writer 补完。

### 不使用 lorebook 术语

writer 和用户是同一个视角。世界设定用**感官描述**代替**概念名词**：

- ✅ "脚下有一片淡蓝色的光圈在缓缓转动，光圈中有细小的、像文字一样的光在游走"
- ❌ "脚下的知识之环符文光环在转动"

如果用户在故事中还不知道某个概念的名字，Brief 的可写正文材料中就不能出现这个名字。`<context>` 的链接标题和路径是读取元数据，不受此限制。

### 不出现后台词汇

Brief 的**叙事正文材料**中不应出现：`brief`、`tick`、`裁决`、`screenwriter`、`lorebook`、`actor`、`profile` 等后台词汇。`<context>` 和 prose 输出路径属于指令元数据，路径里的 `ticks`、`lorebook` 等词不受这条限制。

### Brief 必须指定 prose 输出路径（v2 规则）

Brief 末尾必须给 writer 一条 prose 输出路径，放在 `</writer_brief>` 之后单独一行：

```text
prose 输出路径：rp/ticks/{NNNNNN}-{slug}/prose.md
```

- 路径是 Project-relative 的 `rp/ticks/...` 形式（文件工具会解析到当前 Project Workspace），**不要**加项目名前缀，也**不要**使用 legacy 的 `simulation/runs/...`。
- `{NNNNNN}` 是本 Tick 的权威编号：rp.leader 在 Tick 开始时用 `rp_tick_info` 取 `nextTick` 并宣告，六位补零；`{slug}` 用短横线英文短语。writer 不发明落点，落点由 rp.leader 决定。
- 开场白 / 初始化正文是 Bootstrap 固定特例：writer 写入 `rp/bootstrap/staging/opening-prose.md`，服务端激活验收通过后发布为 `rp/ticks/000000-initial-state/prose.md`。
- rp.leader 终稿组装时用同一路径生成标题链接。

### Context 读取边界

`<context>` 列出 writer 可按需读取的文件，格式统一为 Markdown 链接列表：

```xml
<context>
- [前情：被召唤](rp/ticks/000001-summoned/prose.md)
- [召唤术式](rp/lorebook/magic/召唤术式.md)
</context>
```

**选择原则**（rp.leader 决策）：直接因果（"延续上一幕"时引用上一 Tick）、伏笔呼应、人物状态延续、设定必要性。0–3 个链接。

**Writer 如何使用**：骨架提到"延续/回应/变化"等上下文依赖时按需 read；骨架自洽可不读；`<context>` 为空则不获得任何额外 read 权限；`<materials>`/`<beats>`/自定义 tag 中出现的路径不进入 read 白名单。

### Brief 给多少 LOD

从 rp.screenwriter 报告的 LOD 事件中，rp.leader 挑选**核心 2-3 个**放进 `<materials>` 的环境事件里，用 `high` / `medium` / `low` 标注优先级。

- **剧情相关性优先**：与用户化身行动、NPC 反应、场景转折直接相关的优先。
- **感官密度平衡**：剧情密集时只给 1-2 个；独处等待时给 3-5 个营造氛围。
- **可感知性过滤**：只给用户化身当前能感知的事件；远处的、隐藏的不写进 Brief。

## 开场白 Brief

开场白 Brief 用同一套格式，`<context>` 通常为空，`<beats>` 写"用户化身醒来 / 当前处境 / 可感知人物与异常 / 第一选择点"。rp.leader 不能把开场白直接写给用户，必须调用 rp.writer 写入暂存路径 `rp/bootstrap/staging/opening-prose.md`；激活成功前不得展示。

## rp.leader 编剧的工作

rp.leader 收到 rp.screenwriter 的终裁报告后，以用户化身视角组装 Brief：

1. **提取用户化身能感知的信息**：可见反应、台词、可观察的环境变化。
2. **过滤掉用户化身不知道的信息**：他人内心独白、隐藏设定、screenwriter 的推理过程——直接不写进 Brief。
3. **挑选核心环境事件（2-3 个）**：用感官语言写进 `<materials>`。
4. **提取人物状态**：可写状态关键词（如"紧张、底气不足"），不给演绎细节。
5. **组装剧情骨架**：终裁结果转为事件逻辑节拍；关键台词可完整给出。
6. **选择 context 链接**：0-3 个前情 prose 或 rp/lorebook 链接。
7. **指定 prose 输出路径**：用本 Tick 权威编号（`rp_tick_info` 宣告值）拼 `rp/ticks/{NNNNNN}-{slug}/prose.md`。

## 示例（核心结构）

```xml
<writer_brief>
  <context>
  - [前情：被召唤](rp/ticks/000001-summoned/prose.md)
  - [召唤术式](rp/lorebook/magic/召唤术式.md)
  </context>

  <materials>
    场景底色：仪式大厅，彩色玻璃窗，阳光投出彩色光斑，地面金色纹路正在熄灭。

    人物状态：
    - 子爵：紧张、底气不足、冠冕不稳
    - 眼镜女生：恐惧、试探性信任、攥紧背包

    环境事件：
    - high：洛丽塔火花在薇洛丝注视下变色（红蓝到淡紫）
    - medium：西侧窗户灌风，蜡烛晃动，蜡油啪嗒声
  </materials>

  <beats>
    <beat>薇洛丝决定走向眼镜女生</beat>
    <beat>运动男生正在向子爵质问威胁内容，声音压过大厅回音</beat>
    <beat>薇洛丝在眼镜女生旁边站定，侧头小声问"有没有事"</beat>
    <beat>台词："我……我没事。你、你也是被召唤过来的吧？"</beat>
    <reveal>台阶上持杖法师注视薇洛丝，眉头微皱，然后移开视线</reveal>
  </beats>

  <style>
    人称：第二人称，用"你"指代"薇洛丝"。
    对峙场景为远景声音层，不抢主线焦点；环境音点缀即止。
  </style>
</writer_brief>

prose 输出路径：rp/ticks/000002-approach-glasses-girl/prose.md
```
