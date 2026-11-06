---
schema: nbook.task/v2
taskId: t18-builtin-profiles
status: done
updated: 2026-11-05
---

# 内置 Profile、提示词规范与评测

## 目标与范围

定第一批内置 Profile 与 Skill、提示词写作规范与评测方法（含真实模型的预算与授权）。

来源：需求 19；清单外第 10 项（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 第一批：建议很少几个（一个主创，加一个生成会话标题的摘要）。
- 提示词写作规范：结构、版本、语言（ADR 0034）。
- 评测方法、真实模型的预算与授权（nb-story 的经验：推理档影响大、渠道不稳）。
- 旧应用的资产（14 个 Profile、17 个 Skill、53 个文风预设）怎样取舍。

## 材料

- [`story/qa.md`](../../../../../docs/specs/story/qa.md)；w00024 t05 的评测
- 旧应用 `packages/neuro-book-legacy/assets/workspace/.nbook/agent/`

## 前置

t05、t12、t15。

## 决定（开发者 2026-10-30）

调研：[旧应用的 Agent 资产、评测做法与临时代理](../../research/2026-10-30-builtin-profiles-survey.md)。

1. 第一批内置 Profile 三个：
   - **主创**：通用写作助手，在项目文件上工作，可以派子代理；保留旧应用“结果导向、不写冗长固定流程”的经验，提示词重写，不搬旧的约 2 万字版本。
   - **会话标题**：tiny 角色，只有收尾工具，第一轮结束后一起生成标题与一句说明（会话列表第二行与顶栏悬停要用，t17 第 3 条随之改）；每次压缩后更新说明（怎样取在实施时定）；用户改过标题后标题不再自动改，说明照常更新。
   - **adhoc（临时代理）**：父 Agent 用初始输入定义角色，任务经 `agent_spawn` 的 `prompt` 传入。工具由 Profile 定义：read、write、edit、grep、glob、shell，不带 todo 与子代理工具。不给 adhoc 指定工具，也不给 `agent_spawn` 加通用的 `tools` 参数。
2. 暂不搬：写手与 53 个文风预设（等设置表单）、研究员（等网页工具插件）、行内编辑（等 w00025 t12）、导演、世界引擎、跑团、模拟、记忆整理（等对应的领域模型）。nb-story 的问答 Profile 由它的插件贡献。
3. 第一版不带内置 Skill：9 个小说写作 Skill 列为候选，有评测后再挑；skill-creator 与 Profile 编写指南在支持用户写 Profile、Skill 时重写为 `docs://` 文档（旧的按 `defineAgentProfile` 写，形状已变）；llmlint 准备退役，不内置。
4. 提示词写作规范写进 `docs/standards/prompts.md`：中文（ADR 0034）；结构用 t20 的模板 helper、分节；写结果与约束，不写冗长的固定流程；不重复工具说明；例子短；改提示词升 Profile 版本；改动行为的提示词附评测结果（评测建起来之后）。
5. 评测优先级不高，以后有时间再做。第一版只做不调模型的结构测试（渲染提示词，断言该有的节与工具绑定）；真实模型 smoke 与质量评测、预算与授权到时再定，做法参照调研第 3 节（固定题集、多次重复、模型裁判看原文、整数门槛、按模型分开报、推理档写死）。
6. 结果 schema 由派发方给（开发者 2026-10-30，照 omp 的 `task` 的 `outputSchema`；替换原先“放在 adhoc 初始输入里”的推荐）：`agent_spawn` 加 `outputSchema?`，对任何 Profile 都能用。
   - Profile 自己声明了结果 schema 的不能覆盖，传了报 `schema-conflict`（Profile 的提示词可能引用自己的结果字段）。
   - 没声明的（自由结果），给了 `outputSchema` 就等同于 Profile 声明了强制结构化：内核按会话加 `yield` 工具（参数 schema 即给的这份，不经工具绑定）；调用 `yield` 结束这次运行，停下时没调用就催一次，仍没有就以最后一条回复作结果并标为 error（t14 的强制档）；结果带 schema 校验结果。
   - Profile 的提示词里没有交结果的说明，内核补一句固定提醒（“完成后调用 `yield` 交回结果”，相当于旧应用 adhoc 的“汇报纪律”）。
   - schema 在派发时记进子会话头，之后每次 `agent_send` 都按同一份，不能中途改；不合法时的失败码（`initial-invalid` 或另起 `schema-invalid`）实施时定。
   - adhoc 的初始输入只有 `{role?}`。t14 决定 20 与工具表随之改。
