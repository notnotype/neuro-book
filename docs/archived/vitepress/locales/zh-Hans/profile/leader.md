# Leader

Leader profile 负责理解用户意图、选择流程、调用 Skill 和协调其他 agent。普通写作入口是 `leader.default`，用户资产维护入口是 `leader.assets`。

## leader.default

`leader.default` 是普通小说项目的主入口。它可以：

- 判断用户是在初始化项目、整理 lorebook、规划剧情、写章节、润色还是导入素材。
- 读取 SkillCatalog，并在需要时打开对应 `SKILL.md`。
- 调用 `retrieval` 为 writer 选择相关设定。
- 创建或复用 `writer` 写正式章节。
- **管理普通写作主链的 Thread / Scene / Chapter Plot。**
- **使用 `get_chapter_writer_brief` 为 writer 编译完整章节 brief，包含 Scene / World Context。**
- 推进 World Engine 动态世界状态与时间线。
- 调用 `researcher` 处理需要联网或最新资料的任务。
- 触发 Workflow 处理多阶段编排任务，见 [Workflow 与 Job](/agent/workflow)。

`leader.default` 不应该把所有事都自己做完。它的价值在于判断什么时候该交给专用 profile。

默认写作主链是：

```text
剧情设计 → 用户拍板 → 推进 World Engine → 更新剧情结构 → 调用 writer 写正文 → 写后回补
```

## simulator.leader（入口已下线）

::: warning
`simulator.leader` 是 RP / 世界模拟的调度者，**已从新建 Agent 菜单隐藏**，正在重新设计。历史会话与 profile 文件保留。RP Tick 协议仍记录在 [rp-tick reference](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/rp-tick/README.md)。
:::

## leader.assets

`leader.assets` 面向 user-assets 工作区，用于协助用户理解和维护 profile、Skill、profile 默认 home 资源、模板和覆盖层。

它不等同于普通小说 leader，也不应该直接承担章节写作。

## 继续阅读

- [Leader Default Operational Protocol](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/leader-default.md)
- [Novel Writing Workflow](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/novel-writing-workflow.md)
