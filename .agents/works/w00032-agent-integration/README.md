---
schema: nbook.work/v1
workId: w00032-agent-integration
issueId: null
status: active
updated: 2026-10-29
---

# NeuroBook 接入 Agent

## 目标

Agent 作为内置插件接入 NeuroBook：以 master 的 nb-harness 为底座，参考内核分支 feat/w00002-harness-kernel 逐块补能力；先按先后关系逐条讨论设计，定稿后再实施。

## 决定

| 日期 | 决定 |
|---|---|
| 2026-10-28 | 开发者：以 master 的 nb-harness（nb-story 在用的那套）为底座，参考内核分支 `feat/w00002-harness-kernel`，分支做得多的地方逐块移过来 |
| 2026-10-28 | 开发者：插件给所有 Profile 加工具时，一起考虑工具发现（t04） |
| 2026-10-28 | 开发者：先建 Task 草稿，按先后关系逐个讨论设计 |
| 2026-10-28 | t02 定稿：合同以 master 为准、代码以分支为主体；一个包子路径导出；分工按“离开 NeuroBook 还能不能用”；升最新 OMP；分支 Spec 随代码搬来（[t02](tasks/t02-harness-baseline/README.md)） |
| 2026-10-28 | t03 定稿：条目树加当前叶子；会话放状态根、不随书走；不加租约；旧格式不在读取时转换，另给一次性迁移脚本（[t03](tasks/t03-session-model/README.md)） |
| 2026-10-28 | t04 定稿：id 即内部名字，交给服务商时 `.` 换 `__`；Profile 只声明、工具绑定存用户配置；工具发现搁置；会话中 Profile 变化按轻重分（[t04](tasks/t04-tool-registry/README.md)） |
| 2026-10-28 | t05 定稿：Profile 只提要求（工具、模型能力、压缩种子与摘要要求），实际配置放 Profile 设置；不碰审批；内置、插件、用户级三层；重载用打包加哈希；钩子拆到 t20（[t05](tasks/t05-profile/README.md)） |
| 2026-10-28 | t06 定稿：审批照搬分支、默认放行写入；只读模式弹审批且优先于审批模式；内置 `ask`；分支 t20 三条追认；不做“改了再批”（[t06](tasks/t06-approval/README.md)） |
| 2026-10-28 | t07 定稿：插话与排队照搬分支；中止补强制接管；排队进日志；等审批时打字即拒绝并附言；运行中不能改树；中断后不自动续跑（[t07](tasks/t07-run-control/README.md)） |
| 2026-10-28 | t08 定稿：复数方案是目录（根虚拟、条目真实），单数是当前这一个；`session://`、`profile://`（只在状态根）、`tmp://`、`docs://`、`skills://`；去掉 `local://`、`artifact://`；Skill 由 NeuroBook 自己管（[t08](tasks/t08-resources-home/README.md)） |
| 2026-10-28 | t09 定稿：模型服务单独插件；密钥统一进 OMP 凭据库；角色照合同；模型与推理档是会话级设置、不随回退切回（改 t03 决定 1）（[t09](tasks/t09-models/README.md)） |
| 2026-10-28 | t10 定稿（方向）：三个入口；九个贡献点，斜杠命令单独一个贡献点、不复用 `nbook.commands`；运行经远程服务推送；导出 `agent.startTask`（[t10](tasks/t10-agent-plugin/README.md)） |
| 2026-10-28 | t11 定稿：阈值照 omp 三层；就地、摘要模型、shake 三种方法，阈值与溢出各一个缺省顺序；“压缩”专精角色；压缩后放回最近文件等走公共流程（[t11](tasks/t11-compaction/README.md)） |
| 2026-10-28 | 提示词语言照 ADR 0034（领域与新写的基础设施提示词用中文）；长期目标是 i18n、现在用中文是为了方便（补进 `common.md`）；w00031 t05 评测继续搁置 |
| 2026-10-28 | t12 定稿：第一批工具 read、write、edit、grep、glob、shell、todo；shell 的洞第一版不补；网页工具另做插件；外部命令行发布时做；eval 开 t21、后台工作开 t22，都搁置（[t12](tasks/t12-builtin-tools/README.md)） |
| 2026-10-28 | t13 方向已讨论、优先级不高，排到末尾：归属 `nbook.history`；插件写入也记来源；收件箱不挡流程、参考旧组件迁移；会话回退与文件回退分开（[t13](tasks/t13-history/README.md)） |
| 2026-10-28 | t20：harness 以事件模型为骨架（日志 → 折叠 → 状态 → 视图 → 请求 → 副作用 → 日志），写成提案 [agent-harness-event-model](../../../docs/proposals/agent-harness-event-model.md) 待讨论 |
| 2026-10-29 | 提案第二稿：`reduce` 只看自己那一片、反应看同一份快照、扩展状态默认私有经选择器共享、`prompt` 能读状态、视图加 `attach`、预览也跑拦截链；循环由内核自己写，不再套 OMP 的 `Agent`（改 t02 决定 1）（[t20](tasks/t20-hooks/README.md)） |
| 2026-10-29 | t20：开发者同意历史是投影、模板四节点、内核与内置扩展的分工；按开发者要求做了 spike 并做两轮深入审查（omp 与 Opus），提案改成第三稿、介绍页发布 v3；第三稿改变已定写法的六处待开发者确认（[t20](tasks/t20-hooks/README.md)） |
| 2026-10-29 | t20：开发者提出“异步状态机”（输入缓冲区、一轮结束才提交进 `Message[]`），提案改成第四稿；同意去掉 `prelude`；按开发者要求派三个 Sonnet、一个 Fable、一个 omp 做接口设计兼架构审查，汇总成第五稿与 `spike/v5/`，待开发者看（[t20](tasks/t20-hooks/README.md)） |
| 2026-10-29 | t20 讨论结束：开发者认可提案第五稿；便利写法做成 helper（`reminder()`、`opening()`、`standardLayout()` 等）；t20 改了内核，实施时排在最前，实现要再审查一次；t05 的上下文机制按提案改写（[t20](tasks/t20-hooks/README.md)） |