7. Workflow 多代理编排可能要自定义工具：开发者的初步方案是 Agent 能定义临时 Profile，记进 [t24](../t24-workflow-integration/README.md)，到 Workflow 的 Work 再讨论。

开工前核对现状后补充（开发者 2026-11-05，全部按推荐）：

8. adhoc 挪到 t14（改决定 1）：`agent_spawn` 没实现，现在没有入口能派发它，任务传入与 `outputSchema` 也都属于 t14。t18 只做主创和会话标题；主创的提示词先不提子代理，t14 加上时升版本。
9. `agent.profiles` 的声明加 `role?`，用户的 Profile 设置优先。tiny 没绑模型时不调模型，用用户第一句话的前若干字作标题，不写说明：角色合同已删掉回落，后台费用不悄悄算到主模型上。
10. 做一次一次性实验定 `edit` 的缺省模式（t12 留给 t18 的问题，不算决定 5 说的正式评测）：同一批编辑任务，hashline 与 replace 各 3 遍，模型 DeepSeek 与 gpt-6-luna，比成功率、输出 token 与误改。另做一次 DeepSeek smoke：主创改一个文件，再生成标题。
11. 主创经 `opening()` 读 `user://AGENTS.md` 与 `project://AGENTS.md`，有才放进上下文，压缩后重读。接受别人的书能带指令进来的代价，写入与 shell 仍要过审批。
12. 其余按默认：key 是 `nbook.agent.main`、`nbook.agent.session-title`；主创必需 `read`、`write`、`grep`、`glob`，可选 `edit`、`shell`，不带 `todo`；标题用内核的 `yield`；声明另加“不接收 `defaultForAll` 工具”“不进新建会话的菜单”；内核加 `description` 与自动写入路径，“用户改过就不再自动改”由内核判断；第一轮结束与带摘要的压缩后异步触发，后台会话与子会话不生成，失败写诊断，还没有说明时下一轮结束再试；每个主会话固定一个后台标题会话，费用不计入主会话。

13. 主创提示词这一版只是第一轮（开发者 2026-11-05）：开发者之后按实际创作需要和体验不断优化。所以结构测试只锁节与工具绑定，不锁措辞；每次改提示词升 Profile 版本。

14. `edit` 实验的结论：主创缺省用 replace（按事先定的规则，两个模型结论相同）。中文一段就是一行，hashline 要整段重写，输出 token 约是 replace 的三倍；DeepSeek 上成功次数也少 3 次。见 [evidences/edit-modes.txt](evidences/edit-modes.txt)。这改掉了 t12 的“缺省 hashline”。

开发者 2026-11-05 确认计划第一稿，含这次新定的五个细节：绑上 tiny 后生成的标题替换兜底标题；压缩后只更新说明、不改标题；`AGENTS.md` 单个文件上限 32 KiB，读不了写诊断；`sessions://` 目录不列任何后台会话；`edit` 缺省的判定规则。

## 当前状态

实现、审查与收口验证都做完了，已合入 master（`073690996`）。实现审查 3 条都修了：[evidences/impl-review-disposition.md](evidences/impl-review-disposition.md)；验证：[evidences/closing-verification.txt](evidences/closing-verification.txt)。Spec 已晋升（开发者 2026-11-05 批准），两条回写已写入，worktree 已清理。

实施中的发现与变化：

- **内核的旧隐患（`3a12017ed`）：** 有扩展响应收尾批里的事件（这次是 `turnEnded`）时，插件停止中模型服务已撤回，算环境抛错；`closeSession` 又因此跳过关日志与锁，会话在进程结束前都打不开。修了两处，写进 `harness/runtime.md` 输出 75。靠强制垃圾回收的循环跑才复现，全量里是偶发失败。
- **应用里还没有压缩方法（t11）：** 带摘要的压缩后更新说明、压缩后重读规则文件，今天在产品里走不到。测试用扩展拦截压缩交回结果，内核之后的路径是真的。
- **生成条件：** 比计划多判断“还没有标题”，否则第一轮的生成失败、压缩写了说明之后，标题就一直是空的。

## 下一步

无。主创提示词之后按实际创作继续改（决定 13）；压缩方法接上（t11）时，再看一遍压缩后更新说明与重读规则文件。
