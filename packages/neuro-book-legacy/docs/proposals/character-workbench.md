# Character Workbench 提案

状态：reviewing

## 问题

当前 Character 与 Low-code Form 已有实现和零散字段合同，但角色导航、搜索、编辑器、关系分组、失败语义和持久化尚未形成可重建当前行为的完整规范。

## 当前证据与边界

以下正文是历史需求与 UI 设计素材，不是已生效产品合同。当前代码证据位于 `server/low-code-form/`、相关前端组件和测试；任何实现前必须按现行代码重新核对，并把批准行为提炼到 `docs/specs/character/`。本提案不能被代码、测试或 Agent 当作当前规范。

## 历史需求素材


关于角色界面的UI设计：

1. 做角色侧栏
2. 角色面板角色不用树状展示。采取平铺的方式列出的方式。区分 /character 根目录下的角色（这些是常用角色） 与其他在别的目录的角色（这些可能和地点、组织绑定）
3. 这个侧栏主要目的是便于索引、搜索角色。可以在面板底部加一个可折叠的信息面板
4. 角色编辑、设计主体界面可以用 dialog window 承载
5. 角色设计界面可以加上：头像、略缩图、引用等具体详细功能（从小说创作者的角度思考，角色最需要的数据）

---

# 一、角色导航器分组设计

### 1. Pinned

用户主动收藏的角色。

用途：

* 主角
* 常用视角角色
* 当前正在写的关键角色
* 临时高频角色

排序建议：

* 手动拖拽排序
* 无手动排序时按最近访问时间

---

### 2. `/character` 直属角色

即：

* 根在 `character.*`
* 且通常是全书常用角色

这组的产品语义建议叫：

* **主要角色**
* 或 **角色库**
* 不一定直接显示成“/character”

因为 UI 上最好讲“人话”，不要把路径概念直接暴露给创作者。

排序建议：

* pinned 优先剔除
* 然后按 sortOrder
* 再按 title

---

### 3. 其他绑定角色

这组是最有价值的一组，因为它会让你的系统从“条目编辑器”变成“创作工作台”。

建议叫：

* **场景角色**
* **上下文角色**
* **绑定角色**

其中“绑定角色”最技术，“场景角色”最创作，“上下文角色”最中性。

## 这组怎么分子组

建议按“绑定主体”分组：

```text
孤儿院
  院长
  孤儿A

O5
  成员A
  成员B
```

绑定来源可来自：

### A. 父路径归属

例如这个角色本身挂在某个 location / organization 节点下面。

### B. 显式关系

例如：

* `relation=member_of`
* `relation=works_at`
* `relation=lives_in`
* `relation=belongs_to`

### C. 扩展字段

如果你后续在 `ext.character` 里有：

* `primaryOrganization`
* `primaryLocation`

也可以辅助分组。

## 分组优先级建议

为了避免一个角色同时出现在多个绑定分组里，建议先定一个“主绑定来源”：

1. `ext.character.primaryContext`
2. 强语义 refs（如 `member_of` / `works_at` / `lives_in`）
3. 父路径归属
4. 无绑定则归入“其他角色”

---

# 三、详细的角色设计界面字段

这里我按“小说创作者最需要的数据”来设计，不按数据库工程师思路来设计。

我建议把角色界面分成 8 个区块。
其中：

* 一部分映射到 core 字段
* 一部分映射到 `refs`
* 一部分映射到 `ext.character`

这样最稳。

---

## A. 基础标识

这是最基础、必须有的。

### 字段

* `title`
  角色展示名

* `name`
  slug，用于 path 生成；一般不在创作者主界面强调，但高级模式可编辑

* `aliases`

  * 别名
  * 旧名
  * 绰号
  * 假名
  * 尊称

* `type`
  固定为 `character`

* `subtype`
  建议可选：

  * person
  * important
  * background
  * unknown
  * group
    这个和你已有推荐 subtype 是一致的。

