---
schema: nbook.task/v2
taskId: t03-session-model
status: done
updated: 2026-11-07
---

# 会话模型：条目树、回退与分支、存放与单写者

## 目标与范围

定会话日志的数据模型（条目树与当前叶子），支撑回退、分支、fork、重试与 swipe；定会话存放位置与多窗口、多实例下的单写者。

来源：需求 17；清单外第 4 项（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 条目树：`id`、`parentId`、当前叶子；master 的 nb-session 只有序号，分支的格式已按树（v1 只用一条链）。
- 用户操作：回退、从此处分支、编辑重发、重试、swipe（同一父节点下的兄弟分支）、fork（新会话：复制还是引用历史）、`/clear`；nb-agent-ui 的分支与树面板从哪取数据。
- 会话快照与恢复按当前叶子走；与“前缀稳定、只追加”的关系。
- 存放位置：状态根下的插件数据，还是项目目录（旧应用是 `.nbook/agent/sessions/`）；会话属于项目还是跨项目。
- 单写者：多窗口、多实例打开同一会话（ADR 0024）；旧应用的会话租约 Spec（planned）。
- nb-story 已有的会话日志怎样兼容。

## 材料

- [调研](../../research/2026-10-28-repo-survey.md)第 1、5 节
- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 2 节（omp 的会话树与斜杠命令）
- 分支上的 `docs/specs/harness/session.md`
- [`archived/specs/agent/session-store-lease.md`](../../../../../docs/archived/specs/agent/session-store-lease.md)

## 前置

t02。

## 决定（开发者 2026-10-28）

1. 条目树与当前叶子：普通条目的父节点是写入时的当前叶子，写完叶子移到它；只移动叶子（回退、切换分支）时追加一条 `leaf` 条目（同旧应用）。回退与分支不删历史，每条路径只追加。标题、归档等会话级条目不是树节点、不移动叶子；模型与思考档位的切换属于路径（2026-10-28 t09 改判：模型与推理档是会话级设置，不跟路径走，见 [t09](../t09-models/README.md) 决定 5）。
2. 操作映射：重试与 swipe 是同一条用户消息下的助手兄弟节点；编辑重发是原消息父节点下的用户兄弟节点；从此处分支（omp 的 `/rewind`）把叶子移到该消息；切到兄弟节点时叶子落到那条分支最近写入的末端；fork 新建会话、只复制当前路径、会话头记来源（会话与条目 id），不引用；`/clear` 新建会话。树面板从完整日志算，harness 提供“路径”“兄弟节点”查询。`branch_summary` 先不做。
3. 回退只回对话；回退时是否撤回之后的文件改动在 t13 定，本 Task 保证 Agent 的每次写入能对上会话条目。
4. 会话存放在 `<状态根>` 下，作为 Agent 插件的数据，不放项目目录（ADR 0024：会话属于服务端、可跨项目；项目目录不加锁、可能被两个状态根打开）。会话记关联的项目身份，列表默认显示当前项目的会话、可看全部。开发者接受“会话不随书的文件夹走”，以后需要再做导出。
5. 单写者不另加租约：会话句柄只在服务端实例里，窗口是客户端，经远程服务读写与订阅同一个句柄；同一会话同时只有一次运行，重叠请求报忙（ADR 0033 保证一个状态根一个服务端）。旧应用的会话租约 Spec 不再需要。第二个窗口的插话规则在 t07 定。
6. 旧格式不在读取时转换：读取代码只认当前版本，遇到旧版本报“需要迁移”；另给一次性的版本迁移脚本（`migrate`，类似 Prisma 的 migrate）。nb-story 书库里 nb-session 线性旧格式的问答日志由这个脚本升级。参照旧应用的做法：存储有版本标记，读到旧版本抛 `AgentSessionMigrationRequiredError`，由 `scripts/db/migrate-agent-sessions-v2.ts` 显式迁移（计划、执行、回滚、日志），见 `packages/neuro-book-legacy/server/agent/session/migrations/`。迁移脚本放在哪个包、怎么调用，写计划时定。

## 当前状态

讨论完成（2026-10-28），实现由后续 Task 完成，2026-11-07 核对后关闭（开发者同意）。本 Task 不再单独实施。

- 决定 1、2、5：[`harness/session.md`](../../../../../docs/specs/harness/session.md) 与 t20 的内核（只移动叶子写 `leafChanged`）；回退、重试、编辑、分支切换、分支树、`/fork`、`/new` 由 t17、t28 接到界面（[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 25–27、30）。
- 决定 4：[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md) 输出 1。
- 决定 3 里文件回退的部分在 [t13](../t13-history/README.md)。

## 剩下的事

决定 6 的迁移脚本没写，内核只有 `needs-migration` 错误码；它要升级的是 nb-story 书库里的旧日志，转 [t31](../t31-nb-story-new-kernel/README.md)。
