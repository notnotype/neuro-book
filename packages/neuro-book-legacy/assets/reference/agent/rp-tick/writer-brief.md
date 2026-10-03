# Writer Brief 剧本格式

Writer Brief 是 rp.leader 发给 rp.writer 的完整叙事剧本。rp.writer 不持有世界状态，它只消费 Brief 中的信息来渲染正文，但渲染本身是多步的：先打草稿、用 stop-slop 自查、再把成稿写入 Brief 指定的 prose 路径并润色。

传递方式：Writer Brief 通过 `invoke_agent.message` 作为完整消息载荷发送给 rp.writer。rp.writer 的 profile initial 为空，Brief 不进入 `create_agent.initial`，也不需要外层 invocation XML 或显式阶段参数。

## 核心原则

### Brief 本身就是信息过滤器

Brief 里有什么，writer 就知道什么。Brief 里没有的，writer 永远不知道。

不需要单独列"信息控制""do_not_reveal""allowed_internality"——不写进 Brief 的信息对 writer 来说就不存在。

### Brief 的核心结构

Writer Brief 使用少量稳定标签提供骨架，其余表达可以自由：

- `<writer_brief>`：根节点。
- `<context>`：唯一 read 白名单入口。内部只写 Markdown 链接列表，prose 前情和内容节点引用统一放在这里，不再用标签区分。
- `<materials>`：素材层。放场景底色、人物状态、环境事件、可感知异常、写作原料；可用自由文本，也可用自定义 tag 表达更合适的语义。
- `<beats>`：剧情节拍层。放必须覆盖的事件顺序。
- `<beat>`：单个剧情节拍。关键台词可完整给出，但不要把演绎句式写成成品正文。
- `<style>`：可选的写作提示。放环境音使用建议、节奏要求、远近景权重等。

允许自定义 tag，例如 `<reveal>`、`<turning_point>`、`<choice_point>`、`<focus>`。自定义 tag 只表达语义，不改变读取权限；只有 `<context>` 内 Markdown 链接的目标路径可被 writer 读取。

### Brief 是剧情骨架（不是完整剧本）

Brief 提供剧情骨架和素材层，writer 负责演绎成叙事正文：

**Brief 给什么**：
- 剧情骨架：事件逻辑（"薇洛丝站在原地一动不动"），不是成品句式。
- 素材层：场景底色、人物状态、可感知环境事件、必要设定引用。
- 上下文引用：`<context>` 中的 Markdown 链接，writer 按需 read。

**Writer 做什么**：
- 把骨架演绎成具体措辞（"她站在那里，光从身后透过彩色玻璃窗照进来，在地板上投出斑驳的影子"）。
- 根据人物状态选择具体表现（"紧张" → "冠冕又歪了一点，手指攥紧权杖"）。
- 按剧情密度选用环境音（紧张对话时少用，独处等待时多用）。

Writer 的工作是把骨架"演绎"成叙事正文，而不是"补完"缺失的信息。缺失且阻塞写作的设定细节（如"卷轴材质"）可通过 `report_result.result` 提问，缺失的剧情逻辑（如"接下来发生什么"）则不应由 writer 补完。

### 不使用 lorebook 术语

writer 和用户是同一个视角。世界设定用**感官描述**代替**概念名词**：

- ✅ "脚下有一片淡蓝色的光圈在缓缓转动，光圈中有细小的、像文字一样的光在游走"
- ❌ "脚下的知识之环符文光环在转动"
- ✅ "之前那个把你们带到这里的仪式留下的痕迹"
- ❌ "异界召唤术式的残余魔力"

如果用户在故事中还不知道某个概念的名字，Brief 的可写正文材料中就不能出现这个名字。`<context>` 的链接标题和路径是读取元数据，不等于正文可写术语。

### 不出现后台词汇

Brief 的**叙事正文材料**中不应出现：`brief`、`tick`、`裁决`、`simulator`、`lorebook`、`actor`、`profile` 等后台词汇。

`<context>` 和 prose 输出路径属于指令元数据，路径里的 `ticks`、`lorebook` 等词不受这条限制。

### Brief 必须指定 prose 输出路径

Brief 末尾必须给 writer 一条 prose 输出路径，告诉它把成稿写到哪里。