* `status`

  * active
  * draft
  * deprecated
  * archived

* `tags`
  例如：

  * 主角
  * 王族
  * 银龙
  * 导师
  * 敌对势力

---

## B. 视觉信息

这是角色模块很重要的一层。

### 字段

* `avatar`
  头像

* `thumbnail`
  缩略图 / 小卡片图

* `gallery`
  参考图集，可选

* `visualKeywords`
  视觉关键词
  例如：

  * 银发
  * 红瞳
  * 冷色系
  * 旧军装

* `designNotes`
  视觉设计备注
  例如：

  * 平时戴手套
  * 头发末梢有轻微蓝色渐变

---

## C. 一句话角色定义

这是创作者最常用、最值钱的一组。

### 字段

* `logline`
  一句话角色定义
  例：
  “被流放的银龙公主”

* `summary`
  lorebook 默认注入摘要

* `archetype`
  角色原型 / 戏剧功能
  例如：

  * 主角
  * 导师
  * 宿敌
  * 伪反派
  * 喜剧缓冲

* `coreConflict`
  角色核心冲突
  例如：

  * 想信任别人，却不敢信任
  * 渴望权力，但厌恶王族身份

* `writingTip`
  写作提示
  例如：

  * 对话尽量短
  * 少直接表达感情
  * 情绪通过动作体现

---

## D. 角色设定卡

这是角色页面的主体。

建议放到 `ext.character.profile` 里。

### 字段

* `gender`
* `age`
* `birthday`
* `race`
* `species`
* `faction`
* `occupation`
* `identity`
* `socialClass`
* `education`
* `residence`
* `origin`

其中最常用的是：

* 种族
* 身份
* 阵营
* 职业
* 出身
* 常驻地

---

## E. 外貌与表现

这组字段很适合小说创作者。

### 字段

* `appearance`
  外貌总描述

* `bodyFeatures`
  身体特征
  例如：

  * 偏瘦
  * 左眼有疤
  * 手指修长

* `clothingStyle`
  穿着风格

* `voiceStyle`
  声线 / 说话感觉

* `mannerisms`
  习惯动作
  例如：

  * 思考时会轻敲桌面
  * 紧张时会捏袖口

* `smellOrAura`
  气味 / 气场
  这类很适合强化文风

---

## F. 性格与心理

这是很核心的一块。

### 字段

* `personalityTraits`
  性格关键词列表
  例如：

  * 冷静
  * 高傲
  * 敏感
  * 疑心重

* `temperament`
  更整体的气质概括

* `likes`

* `dislikes`

* `fears`

* `weaknesses`

* `desires`

* `motivation`

* `values`

* `taboos`

* `secrets`

我建议其中最核心、优先展示的是：

* `personalityTraits`
* `motivation`
* `fears`
* `weaknesses`
* `secrets`

---

## G. 叙事与成长

这是“小说角色工具”和“普通资料库”的分水岭。

### 字段

* `firstAppearance`
  初登场章节 / 场景

* `roleInStory`
  在故事中的功能

* `characterArc`
  角色弧光
  例如：

  * 不信任他人 → 接受同伴
  * 逃避责任 → 主动承担

* `currentState`
  当前状态
  例如：

  * 流亡中
  * 卧底中
  * 被软禁

* `keyEvents`
  关键事件列表

* `relationshipsSummary`
  关系概述

* `publicPersona`
  他人眼中的样子

* `trueSelf`
  真实自我

* `goalsShortTerm`

* `goalsLongTerm`

如果你问“最有用的是哪几个”：

* `characterArc`
* `currentState`
* `keyEvents`
* `goalsShortTerm`
* `goalsLongTerm`

---

## H. 能力与资源

如果是奇幻 / 修仙 / 科幻，这组很重要。

### 字段

* `abilities`
  能力列表

* `skills`
  技能列表

* `equipment`
  常用装备

* `resources`
  可调用资源
  例如：

  * 王国情报网
  * O5 内线
  * 家族财产

