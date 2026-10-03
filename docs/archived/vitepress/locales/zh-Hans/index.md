---
layout: home

hero:
  name: "NeuroBook"
  text: "写长篇，也该有个 IDE 了"
  tagline: 每个人心里都有一部长篇，大多数死在半路——不是死于没天赋，是死于没有工程。设定、伏笔、正文和 AI 协作，放进同一个你能看见的工作区。
  actions:
    - theme: brand
      text: 下载并安装
      link: /quick-start
    - theme: alt
      text: 写出第一本书
      link: /tutorials/
    - theme: alt
      text: 了解 NeuroBook
      link: /introduction
    - theme: alt
      text: English
      link: /en/

features:
  - title: 🌍 写长了不吃书
    details: 上一卷断掉的手臂，这一卷不会自己长回来。World Engine 用时间线加切面记录世界状态，任意时刻的角色状态、势力关系、库存数字都能推算出来——不靠模型记忆，所以不会漂移。补设定就是在合适的时间点插一刀，倒叙和回忆天然支持。
  - title: 🧵 挖的坑不会忘了填
    details: 第 3 章埋的伏笔，第 200 章还没收？承诺账本把每个伏笔当作对读者的欠债来记账：埋下、推进、兑现全程可查，写到目标章会自动进入写作指令。感情线想每隔几章发一次糖也能记——它会提醒你已经三十章没发了。
  - title: 🗂️ 稿子是你自己的文件
    details: 设定在 lorebook/，正文在 manuscript/，全是本地 Markdown 文件加一个项目 SQLite。任何编辑器都能打开，整个目录拷走就能搬家。没有云端锁定，不需要导出功能——因为它本来就是文件。
  - title: ✍️ 一整个 AI 写作班子
    details: 不是一个聊天框包打天下。leader 管规划调度，writer 专职写正文，retrieval 查设定，researcher 查资料——数值不瞎编（引擎账上有），资料不乱猜（去查）。讨论模式只出主意不动稿，计划模式先给方案批准才执行。
  - title: 🧹 去掉 AI 味
    details: 像 eslint 检查代码一样检查稿件。llmlint 的 360 条规则覆盖填充词、机械过渡、公式化排比、空泛总结等典型 AI 痕迹；静态规则秒级扫全稿，机械问题能自动修。既是编辑器里的润色技能，也是独立 CLI。
  - title: 🧭 自带说明书的助手
    details: 不用担心软件复杂。内置助手读过整套使用文档，直接问它「开新书该先干嘛」「伏笔怎么登记」，它教你用，也能替你直接操作。上手门槛就是会打字。
  - title: 💻 装在自己电脑上
    details: Windows 解压即用，Linux / macOS 走容器或 Bun。数据库是本地 SQLite，模型 Provider 和 API Key 自己配，token 花销按输入 / 输出 / 缓存分项算成钱，写一章花了多少一目了然。
---

## 从哪里开始

**还没装？** 先读 [快速开始](/quick-start)——Windows 用户解压即用，五分钟能跑起来。要选部署方式或装到服务器，读 [部署方式](/deployment)。

**装好了？** 进 [从第一本书到前三章](/tutorials/)：创建项目、建世界书、初始化世界引擎、写出前三章。

**想先搞清楚它是什么？** 读 [介绍](/introduction)，或者直接看四个核心能力：[World Engine](/core/world-engine)、[Plot 剧情工坊](/core/plot-workbench)、[Markdown Studio](/core/markdown-studio)、[llmlint](/core/llmlint)。

## 文档分区

- [介绍](/introduction)：NeuroBook 是什么，适合谁，和普通 AI 聊天工具有什么区别。
- [快速开始](/quick-start)：下载、启动、配置模型，最短路径。
- [基础教程](/tutorials/)：从第一个项目到前三章，六节走完。
- [核心能力](/core/world-engine)：World Engine、剧情工坊、Markdown Studio、llmlint 四大能力详解。
- [使用指南](/guide/settings)：设置中心、主题配色、变更历史、账号与云备份。
- [Agent](/agent/)：Agent、session、profile、Skill、Workflow 与三种模式的心智模型。
- [Profile](/profile/)：内置 profile 分工与边界。
- [Profile TSX](/profile-tsx/)：写自己的 Agent profile。
- [部署与运维](/deployment)：安装方式、运行与停止、数据在哪、隐私边界。
- [更新日志](/changelog/)：历史版本改了什么、升级要注意什么。
- [设计文章](/blog-agent-rp-harness)：为什么要把写作拆成多个 Agent。

## 关于 AI 角色扮演

NeuroBook 早期版本包含 AI 角色扮演（RP）与世界模拟模块。**当前版本已把 RP 入口从常规界面下线**，正在按写作模式的标准重新设计，暂无时间表。相关 profile、数据结构和历史资料都保留在代码库中。

SillyTavern 角色卡导入功能**仍然可用**：`inspect → unpack → import` 三段式导入，原卡与 worldbook 完整归档，稳定设定进入世界书——但导入后的用途是**辅助小说写作**，不会自动开启 RP 会话。详见 [导入一张角色卡](/tutorials/05-import-character-card)。

## 更多入口

- [NeuroBook Reference Bookshelf](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/README.md)：面向实现者的稳定参考。
- [Agent Reference](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/README.md)：session、profile、tool、skill、workflow 的实现合同。
- [English README](https://github.com/notnotype/neuro-book/blob/master/README.en.md)：英文项目入口。
