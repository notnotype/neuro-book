## TODOS

**T0 Task**


- [ ] 跑通剧情系统
- [ ] 跑通 Lore 系统，提及，mention，@
- [ ] Writer Subagent
- [ ] plan mode
- [ ] create_task 前端
- [ ] <system-reminder>
- [ ] 引用系统
- [ ] content node 表单
- [ ] AI 填表
- [ ]
- [ ] request_user_input 超级自定义大表单。或者表单文件
- [ ]
- [ ]
- [ ]
- [ ]

**Tasks**

- [x] dialog 点击空白关闭逻辑
- [ ] 剧情 summary
- [x] 世界书
- [ ] 记忆
- [ ] 不要让同一个 Agent 一边续写，一边决定大纲，一边评估质量。它会非常不稳定。
- [ ] Planner → Writer → Critic → Writer Revision → Memory Update
- [x] lorebook 与 novel 解绑

- [x] textarea min height
- [x] 优化：外联与节点、治理与来源
- [x] use TipTap https://chatgpt.com/c/69c9ee18-9338-832c-8cb1-c44f1c9bb93d

- [ ] openapi cache
- [ ] report_result data
- [x] 思维链保存
- [ ] 滚动条占位
- [ ] invoke_subagent 前端 bug
- [ ] 自动刷新章节、lorebook 等
- [ ] TProfile 类型限制
- [ ] 文档模块
- [ ] 词频
- [ ] 写作历史 statics
- [ ] dialog window 已经关闭了才弹 dirty 确认
- [ ] scope 系统重构优化降低心智负担
- [x] $skill 直接加载 skill.md
- [ ] json patch benchmark https://arxiv.org/html/2510.04717v1?utm_source=chatgpt.com
- [ ] 现代汉语规范词典
- [ ] config.yaml 支持 ${env.OPENAI_BASE}
- [ ] plan mode
- [x] 抛弃数据库，全面迁移到文件
- [x] request_user_input 问题切换。延迟。answers 中存在重复的 toolNodeId
- [ ] prompt，介绍数据存储
- [x] $ 报错
- [ ] execute_shell 字符集问题
- [ ] 手写变量系统
- [ ] 手写上下文系统
- [ ] tool schema description
- [ ] 简化 story 工具，有重复的 schema 定义（20k token）
- [ ] request_user_input 合并?
- [ ] 先报告在写（plan mode）
- [ ] editor setting 数字 input 无法正常输入
- [ ] 允许用户编辑提示词模板
- [ ] 面板允许调整宽度
- [ ] agent chat flow 动画调快，或者开局直接到底
- [ ] token statics，cache 添加缓存命中百分比
- [ ] write_file 这些 tool 前端气泡展示参数，结果部分添加滚动条
- [ ] 虚拟文件系统？docker，k8s
- [ ] novel 绑定 workspace
- [ ] h1, h2, h3
- [ ] request_user_input 允许用户直接输入，不提供选项
- [ ] request_user_input UI 调整，允许收起
- [x] markdown 方言介绍
- [ ] structure textarea 更新
- [ ] content node schema 简化 + $ref 简化
- [ ] 思维链，system 滚动条
- [ ] Markdown 表头列数 = 分隔行列数(|--|--|) = 每一行数据列数 优化(https://github.com/MAbdanM/markdown-table-repair/blob/main/markdown_table_repair/repair.py)
- [ ] frontmatter pendding refs
- [ ] API 请求状态栏
- [ ]  <system-reminder>
       Plan mode is active. The user indicated that they do not want you to execute yet
       -- you MUST NOT make any edits (with the exception of the plan file mentioned below),
       run any non-readonly tools (including changing configs or making commits), or otherwise
       make any changes to the system.
       </system-reminder>
- [ ] reminder 机制
- [ ] task_create，task_create 等工具返回 ok
- [ ] 不要一次 run 后再更新 token statics
- [ ] dynamic skill 和 watched 提示词有问题
- [ ] 取消后报错：请求失败：request_user_input 之后不能继续生成正文或调用其他工具，请等待用户回答后再继续。
- [ ] `****`语法支持
- [ ] 编辑器 dirty 检测
- [ ] md 表格 overflow
- [ ] 加强 relation: defines_protagonist 约束
- [ ] workspace schema 脚本
- [ ] edit file diff 缺失
- [ ] workspace ls 给出内容节点的子目录 例如 scene-note
- [ ] `` 光标定位格式不对
- [ ] mermaid
- [ ] 什么样子的条目要注入？例如主角就不用注入
- [ ] `[]()`

- [ ] 当前任务状态太频繁，前端没做处理
- [ ] 模板大于一切啊
- [ ] DeepSeek 思维链调节
- [ ] Markdown 无需列表有问题
- [x] request_user_input 前端只展示了一个问题
- [x] 提示词设定：要中立，不要夸，媚 user，情绪不要
- [ ] epub 转 Markdown
- [ ] 4. 关于 frontmatter 中 refs 的填写原则补充：如果涉及到大内容节点与小内容节点之间的联系。例如：冥渊教团和虚哭之露。refs 会出现两次
- [x] faction 有 character 字段？
- [ ]
- [x] skill 外貌，主角着重设计
- [x] 世界模拟 skill 范围不对，应该是世界范围内
- [x] 世界观初始化应该包含历史
- [ ] tiptap 保存 dirty 状态与文件目录自动刷新
- [ ] 使用 CodeMirror 实现 Live Preview 模式
- [ ] profile 的输入输出的 schema 希望能在本文件定义
- [ ] 删除初始剧情种子，因为已经有灵感（故事概念）了
- [ ] 文件删除同时删除引用
- [ ] 每章字数限定
- [ ] bio 工具

- [ ] 剧情设计先用理性分析，再填充内容q
- [ ] 剧情设计给模拟世界，让用户决定
- [ ] 设计过程中可以引入新设定
- [ ] 多视角分析
- [ ] 素材很好，多提供一点，例如道具。AI描述环境。AI给出素材，用户拼装
- [ ] Markdown 有条目的用条目引用语法
- [ ] 剧情设计不负责细节,哪些细节？
- [ ] Prompt 自动压缩，去除缩进
- [ ] invoke writer subagent 调用要 validate 引用，plot 直接传引用
- [ ] subagent 前端显示。前端不能实时显示 subagent
- [ ] docker 部署脚本 oom 检测
- [ ] 迁移到 https://github.com/earendil-works/pi/tree/main/packages/ai
- [ ] epub 格式支持
- [ ] agent 创建工作区的tool
- [ ] subagent detach 工具
- [ ] workspace 前端 pinia 变量
- [ ] 小说概念
- [ ] invoke_workflow
- [ ] auid agent uuid
- [ ] todo 角色卡 schema
- [ ] 如果用户选中的目录，不是内容节点
- [ ] 有内容的时候不允许 /compact 出现
- [ ] compact 后读文件
- [ ] plan mode + PROJECT_STATUS
- [ ] editor-snapashot 还是卡
- [ ] steer/followup 前端
- [ ] session 不要按照 project workspace 分组
- [ ] 对白高亮,“” "" 「」有一个单独的样式
- [ ] 侧栏 agent 可以 float window
- [ ] diff 界面
- [ ] token statics 修复，同时记录小弟的 token 消耗
- [ ] neuro book deploy
- [ ] API retry
- [ ] 非阻塞 invoke
- [ ] mind.md 任务当前思维
- [ ] compact 大小
- [ ] rp session
- [ ] compaction 要有提示，也要能配置
- [ ] 整理一下模板
- [ ] gm 要引导式
- [ ] rp writer 文风
- [ ] rp writer 需要写文件工具。需要 lorebook 文件（由 leader 转述比较好）
- [ ] 新增 rp.director
- [ ] workflow
- [ ] invoke_agent 能传 title
- [ ] workspace new 有问题
- [ ] simulation 模板还得调
- [ ] 老大 想提点ui建议 剧本工作台里线程规划 目的能不能也显示在卡片里的摘要下面 现在要点开右侧编辑才能看到 还有现在Plot 列表默认只有第一个展开 其他要手点 想要默认都展开或者一键开合
      目的 摘要 和plot 双击直接修改保存比点小铅笔在右边保存更方便点
      还有agent的输入消息框多行消息时框太小了 能自动变高或者可拖拽就好了
- [ ] provider 配置ID输入一个字符就会闪烁一下
- [ ] 角色卡导入脚本需要持续加强自动分类能力
- [ ] profile 模板
- [ ] alternate_greetings 需要适配
- [ ] web_fetch 优化，反爬虫。https://www.zhihu.com/question/341189075
- [ ] events.jsonl 边写边想。渐进式记录
- [ ] 工具生成的时候刷新页面，无法正常恢复，也无法 abort
- [ ] 持续优化 rag inspector 界面
- [ ] plan mode 问题，退出的时候出问题
- [ ] 刷新后 session 无法看到执行中
- [ ]
- [ ] 设置页面优化
- [ ] novel 模式为主
- [ ] writer 调整
- [ ] plot 调整
- [ ] 世界模拟调整
- [ ] 提示词调整
- [ ]
- [ ] 日期系统
- [ ] workflow
- [ ]
- [ ] invoke_agent tool 能 continue
- [ ]
- [ ]
- [ ] 继续优化 novel 流程，融合几个 skill，优化杀 bug skill
- [ ] switch_mode approval 表单优化
- [ ]
- [ ] 接入 llmlint
- [ ] 请求查看器
- [ ] 先写后补设定
- [ ] summary + recap
- [ ]
- [ ] html 编辑展示优化：编辑器全屏，网页，整体全屏功能
- [ ] html 编辑器外部链接跳转策略
- [ ] html 展示卡片主题需要和当前主题同步，防止暗色主题，结果 html 展示卡片还是亮色的
- [ ] 官网 + 部署方式的优化
- [ ] 设置接口返回内容太大，可以优化 + gzip
- [ ] 设置 UI 优化用户体验
- [ ] 侧边栏 搜索和 git
- [ ] llmlint 复制指令标明行号
- [ ] pi-ai 更新，gpt-sol吃不到缓存
- [ ] profile 配置与全局配置优化
- [ ] $去选skill的时候只能拿鼠标滚轮往下拖，键盘往下不会滚动
- [ ]
- [ ]简单的说就是，我让ai写了一篇文章，但是发现里面有些地方用词有问题让它改。ai确定改完了之后我去看就会发现内容完全没变化。但是只要刷新页面内容的变化就会生效。这个情况在初期文件少的时候基本不会发生，但是到了后面各种设定文件什么的多了起来后出现这个问题的概率就会显著变高
- 都提问题我也来提个不知道算不算问题的问题，我调用api次数比较多，一分钟能来个十多次的时候，有时候不知道是api那边未响应还是什么原因就agent一直在处理，点暂停停不下来，只能等十多分钟模型报错或者关掉powershell重新启动
- managed Project中的绝对路径只能指向当前Project Workspace；跨Project请使用workspace/<project>/<relative-path>
- 正在连接后台任务管理器…
- （截断，完整结果用 get_job 查询）
- 用户引导
- bash 命令卡住，不超时。
- rxjs 图编程
- 可不可以开发一个文风仿写的功能，就是比如用一些书的片段作为参考，相当于skill一样，武打戏skill，修罗场skill，瑟瑟skill等等，不同特定戏份参考不同作品片段
- 一个去网络找资料、看视频学习的 AI
- memo 知识共享
- 多个世界引擎
- profile 设置界面调整
- leader 情绪价值设置
- session 的 fork 能力搞回来
- plan 放到 project 目录中
- diff 界面要优化
- composer 不能 enter 换行了
- .agent 协议
- job 持久化
- release 脚本优化
- 回到 logs 相关任务。
  目前的 logs 只有一个目录。





The following 2 project files changed since you last viewed them: - added: [world-engine/.runtime-artifact-import-cache/world-engine-calendar/c2f7b2530f52f26d.mjs](world-engine/.runtime-artifact-import-cache/world-engine-calendar/c2f7b2530f52f26d.mjs) — 1 change; by an external tool; added Location: new L1-L23 / old ∅ Diff size: 756 characters, 23 changed lines; above the inline limit of 512 characters / 16 lines. Use read for the complete current file instead of guessing unseen content. - added: [world-engine/schema/.runtime-artifact-import-cache/world-engine-schema/815fd59192ab8da8.mjs](world-engine/schema/.runtime-artifact-import-cache/world-engine-schema/815fd59192ab8da8.mjs) — 1 change; by an external tool; added Location: new L1-L106 / old ∅ Diff size: 9441 characters, 106 changed lines; above the inline limit of 512 characters / 16 lines. Use read for the complete current file instead of guessing unseen content. Non-sensitive files may no longer match versions you read earlier. Inline diffs show changed fragments only; use read only when the task needs complete current content from a non-sensitive path.

------

skills

- 热梗素材收集
- 评论分析
- 绘图
- 读者画像
- 同类作品

------

Planner 先产出卷纲/章纲
Critic 检查漏洞
Planner 修订
Writer 按单章计划写
Editor 做一致性和节奏审查
更新 story state / 伏笔表 / 角色状态


------

## 转生血族奴隶：创建理想乡

> 主角苏雪在读完《理想城》后直接转生到异世界。三岁的时候觉醒前世记忆。0-5岁一直生活在孤儿院。然后社会多么多么黑暗。然后孤儿院院长死了 + 国家被入侵。直接变为流浪儿。3个月后被侵略国奴隶商人抓起来。故事现在是6岁生日。

世界/大陆 -> 国 -> 城 -> 区域（皇宫、东市西市） -> 建筑 -> 房间
1. 神恩大陆
  - 王国 A（地点+势力）
  - 王国 B
      - B-a 城
        a. 孤儿院（地点）

------

- 否定式转折解释： 在描写中避免通过先否定再肯定来解释事物。禁止范围包括："不是X，是Y""不是X。是Y""没有X，只是Y""她没有X，她只是Y""没有X，而是Y""并非X，而是Y"等任何通过否定前半段来转折解释后半段的写法。两个短句通过句号分隔也视为广义的同种模式，一并规避。两种处理方式择一使用：去掉否定部分（X留空），或者去掉肯定部分（Y留空），让一半信息留空反而会让文字更有味道。前者适用范围更广，后者在需要弱化解释、强化留白的场合也可使用。例如"不是后退。是在为后退做准备"可改为简洁的肯定表达"为后退做准备"，或直接改为肯定"后退"
- 虚词优先，避免具体数量词： 能用虚词描述的过程，不使用具体的数量词（如"四分钟""五次心跳""两秒""三步"等）。模糊的指代（如"片刻""短暂沉默""几步之遥"）反而能给读者留下品味的空间。只有剧情特别需要精确数量的场合（如倒计时、关键证据的数字），才能使用具体数量

<rule_较低信息熵>
描写即使包含大纲设定，也尽量不指名道姓地提及该设定。
若某特征不影响当下，即使重要，也暂不提及。
不要使用"这是..."/"这像..."等解释性语句来说明角色行为的动机设定及其他相关内容
宁可让读者“不知道”，也不要使用*说明解释*的手法解释角色行为背后的设定。
宁可让读者“不知道”，也不要使用*说明解释*的手法解释角色行为背后的设定。
</rule_较低信息熵>

- 减少对话前后的声音和语气解释： 不要用"声音低沉平稳""用某某语气说""语调冰冷""尾音微颤""嗓音带着"这类标签来替读者解读台词的质感。通过灵动的动作、停顿、物件和环境互动在文字之间留出空间，让读者自己从对话内容和上下文感受角色的情绪。只在关键转折处——当声音的状态本身就是剧情信息点时——才做最低限度的解释

- 信任读者的推断力——描写与结论分离： 最高优先级的写作原则。不要为场景或角色的行为附加解释性的总结句（如"这意味着……""这是……的征兆""两件事之间没有逻辑联系"）。不要用"像……""仿佛……""似乎……"替读者做意象连接，让动作、物件和环境自己说话。呈现角色看到什么、听到什么、做了什么，但不要替角色总结他从中推断出了什么。如果描写足够精准，读者会自己到达正确的结论