* `limitations`
  能力限制 / 使用代价

---

## I. 关系与引用

这个不要混在 profile 文本里，应该单独做成结构化区块。

### 字段来源

建议主要走 `refs`

### 关系分类建议

* `family`
* `ally`
* `enemy`
* `mentor`
* `student`
* `member_of`
* `leader_of`
* `works_at`
* `lives_in`
* `born_in`
* `owns`
* `uses`
* `bound_by`
* `cares_about`
* `protects`
* `suspects`
* `loves`
* `hates`

### 每条关系可以附加

* relation
* target
* note
* strength
* visibility
  （公开 / 隐藏 / 只有作者知道）

这里的“visibility”很适合创作，因为很多关系在故事里并不是公开信息。

---

## J. 检索与注入

这块直接服务 agent / lorebook。

### 字段

* `retrieval.keywords`
* `retrieval.tip`
* `injectionPriority`
* `injectionSummary`
* `aliasTriggers`

其中前两个和你的 core 设计完全一致。
后几个可以放 `ext.character.retrievalProfile`。

---

# 四、我建议的字段分层

为了避免界面太乱，我建议前端不要一次性把这些字段全部摊开。

## 第一层：最常用

角色窗口打开默认先看到这些：

* 头像
* title
* aliases
* tags
* 一句话角色定义
* summary
* 性格关键词
* 动机
* 当前状态
* 角色弧光
* 关系概览
* 关键事件

## 第二层：展开后编辑

* 外貌
* 习惯动作
* likes / dislikes
* fears / weaknesses
* 秘密
* 资源
* 能力限制
* 视觉参考图

## 第三层：高级

* name / path
* subtype
* retrieval
* governance
* review
* 注入调试信息

---

# 五、推荐的角色窗口 tab

为了让字段可用，我建议角色 window 面板拆成这些 tab：

## 1. 概览

显示最重要的信息：

* 头像
* title
* logline
* summary
* 角色卡
* 当前状态
* 关系摘要

## 2. 设定

编辑详细 profile：

* 身份
* 外貌
* 性格
* 心理
* 能力
* 资源

## 3. 关系

编辑 `refs`：

* 出引用
* 入引用
* pending
* 一键创建关系

## 4. 剧情

* 初登场
* 关键事件
* 角色弧光
* 长短期目标

## 5. 素材

* 头像
* 缩略图
* 图集
* 视觉备注

## 6. Lorebook / 注入

* summary
* writingTip
* retrieval.keywords
* retrieval.tip
* agent 视图预览

## 7. 高级

* path
* name
* parentId
* sortOrder
* status
* governance

---

# 六、UX：前端本地搜索是否可行

你说：

> 因为角色不多，角色导航器直接在前端做搜索

我同意。非常合适。

在“角色数量不多”的前提下，前端本地搜索的优势很大：

* 即时响应
* 不依赖后端接口
* 可做模糊匹配
* 可做高亮
* 体验比请求式搜索更顺

所以这里不用过度工程化。

---

# 七、搜索应该怎么做：按“最核心/最重要”到“最不重要”的实现顺序

这里我按“投入最少、收益最大”的顺序给你排。

---

## 第 1 级：标题前缀 / 包含匹配

### 搜索字段

* `title`
* `aliases`

### 匹配方式

* 大小写不敏感
* 前缀匹配优先
* 包含匹配其次

### 为什么最优先

因为用户大多数时候搜角色，是按名字搜。

例如：

* 主角
* 院长
* 银龙公主
* old nickname

这是最核心、收益最高的一步。

### 排序建议

1. title 前缀命中
2. alias 前缀命中
3. title 包含命中
4. alias 包含命中

---

## 第 2 级：标签匹配

### 搜索字段

* `tags`

### 例子

搜：

* 王族
* 主角
* 导师
* 敌对

### 为什么第二优先

创作者经常按“角色类别”找人，而不是按名字找。