- 这条路径是给 writer 的**指令元数据**，不是叙事正文，放在 `</writer_brief>` 之后单独一行。
- 这条路径会直接交给 Agent 文件工具。Project-bound Agent 的 File Scope 是当前 Project Workspace，因此必须使用 Project-relative 路径，形如 `simulation/runs/ticks/{id}-{slug}/prose.md`。
- `{project-slug}` 由当前 session 的 Project Workspace 决定，例如 `workspace/ming-ding-zhi-shi-2` 对应 `ming-ding-zhi-shi-2`。
- `{id}-{slug}` 由 rp.leader 按 `{project-slug}/simulation/runs/index.md` 顺序分配；id 用六位补零，slug 用短横线英文短语。
- 严禁把裸 `simulation/runs/...` 作为 prose 输出路径。裸 `simulation/...` 会被文件工具解析到 Workspace Root 直属目录，而不是当前 Project Workspace。
- 开场白 / 初始化正文是固定特例：它发生在第一个常规 Tick 前，但仍必须走 rp.writer，输出路径固定为 `{project-slug}/simulation/runs/ticks/000000-initial-state/prose.md`。
- writer 不发明落点，落点由 rp.leader 决定。writer 会先打草稿、用 stop-slop 自查、再 write 这个路径并 edit 润色，最后用一句话回报落点。
- rp.leader 终稿组装时用同一路径生成标题链接（见 README「组装回复」）。

### Context 读取边界

`<context>` 标签列出 writer 可按需读取的文件，格式统一为 Markdown 链接列表：

```xml
<context>
- [前情：被召唤](simulation/runs/ticks/000001-summoned/prose.md)
- [召唤术式](lorebook/magic/召唤术式.md)
</context>
```

**选择原则**（rp.leader 决策）：
- **直接因果**：本 Tick 剧情骨架明确提到"延续上一幕"、"回应刚才的问题"时，引用上一 Tick。
- **伏笔呼应**：本 Tick 揭示前情埋下的伏笔时，引用相关 Tick。
- **人物状态延续**：NPC 态度/情绪明显受前情影响时，引用初次互动的 Tick。
- **设定必要性**：正文必须使用某个设定物、规则或地点细节时，引用对应内容节点。

**Writer 如何使用**：
- 自检素材时，如果剧情骨架提到"延续"、"回应"、"变化"等上下文依赖，按需 read `<context>` 中的链接。
- 不强制全读：如果骨架已经自洽，可不读。
- 若 `<context>` 为空或不存在，writer 不获得任何额外 read 权限。
- 自定义 tag、`<materials>` 或 `<beats>` 中出现的路径不进入 read 白名单；需要授权读取时，必须把路径放进 `<context>` 的 Markdown 链接。

### Brief 给多少 LOD

从 simulator.leader 返回的 LOD 事件中，rp.leader 挑选**核心 2-3 个**放进 `<materials>` 的环境事件里，并用 `high` / `medium` / `low` 或自然语言标注优先级。

**挑选原则**：
- **剧情相关性优先**：与用户化身行动、NPC 反应、场景转折直接相关的事件优先。
- **感官密度平衡**：剧情密集时（快速对话、紧张对峙）只给 1-2 个核心事件；独处等待时给 3-5 个营造氛围。
- **可感知性过滤**：只给用户化身当前能感知的事件（视线范围、听觉范围）；远处的、隐藏的、微观的不写进 Brief。

**Writer 如何使用**：
- 紧张对话场景：只用 high priority，1-2 个，点缀即止。
- 独处等待场景：用 high + medium，3-5 个，营造氛围。
- `<style>` 中的环境音建议优先于默认密度规则。

## 开场白 Brief

开场白 Brief 用同一套格式，只是 `<context>` 通常为空，`<beats>` 写“用户化身醒来 / 当前处境 / 可感知人物与异常 / 第一选择点”。rp.leader 不能把这段开场白直接写给用户，必须调用 rp.writer 写入固定路径。

```xml
<writer_brief>
  <context>
  </context>

  <materials>
    开局地点、身体感受、光线、气味、距离、可见人物和用户化身合理已知信息。
    人物状态只写用户化身能观察到的外显状态。
    环境事件：
    - high：必须在开场白体现的异常或第一钩子
  </materials>

  <beats>
    <beat>用户化身恢复意识或进入现场</beat>
    <beat>呈现身体感受和空间环境</beat>
    <beat>呈现关键人物的可见反应</beat>
    <choice_point>呈现一个可行动的第一选择点</choice_point>
  </beats>

  <style>
    开场白优先建立“我在这里”的身体感和空间感，不写规则讲解。
  </style>
</writer_brief>

prose 输出路径：simulation/runs/ticks/000000-initial-state/prose.md
```

## 每一幕应该包含

- **谁做了什么**：动作节拍，精确到身体语言。
- **谁说了什么**：完整台词，包含语气和停顿。
- **环境细节**：从 LOD 提取的、用户化身能感知的事件。
- **可选的叙事暗示**：如"可以写成后颈微凉的直觉暗示"。
- **可选的比喻建议**：如"像是有人突然在安静的图书馆里敲了一下桌子"。

