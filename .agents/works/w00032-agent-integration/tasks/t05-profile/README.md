---
schema: nbook.task/v2
taskId: t05-profile
status: planned
updated: 2026-10-28
---

# Profile：定义、存放层次、钩子与设置

## 目标与范围

定 Profile 的定义形状、存放层次（内置、用户、项目）、钩子、设置表单与上下文槽，以及用户能否自己写 Profile。

来源：需求 6、7（钩子部分）（[报告](../t01-survey/artifacts/report/index.html)第 6、7 条）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- `defineProfile` 的形状：master 的四个字段，分支的一等属性（tools、model、compaction、approval）、可注册的节点与数据源与字段、`<Slot>`。
- 存放层次与覆盖：内置、用户级、项目级；加载、文件改动后重载；用户自己写或从模板新建（加载即执行代码）。
- 钩子：每次模型请求前、工具调用前后、一轮结束；Profile 自己的钩子与插件的全局钩子；顺序、合并与失败处理。
- 旧应用的字段要不要：设置表单（人设、文风预设）、每轮结构化输入、结构化结果、`skills.include`。
- Profile 改版后旧会话能不能续（nb-story 从 v3 到 v4 的经验）。

## 材料

- [调研](../../research/2026-10-28-repo-survey.md)第 5 节 Profile
- `packages/nb-profile`；分支上的 `docs/specs/harness/profile.md`
- 旧应用 `packages/neuro-book-legacy/assets/reference/agent/profile-guide.md`

## 前置

t02、t04。

## 决定（开发者 2026-10-28）

第一轮：

- Profile 不指定模型角色。
- `skills.include` 不要：Skill 目录怎样进提示词在 t15 定。
- 设置表单（`settingsSchema` 交 nb-form 画、值存进 Profile 设置）有用，第一轮不做。
- 存放三层：Agent 插件内置、其它插件贡献（经插件共享，借插件依赖保证工具已装）、用户级；不做项目级，不做同名覆盖。key 带来源前缀（`builtin.writer`、`story.qa`、`user.my-writer`）；改内置的就复制到用户级换新 key，“从模板新建”即复制。
- 用户可以写 TSX Profile（与插件同样受信任）；用户级 Profile 的必需工具不在时，列表里标“不可用”并写明缺哪个。
- 保留文件改动后重载（内存增长在计划时处理）。
- Profile 改版按 t04 的方案 D 处理：版本变也算“Profile 变了”，提示词用新的，初始输入按新 schema 重新校验，不过就只读；nb-story“按版本一律拒绝”的规则随迁移去掉。
- `defineProfile` 以分支实现为主体：manifest、initialSchema、tools（只声明）、context，可注册的节点、数据源与字段。
- 结构化结果用 master 的收尾工具，不另设字段；每轮结构化输入不做；文件变化感知在 t13。

第二轮（2026-10-28）：

- Profile 可以声明需要的模型能力（例如工具调用、看图），不指定角色；选了不满足的模型时提示用户。
- Profile 完全不碰审批：审批模式放进 Profile 设置（用户按 Profile 设默认值，会话里可切换），细节在 t06。要限制某个 Profile 用工具绑定。
- shake 这类原地裁剪的压缩：开发者认为和普通压缩一样，追加一条压缩条目、内容是裁剪后的 `Message[]` 即可（转 t11）。
- 钩子拆成单独的 [t20](../t20-hooks/README.md)，这里只做了初步讨论，方向记在 t20。

第三轮（2026-10-28）：

- 文件改动后重载选“打包加哈希命名”：用 `Bun.build` 把 Profile 连同它导入的本地文件打成一个包，按内容哈希命名后导入，并删掉上一个包的模块缓存条目；记下包里有哪些源文件，只监听这些文件。这样 Profile 导入的文件改了也生效。实测（[`evidences/module-reload-gc.txt`](evidences/module-reload-gc.txt)）：删掉缓存条目、没有别处引用后，导出对象会被 GC 回收；每次加载仍留下约模块大小的内存（几十 KB 的模块约一倍），可以接受。不变量：缓存条目要删，会话不能长期持有旧 Profile 对象（方案 D 下次请求即换新）。
- 压缩里 Profile 只管两样，其余归压缩逻辑与 Profile 设置：
  - 压缩后的种子：与压缩方法无关，由压缩的公共流程处理。方法的输入不含种子、产出也不含种子；每次压缩后重新渲染种子（跳过 `once`）与压缩条目一起追加，回放时排在压缩内容之前（分支 `harness.session` 输出 12.1 已是这样）。soft、handoff、shake、snapcompact、remote 都一样。
  - 给摘要的额外要求：只有让模型写文字的方法用（soft、handoff；remote 要看服务商的原生压缩收不收要求，未核实）；shake、snapcompact 不调模型，不用它。要求随压缩上下文交给每个方法，用不上的忽略。
  - 具体怎么压缩（例如 soft 的摘要提示词）归压缩方法；方法顺序、触发阈值、保留多少近期历史、写摘要的模型放 Profile 设置或全局默认，由用户调。

t20 定稿后的改写（2026-10-29，开发者认可 [Agent harness 的事件模型](../../../../../docs/proposals/agent-harness-event-model.md) 第五稿）：Profile 的上下文机制以提案为准，上面两条由它取代：

- 第一轮“`defineProfile` 以分支实现为主体：manifest、initialSchema、tools、context，可注册的节点、数据源与字段”：改为 Profile 自己就是最里层的扩展，写扩展的字段（`state`、`on`、`mount`、`contribute`、`intercept` 等）加 Profile 级的 `name`、`description`、`initial`、`payload`、`modelNeeds`、`tools`、`system`、`prompt`、`turn`、`commit`、`render`、`compaction`；不再有可注册的节点与数据源，种子、`Appending`、`Reminder`、`ModelContext` 的去处见提案第 13 节。运行时这一层按语义参照分支（提案“影响”一节）。
- 第三轮“压缩后的种子：每次压缩后重新渲染种子、与压缩条目一起追加、回放时排在压缩内容之前”：改为开场由 `opening()` 在会话创建与每次压缩之后读一次，交给历史前面的稳定槽 `opening`；摘要排在已提交的轮前面（提案第 10 节）。“给摘要的额外要求”不变，经 Profile 的 `compaction.require`。

## 当前状态

讨论完成（2026-10-28）；上下文机制按 t20 定稿改写（2026-10-29）。计划与实施切片在本 Work 的讨论全部完成后另定。

## 下一步

实施时按 implementation-planning 写 `plan.md`，以上面的决定为准。