这一步实现成本也很低。

### 排序建议

标签命中排在名字命中之后。

---

## 第 3 级：一句话定义和摘要匹配

### 搜索字段

* `logline`
* `summary`

### 例子

搜：

* 流亡
* 孤儿院
* 银发
* 王位继承

### 为什么第三优先

这是“按概念找角色”的开始，已经很有用了，但命中精度不如标题和标签稳定。

### 排序建议

排在 title / aliases / tags 后面。

---

## 第 4 级：关系对象匹配

### 搜索字段

* refs 的 target title / path
* 绑定上下文名称

### 例子

搜：

* O5
* 孤儿院
* 王国A

返回：

* 所属 O5 的角色
* 住在孤儿院的角色

### 为什么很重要

这是你系统最有特色的一层。
因为普通角色卡产品通常搜不到“与 O5 有关的角色”，但你的 lorebook 能做到。

### 为什么排第四

因为它需要预处理 refs 和目标标题映射，复杂度比前几级高一点。

---

## 第 5 级：扩展字段匹配

### 搜索字段

例如：

* 性格
* 动机
* 秘密
* 当前状态
* 身份
* 阵营

### 例子

搜：

* 冷静
* 流亡
* 王族
* 实验体

### 为什么不是最先做

虽然价值高，但字段很多、噪音也会变大。
如果太早做，结果会“什么都能搜到”，反而不准。

所以应该在前几级稳定之后再加。

---

## 第 6 级：拼音 / 多语言 / 容错匹配

例如：

* 中文转拼音
* 编辑距离
* typo 容错

### 为什么最后做

这是锦上添花，不是雪中送炭。
角色数量不多时，收益远低于前面几级。

---

# 八、我建议的本地搜索排序权重

你后面实现时，可以做一个简单评分，不必一开始就上复杂搜索库。

## 推荐优先级分值

只是示意：

* title 前缀命中：100
* alias 前缀命中：90
* title 包含：80
* alias 包含：70
* pinned：+20
* `/character` 直属角色：+10
* tag 命中：60
* logline 命中：50
* summary 命中：40
* 关系对象命中：35
* ext.character 字段命中：25
* 最近访问：+15

这样基本就够用了。

---

# 九、推荐的搜索实现阶段

## Phase 1：立即可做

* title
* aliases
* pinned 加权
* `/character` 加权
* tags
* 本地高亮
* 分组内排序

## Phase 2：增强可用性

* summary / logline
* 最近访问
* 绑定角色上下文命中
* 空搜索时显示最近角色

## Phase 3：高级搜索

* refs 目标匹配
* ext.character 多字段匹配
* 高级筛选（按阵营 / 组织 / 标签）

## Phase 4：锦上添花

* typo 容错
* 拼音
* 搜索语法（tag:主角 faction:王国A）

---

# 十、最建议你先落地的“最小可用角色搜索”

如果你现在就要做，我建议第一版只做这些：

## 数据源

每个角色预先拉一份轻量索引：

* id
* title
* aliases
* tags
* summary
* logline
* pinned
* isUnderCharacterRoot
* bindingContextTitle
* recentScore

## 搜索逻辑

输入关键词后：

1. 先匹配 `title`
2. 再匹配 `aliases`
3. 再匹配 `tags`
4. 再匹配 `summary/logline`
5. 给 pinned 和 `/character` 角色加权
6. 分组显示结果：

   * pinned
   * 主要角色
   * 绑定角色

这样第一版就已经很好用了。

---

# 十一、最后给你一个可直接执行的结论

## 角色设计界面字段，最核心必须先做的

先做这一批就已经很强：

* 头像
* title
* aliases
* tags
* logline
* summary
* personalityTraits
* motivation
* currentState
* characterArc
* keyEvents
* refs
* writingTip
* retrieval.keywords
* retrieval.tip

## 搜索实现顺序

从最重要到最不重要：

