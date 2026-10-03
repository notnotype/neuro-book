# 多 Agent 系统需求规格 v0.1

## 一、文档目的

本文档用于描述 neuro-book 中多 Agent 系统的业务需求与交互需求。

本文档只讨论：

- 用户能做什么
- 系统必须支持什么行为
- 各类线程、Agent、调用之间的业务关系
- 前端需要呈现什么体验
- 系统需要满足哪些业务约束

本文档不讨论：

- 数据库表设计
- 类设计与 OOP 建模
- API 结构
- Prompt 设计
- 具体技术实现方案

补充说明：

- 该文档用于记录多 Agent 系统的需求边界。
- 更接近实现侧的 Profile 写法参考 [profile-guide.md](profile-guide.md)。
- 前端状态与交互约定参考 [frontend.md](frontend.md)。

## 二、目标

多 Agent 系统的目标是让当前已有的 Agent Chat 从“单个助手直接完成所有任务”，演进为“leader 统筹、subagent 执行、用户可感知执行过程”的协作式创作系统。

系统需要支持以下核心能力：

- 用户主要与 leader 沟通
- leader 可以调用 tools
- leader 可以读取 skills
- workflow 先视为一种特殊 skill
- leader 可以创建和管理多个 subagent
- subagent 可以在执行过程中向用户提问
- 用户可以进入 subagent 的执行气泡，看到执行过程与结果
- 同一个 subagent 可以被多个 leader 共享和管理

## 三、术语

### 1. leader thread

leader thread 是用户与主 agent 对话的线程。

leader thread 的主要职责：

- 与用户交流
- 理解用户意图
- 调用 tools
- 读取 skill / workflow
- 管理上下文
- 创建、关联、调用 subagent
- 汇总 subagent 的执行结果并向用户反馈

### 2. subagent thread

subagent thread 是某个专业子 agent 的独立线程。

subagent thread 的特点：

- 有独立上下文与历史
- 可被 leader 调用执行具体任务
- 可被多个 leader 关联和管理
- 可在执行过程中向用户提问
- 其执行过程需要可视化展示

### 3. skill

skill 是 Agent 可读取和执行的预设能力单元。

当前阶段，workflow 视为一种特殊 skill 处理，不额外区分独立产品形态。

### 4. workflow

workflow 表示一类成体系的工作流程。

当前需求阶段中，workflow 作为 skill 的一种表现形式存在，例如：

- 完整写新书
- 续写
- 拆书
- 评审

### 5. walkthrough

walkthrough 是 subagent 一次执行结束后输出的执行说明或过程总结。

walkthrough 需要满足：

- 用户可见
- leader 可见
- 能说明 subagent 做了什么
- 能作为后续协作的参考

### 6. 执行气泡

执行气泡是前端中的可视化执行区域，用于展示某次 subagent 调用过程。

执行气泡中至少应展示：

- 当前 subagent 身份
- 执行状态
- tool 调用情况
- 提问状态
- walkthrough

## 四、线程模型需求

### 1. 系统必须支持两种线程

系统必须支持以下两种线程：

- leader thread
- subagent thread

用户需要能显式地区分当前线程类型。

### 2. 用户通常在 leader thread 中工作

默认情况下，用户主要在 leader thread 中与系统协作。

leader thread 是用户进入创作协作的主入口。

### 3. subagent thread 需要是独立线程

subagent 不能只是 leader 内部的一次临时调用记录。

subagent 必须拥有自己的独立线程，以承载：

- 独立消息历史
- 独立执行历史
- 独立上下文累积
- 独立 skill 使用过程

### 4. leader thread 与 subagent thread 是多对多关联

系统必须允许：

- 一个 leader thread 关联多个 subagent thread
- 一个 subagent thread 同时被多个 leader thread 关联

该关系必须是显式可管理的，而不是隐式推断。

### 5. subagent 关联必须支持手动管理

用户在 leader thread 2 中，需要能够手动关联一个已存在的 subagent thread。

示例场景：

1. 用户创建 leader thread 1
2. leader 1 创建 subagent 1
3. 用户创建 leader thread 2
4. 用户将 subagent 1 手动关联到 leader thread 2
5. 此后 leader 1 和 leader 2 都可以管理 subagent 1

### 6. 被共享的 subagent 需要保持同一身份

当 subagent 被多个 leader 关联时，系统必须将其视为同一个 subagent thread，而不是复制出多个副本。

也就是说：

- leader 1 管理的是 subagent 1
- leader 2 管理的仍然是同一个 subagent 1

补充说明：

- 当前设计草图中，leader 与 subagent 的多对多关系暂定通过显式关系对象表达
- 在 leader 视角下，仍然可以聚合为“当前 thread 已关联的 subagent 列表”
- 这样既保留业务关系本身，也方便 leader 直接管理 subagent

## 五、leader 能力需求

### 1. leader 必须能够执行 tools