## rp.leader 编剧的工作

rp.leader 收到 simulator.leader 的裁决结果后，以用户化身视角组装 Brief。核心工作：

1. **从裁决结果中提取用户化身能感知的信息**：可见反应、台词、可观察的环境变化。
2. **过滤掉用户化身不知道的信息**：其他角色的内心独白、lorebook 隐藏设定、simulator 的推理过程——这些直接不写进 Brief。
3. **从 LOD 中挑选核心环境事件（2-3 个）**：用感官语言写进 `<materials>`，剧情密集时少选，独处等待时多选。
4. **提取人物状态**：从 simulator.leader 的裁决中提取可写状态关键词（如"紧张、底气不足"），不给演绎细节。
5. **组装剧情骨架**：把裁决结果转为事件逻辑（`<beat>` 或自定义语义 tag），不含具体措辞；关键台词可完整给出。
6. **选择 context 链接**：按直接因果、伏笔呼应、人物状态延续、设定必要性原则，选择 0-3 个前情 prose 或内容节点链接。
7. **指定 prose 输出路径**：按 `{project-slug}/simulation/runs/index.md` 顺序分配 `{id}-{slug}`，在 Brief 末尾给出带 `{project-slug}/` 前缀的 prose 落点，供 writer 写入、供终稿组装生成标题链接。

## 示例

完整示例见 [tick-002-example.md](tick-002-example.md)。

以下是核心结构示例：

```xml
<writer_brief>
  <context>
  - [前情：被召唤](simulation/runs/ticks/000001-summoned/prose.md)
  - [召唤术式](lorebook/magic/召唤术式.md)
  </context>

  <materials>
    场景底色：仪式大厅，彩色玻璃窗，阳光投出彩色光斑，陈旧木材、蜡烛和香料气味，地面金色纹路正在熄灭。

    人物状态：
    - 子爵：紧张、底气不足、冠冕不稳
    - 运动男生：愤怒、不信任、金色光幕因情绪波动变亮
    - 眼镜女生：恐惧、试探性信任、攥紧背包
    - 洛丽塔女孩：好奇、专注于火花变化

    环境事件：
    - high：洛丽塔火花在薇洛丝注视下变色（红蓝到淡紫）
    - medium：彩色光斑位置偏移，红光从大厅中央移到眼镜女生方向
    - medium：西侧窗户灌风，蜡烛晃动，蜡油啪嗒声
    - low：横梁有灰尘落下
  </materials>

  <beats>
    <beat>薇洛丝决定走向眼镜女生</beat>
    <beat>运动男生正在向子爵质问威胁内容，声音压过大厅回音</beat>
    <beat>台词："到底是什么威胁？你连这都不肯说？"</beat>
    <beat>卫兵视线偏向对峙方向，金属甲胄摩擦声</beat>
    <beat>没人在看薇洛丝这边</beat>
    <beat>薇洛丝走过熄灭的金色纹路，几乎无声</beat>
    <beat>途中看到洛丽塔女孩蹲在地上，火花跳跃</beat>
    <turning_point>洛丽塔发出轻声"诶……？"；火花让金色纹路短暂亮起</turning_point>
    <beat>薇洛丝继续前进，在眼镜女生旁边站定</beat>
    <beat>眼镜女生脚下有淡蓝色光圈，文字符号浮动</beat>
    <beat>红色光斑落在蓝色光圈上，文字泛紫</beat>
    <beat>薇洛丝侧头小声问"有没有事"</beat>
    <beat>眼镜女生肩膀抖了一下，确认有人在跟她说话</beat>
    <beat>台词："我……我没事。"（声音很轻）</beat>
    <beat>台词："你、你也是被召唤过来的吧？"</beat>
    <beat>眼镜女生目光扫过薇洛丝，寻找"光幕/火花/发光文字"，什么都没有</beat>
    <beat>但她没有露出"哑火"眼神</beat>
    <beat>台词："你……你不害怕吗？"</beat>
    <beat>手指松了一点点，不再那么用力攥背包带</beat>
    <reveal>台阶上持杖法师注视薇洛丝，眉头微皱，握杖手收紧，然后移开视线</reveal>
    <beat>薇洛丝可能感到后颈微凉（被注视的直觉暗示）</beat>
  </beats>

  <style>
    人称：第二人称，用 “你” 指代 “薇洛丝”
    对峙场景为远景声音层，不抢主线焦点；
    蜡烛、光斑、灰尘等环境音点缀即止；
    洛丽塔火花变色为 high priority，必须体现。
  </style>
</writer_brief>

prose 输出路径：simulation/runs/ticks/000003-approach-glasses-girl/prose.md
```