1. `title`
2. `aliases`
3. `pinned` / `/character` 权重
4. `tags`
5. `logline`
6. `summary`
7. 绑定上下文 / refs 目标
8. `ext.character` 其他字段
9. 容错 / 拼音 / 高级语法

下面是一份**可直接用于设计评审 / 前后端实现的《Character 模块需求文档（v1）》**。
已结合你当前 LoreBook Core 设计、UI/UX 讨论与实现优先级整理。

---

# Character 模块需求文档（v1）

## 一、模块定位

### 1.1 定义

Character 模块是 LoreBook 的一个**角色工作台（Character Workspace）**，用于：

* 管理 `type=character` 的条目
* 以“角色”为中心聚合跨条目信息（location / organization / item / rule）
* 提供角色设计、关系建模、写作辅助能力

---

### 1.2 设计原则

1. **数据真相源仍在 LoreBook Core**

   * 使用统一 `LorebookEntry`
   * 使用 `refs` 表达关系
   * 不引入第二套数据结构

2. **Character 是视图层，不是数据层**

   * 不改变树结构（parentId）
   * 不生成新的 path
   * 所有“关系展示”为 UI 投影

3. **角色优先于目录**

   * UI 以角色为核心
   * 树仅用于导航

---

## 二、信息架构（IA）

```text
Character Module

├── 角色导航器（左侧）
│   ├── Pinned
│   ├── 主要角色（/character）
│   └── 绑定角色（按上下文分组）
│
├── 角色列表（可选中间区）
│   ├── 卡片视图
│   └── 列表视图
│
└── 角色窗口（右侧 / 浮动 window）
    ├── 概览
    ├── 设定
    ├── 关系
    ├── 剧情
    ├── 素材
    ├── Lorebook
    └── 高级
```

---

## 三、角色导航器（Character Navigator）

### 3.1 功能

* 快速查找角色
* 快速切换角色
* 显示角色状态
* 支持本地搜索

---

### 3.2 分组规则

#### 1. Pinned（收藏角色）

来源：

* 用户手动收藏

排序：

* 手动排序
* fallback：最近访问时间

---

#### 2. 主要角色（/character）

定义：

* path 以 `character.*` 开头
* 排除 pinned

排序：

* sortOrder
* title

---

#### 3. 绑定角色（上下文角色）

按“绑定主体”分组：

```text
孤儿院
  院长
  孤儿A

O5
  成员A
```

来源优先级：

1. `ext.character.primaryContext`
2. refs（member_of / lives_in / works_at 等）
3. parent path
4. fallback → “其他角色”

---

### 3.3 节点信息

每个角色节点显示：

* avatar（小）
* title
* subtype（可选）
* 标签（可选）
* 状态标识：

  * draft
  * deprecated
  * pending refs
* 引用数量（可选）

---

### 3.4 底部折叠信息面板

显示当前选中角色：

```text
title
tags
currentState
关键关系（前3条）
更新时间
```

---

## 四、角色窗口（Character Window）

### 4.1 形态

* 自定义 window（非阻塞）
* 支持：

  * 打开 / 关闭
  * 多 tab
  * 状态保持
  * 未保存提示

---

### 4.2 Tab 结构

---

## Tab 1：概览（Overview）

### 内容

* avatar

* title

* aliases

* tags

* logline（一句话定义）

* summary

* personalityTraits

* motivation

* currentState

* characterArc

* 关系摘要（refs 简化展示）

---

## Tab 2：设定（Profile）

来源：`ext.character.profile`

### 字段分组

#### 基础信息

* gender
* age
* race
* faction
* occupation
* identity
* residence
* origin

---

#### 外貌

* appearance
* bodyFeatures
* clothingStyle
* voiceStyle
* mannerisms
* aura

---

#### 性格心理

* personalityTraits[]
* temperament
* likes[]
* dislikes[]
* fears[]
* weaknesses[]
* desires
* motivation
* values
* secrets

---

#### 能力资源