leader 执行 tools 是一切能力的基础。

如果某项业务能力最终需要落地执行，则 leader 必须能够通过 tools 完成。

### 2. leader 必须能够读取 skills

leader 必须能够读取 skills 库中的预设能力说明。

该能力至少要支持：

- 查找可用 skill
- 读取 skill 内容
- 依据 skill 指导当前流程

### 3. leader 必须能够把 workflow 当作 skill 读取

为了降低复杂度，当前阶段 workflow 不作为独立产品形态处理。

系统必须允许 leader 将 workflow 直接按 skill 读取和执行。

### 4. leader 必须能够管理上下文

leader 必须能够在执行任务前对上下文进行管理。

该能力至少包括：

- 判断是否需要整理上下文
- 根据 skill 要求决定是否 compact 当前上下文
- 为 subagent 构造必要上下文

### 5. leader 必须能够创建 subagent

leader 需要能够通过 tools 创建新的 subagent thread。

创建后，新的 subagent thread 必须自动与当前 leader thread 建立关联。

### 6. leader 必须能够调用 subagent

leader 需要能够调用已关联的 subagent 执行任务。

当前阶段只做一种模式：

- leader 发起调用
- subagent 在独立线程中执行
- 用户可以看到 subagent 的执行过程

补充说明：

- 当前讨论中，subagent 调用已初步抽象为独立的“调用对象”
- 它与 subagent thread 本身不是同一个概念
- thread 表示长期存在的工作线程
- 调用表示某个 leader 在某个时刻发起的一次具体执行

### 7. leader 必须能够管理多个 subagent

leader 需要能够：

- 查看已关联 subagent 列表
- 调用其中任意一个 subagent
- 理解某次 subagent 调用的执行结果

## 六、subagent 调用需求

### 1. 当前阶段只支持一种调用模式

暂不实现“前后端无感的双模式切换”。

当前只支持一种明确模式：

- leader 构造上下文
- leader 调用 subagent
- subagent 执行
- 执行过程对用户可见

### 2. leader 侧的调用流程

从 leader 视角，一次 subagent 调用至少包含以下步骤：

1. 选择要调用的 subagent
2. 构造调用上下文
3. 将调用目标和要求传给 subagent
4. subagent 开始执行
5. subagent 完成执行或停止回复
6. subagent 输出 walkthrough
7. leader 读取结果并继续与用户协作

### 3. leader 在调用前必须能构造上下文

leader 在调用 subagent 前，需要能够传递结构化上下文。

典型上下文包括但不限于：

- lorebook 条目
- prompt / 具体要求
- 当前剧情点
- 当前章节目标
- 约束条件

补充说明：

- 当前设计草图中，subagent 的调用上下文会被视为结构化输入，而不是一段随意拼接的文本
- subagent 的角色模板也会声明其所要求的输入结构
- 例如 writer 这类 subagent，可以要求传入 lorebook 条目、剧情点、要求与约束

### 4. subagent 的结束条件

一次 subagent 执行至少应支持以下结束条件：

- subagent 主动报告 walkthrough
- subagent 停止回复

后续如需增加更多结束条件，可扩展，但当前规格至少要求支持这两种。

## 七、用户体验需求

### 1. 用户调用 subagent 后必须能感知到“进入执行阶段”

当 leader 调用 subagent 后，用户不能只看到一条静态文字结果。

系统必须让用户感知到：

- 当前 leader 已发起 subagent 调用
- 当前正在由哪个 subagent 执行
- 执行尚未结束

### 2. 用户必须能看到 subagent 执行气泡

leader 调用 subagent 后，界面必须进入或展示 subagent 执行气泡。

执行气泡至少需要体现：

- subagent 名称或身份
- 执行中 / 等待回答 / 已完成 / 已停止 等状态
- subagent 的工具执行情况

### 3. 用户必须能看到 subagent 的执行情况

subagent 执行过程不能完全隐藏。

用户至少需要能看到：

- 正在执行中
- 调用了哪些工具
- 当前是否在等待用户回答
- 最终 walkthrough

### 4. walkthrough 必须对用户和 leader 同时可见

subagent 完成后输出的 walkthrough 必须同时对以下对象可见：

- 用户
- 发起调用的 leader

当前阶段，walkthrough 至少需要在当前 leader thread 的用户可见范围内展示出来。

### 5. 用户应能理解 subagent 正在做什么

执行气泡不能只有底层日志。

系统必须保证用户能从界面上理解：

- subagent 当前在处理什么任务
- 执行到了什么阶段
- 最终产出了什么结果

## 八、提问需求

### 1. subagent 必须能够在执行过程中提问

subagent 在执行过程中，需要能够调用特殊工具向用户提问。

### 2. 用户必须能直接回答 subagent 的问题

当 subagent 提问后，用户必须能够在当前交互链路中回答问题，而不是被迫跳出当前流程重新描述上下文。

### 3. 提问必须成为执行流程的一部分