## 调研

- [仓库内的现状](research/2026-10-28-repo-survey.md)：harness 两条线、新应用现状、文档冲突、其它 Work 里相关的未完成事项、旧应用的 Agent 功能面、nb-story 问答的预演。
- [外部参照](../../../docs/research/agent-runtime-references.md)：omp 与 DeepSeek Harness 的机制、模型接口与 OMP 包族的工具发现。
- [各家 code agent 的子代理设计](research/2026-10-30-subagent-survey.md)（t14）：工具形状、结果、续用与插话、审批与提问、运行控制、父子关系。
- [需求对照与遗漏](tasks/t01-survey/artifacts/report/index.html)（t01 的 `report` 产物）：开发者列的 20 条需求与清单外 10 项。

## 讨论顺序

| Task | 讨论什么 | 前置 |
|---|---|---|
| [t02](tasks/t02-harness-baseline/README.md) | harness 底座：两条线对照与移植清单 | — |
| [t03](tasks/t03-session-model/README.md) | 会话模型：条目树、回退与分支、存放与单写者 | t02 |
| [t04](tasks/t04-tool-registry/README.md) | 工具登记、命名与工具发现 | t02 |
| [t05](tasks/t05-profile/README.md) | Profile：定义、存放层次、钩子与设置 | t02、t04 |
| [t06](tasks/t06-approval/README.md) | 审批、提问与 Agent 模式 | t03、t04 |
| [t07](tasks/t07-run-control/README.md) | 运行控制：插话、排队与中止 | t03、t06 |
| [t20](tasks/t20-hooks/README.md) | 钩子：钩子点、读写能力、顺序与按 Profile 开关（从 t05 拆出） | t05、t06、t07 |
| [t08](tasks/t08-resources-home/README.md) | 资源地址与 home：会话、Profile、Agent 三层与文档 | t03、t05 |
| [t09](tasks/t09-models/README.md) | 模型服务与模型角色 | t02 |
| [t10](tasks/t10-agent-plugin/README.md) | Agent 插件骨架与贡献点 | t02 到 t09 |
| [t11](tasks/t11-compaction/README.md) | 上下文压缩 | t03、t09 |
| [t12](tasks/t12-builtin-tools/README.md) | 基础工具与外部命令行依赖 | t04、t06、t08 |
| [t14](tasks/t14-multi-agent/README.md) | 多 Agent 与 Workflow | t05、t06、t07 |
| [t15](tasks/t15-skills/README.md) | Skill 规范与目录 | t05、t08、t10 |
| [t16](tasks/t16-command-bridge/README.md) | Agent 操控 NeuroBook 与 `nbook project` 子命令 | t06、t10 |
| [t17](tasks/t17-conversation-ui/README.md) | 对话界面：Composer、状态栏、待处理区（并入 w00019 t11） | t06、t07、t09、t10；w00028 t03 合入 |
| [t18](tasks/t18-builtin-profiles/README.md) | 内置 Profile、提示词规范与评测 | t05、t12、t15 |
| [t19](tasks/t19-mcp/README.md) | MCP 插件 | t04、t08、t10 |
| [t21](tasks/t21-eval-codeact/README.md) | eval 工具（CodeAct），搁置 | t04、t12 |
| [t22](tasks/t22-background-work/README.md) | 后台任务与协作：shell 后台、Agent 后台调用、Monitor、活动面板，搁置 | t07、t12、t14 |
| [t13](tasks/t13-history/README.md) | nb-history 接入与文件变更感知（优先级不高，排到末尾） | t08、t12 |

讨论顺序就是依赖顺序；讨论定的事写进各 Task 的 README，实施的切片与分支在讨论完后另定。

实施时 t20 排在最前（开发者 2026-10-29 定）：它定了 harness 内核（日志与写入批、输入缓冲区与指令、对话形状与提交、扩展接口、拦截链），t03、t05、t06、t07、t09、t10、t11 的实现都建在它上面。t20 的实现要再做一次审查。

## 相关 Work

- [w00002](../w00002-neuro-agent-harness-redesign/README.md)：nb-harness 的来历；内核分支的记录只在分支上（主工作区那份 README 停在 2026-09-22）。
- [w00019 t11](../w00019-agent-conversation-view/tasks/t11-complete-view/README.md)：对话视图完整版，并入 t17。
- [w00025 t12](../w00025-editor/tasks/t12-inline-ai-editor-api/README.md)：行内 AI 编辑器接口，在本 Work 要在编辑器里改正文时开工。
- [w00028 t03](../w00028-i18n/tasks/t03-shared-packages-migration/README.md)：共享包的文字迁移，合入后再写 Agent 插件的界面。
- [w00031 t03](../w00031-language-policy/tasks/t03-failure-projection/README.md)：错误码与参数，工具错误的形状按它来。
- [w00024](../w00024-nb-story/README.md)：nb-story 问答是 nb-harness 现在唯一的使用方。

## 后续（本 Work 不做）

- 网页工具插件（`web_fetch`、`web_search`）与网页搜索：另开 Work（t12，2026-10-28）。
- 外部命令行的检测、下载与“外部工具”设置页：发布时做，策略记在 [t12](tasks/t12-builtin-tools/README.md)（2026-10-28）。
- shell 的安全加固（密钥正则、路径条件、环境变量白名单）：以后专门做安全时考虑（t12，2026-10-28）。