* abilities[]
* skills[]
* equipment[]
* resources[]
* limitations

---

## Tab 3：关系（Relations）

数据来源：`refs`

### 功能

#### 1. 出引用（我引用的）

* relation
* target
* note（可选）
* visibility（public / hidden）

#### 2. 入引用（谁引用我）

#### 3. pending 引用

* `pending.character[...]`
* 支持一键转正

---

### 操作

* 新增关系
* 编辑 relation
* 替换 target
* 删除关系
* 从搜索选择 target
* 拖拽添加

---

## Tab 4：剧情（Story）

### 字段

* firstAppearance
* roleInStory
* characterArc
* currentState
* keyEvents[]
* goalsShortTerm
* goalsLongTerm
* publicPersona
* trueSelf

---

## Tab 5：素材（Assets）

### 字段

* avatar
* thumbnail
* gallery[]
* visualKeywords[]
* designNotes

---

## Tab 6：Lorebook（注入）

映射 Core 字段：

* summary
* writingTip
* retrieval.keywords
* retrieval.tip

扩展：

* injectionSummary
* injectionPriority
* aliasTriggers

---

## Tab 7：高级（Advanced）

* name
* path
* parentId
* sortOrder
* subtype
* status
* governance

---

## 五、字段模型（前端）

### 5.1 Core 映射

```ts
type CharacterEntry = {
  id: number
  title: string
  name: string
  path: string

  aliases: string[]
  tags: string[]

  type: "character"
  subtype: string | null
  status: string

  summary: string
  content: string | null

  refs: Ref[]

  retrieval: {
    keywords: string[]
    tip?: string
  }

  writingTip?: string

  ext?: {
    character?: CharacterExt
  }
}
```

---

### 5.2 扩展字段

```ts
type CharacterExt = {
  profile: {
    gender?: string
    age?: number
    race?: string
    faction?: string
    occupation?: string
    identity?: string

    appearance?: string
    personalityTraits?: string[]

    motivation?: string
    fears?: string[]
    weaknesses?: string[]
    secrets?: string

    abilities?: string[]
  }

  story?: {
    characterArc?: string
    currentState?: string
    keyEvents?: string[]
  }

  meta?: {
    pinned?: boolean
    primaryContext?: string
  }
}
```

---

## 六、搜索（UX 设计）

### 6.1 技术方案

* 前端本地搜索（角色数量较少）
* 不依赖后端

---

### 6.2 搜索字段优先级

#### Level 1（必须）

* title
* aliases

---

#### Level 2（高价值）

* tags

---

#### Level 3

* logline
* summary

---

#### Level 4

* refs target（组织 / 地点）

---

#### Level 5

* ext.character 字段

---

#### Level 6（后期）

* typo 容错
* 拼音

---

### 6.3 排序权重（建议）

```text
title prefix: +100
alias prefix: +90
title contains: +80
alias contains: +70
pinned: +20
/character: +10
tags: +60
logline: +50
summary: +40
refs match: +35
ext fields: +25
recent: +15
```

---

### 6.4 搜索流程

```text
输入 → 过滤角色列表 → 计算 score → 排序 → 分组展示
```

---

## 七、最小可用版本（MVP）

### 必须实现

### UI

* 角色导航器（3分组）
* 角色窗口（至少 3 tab）

  * 概览
  * 设定
  * 关系

---

### 字段（核心）

* avatar
* title
* aliases
* tags
* logline
* summary
* personalityTraits
* motivation
* currentState
* characterArc
* keyEvents
* refs
* writingTip
* retrieval.keywords
* retrieval.tip

---

### 搜索（最小版本）

* title
* aliases
* tags
* pinned 权重
* /character 权重

---

## 八、后续扩展方向（v2+）

* 关系图（graph view）
* 角色时间线可视化
* 自动关系推导（从文本 @ref）
* Agent 自动补全角色卡
* 角色之间冲突检测
* 剧情一致性检查