当 subagent 发起问题后，系统需要明确体现：

- 当前 subagent 正在等待回答
- 回答会继续推进当前执行

### 4. 后续可以扩展为让 leader 回答

后续版本可支持“subagent 问 leader，由 leader 回答”的机制。

但当前阶段只要求：

- subagent 能向用户提问
- 用户能回答

## 九、skill / workflow 需求

### 1. leader 必须先查 skill，再决定流程

当用户提出复杂任务时，leader 需要能够先查找是否存在合适 skill。

典型场景：

- 用户要求完整写新书
- leader 先查技能库中是否已有对应 workflow / skill
- leader 再决定下一步询问和执行流程

### 2. workflow 需要作为可读取 skill 被统一处理

当前阶段不要求用户理解 workflow 与 skill 的内部差异。

对业务侧来说：

- workflow 是一种特殊 skill
- leader 查找和读取方式应统一

补充说明：

- 当前阶段的设计草图暂不展开 skill / workflow 的正式对象模型
- 会先优先收敛 thread、profile、association、invocation 四个核心对象

### 3. skill 可以声明上下文要求

某些 skill 可以声明前置要求，例如：

- 执行前先 compact 当前上下文
- 执行前先读取某类信息
- 执行前先准备某类资源

系统必须支持此类业务需求。

## 十、示例业务流程需求

### 场景 1：完整写新书

用户输入：

- 帮我写《关于我转生成为银龙公主这回事》

系统至少需要支持以下业务流程：

1. 用户在 leader thread 中发起请求
2. leader 判断该需求属于复杂任务
3. leader 查找 skills / workflow
4. leader 询问缺失设定，例如篇幅、风格、章节数、受众等
5. leader 根据 skill 组织执行流程
6. leader 调用合适的 subagent 执行具体任务
7. subagent 的执行过程对用户可见
8. subagent 执行完成后输出 walkthrough
9. leader 根据执行结果继续与用户协作

### 场景 2：一个 leader 管理多个 subagent

系统需要支持以下行为：

1. 用户在 leader thread 中创建多个 subagent
2. leader 根据任务不同调用不同 subagent
3. 用户能够分辨当前是哪个 subagent 在执行
4. 每个 subagent 的执行过程与结果都可追踪

### 场景 3：多个 leader 共享一个 subagent

系统需要支持以下行为：

1. leader 1 创建 subagent 1
2. 用户在 leader 2 中手动关联 subagent 1
3. leader 1 和 leader 2 都可以调用 subagent 1
4. subagent 1 仍然保持同一个独立线程身份

## 十一、状态与反馈需求

### 1. 系统必须明确区分以下状态

至少需要区分：

- 空闲
- 执行中
- 等待用户回答
- 已完成
- 已停止

### 2. 用户必须能感知状态变化

当 subagent 从“执行中”变为“等待回答”或“已完成”时，界面必须有明确反馈。

### 3. 执行失败也必须可见

当 subagent 执行失败或异常停止时，系统必须让用户知道：

- 发生了失败
- 当前任务没有正常完成

## 十二、范围边界

### 当前阶段必须覆盖

- 两种线程类型
- leader 创建 subagent
- leader 关联已有 subagent
- leader 管理多个 subagent
- 一个 subagent 被多个 leader 共享
- leader 读取 skill / workflow
- leader 管理上下文
- leader 调用 subagent
- subagent 执行气泡
- subagent 向用户提问
- walkthrough 对用户和 leader 可见

### 当前阶段暂不要求

- 多种 subagent 调用模式并存
- subagent 向 leader 提问并由 leader 回答
- 具体数据库结构
- 具体 API 协议
- 具体 prompt 模板
- 具体类设计和实现细节

## 十三、待确认问题

以下问题尚未在本规格中定死，后续需要补充：

- 用户进入 subagent thread 后，是否允许直接与 subagent 长期对话
- subagent 被多个 leader 共享时，历史可见范围如何定义
- 多个 leader 是否允许同时并发调用同一个 subagent
- walkthrough 的历史可见范围如何定义
- subagent 提问后的回答记录应在多少个线程中可见

## 十四、当前讨论形成的草图结论

以下内容不是本规格的强约束结论，而是当前阶段已形成的设计草图方向：

- 系统中的线程先统一抽象为 `AgentThread`，通过 `kind` 区分 `leader` 与 `subagent`
- `subagent thread` 需要保持独立身份，不能退化为 leader 内部的一次临时记录
- `AgentProfile` 应理解为可执行角色模板，而不是普通 prompt 配置
- `AgentProfile` 后续至少会包含：
  - 高级预设模板
  - 调用参数契约
  - 行为规则
- subagent 调用需要与 subagent thread 本身分离，避免混淆“长期线程”和“一次调用”
- 一次 subagent 调用至少需要支持两种目标模式：
  - 创建新 subagent thread 后立即调用
  - 调用已有 subagent thread
