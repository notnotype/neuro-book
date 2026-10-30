---
schema: nbook.task/v2
taskId: t08-resources-home
status: planned
updated: 2026-10-28
---

# 资源地址与 home：会话、Profile、Agent 三层与文档

## 目标与范围

定 Agent 可见的资源地址：session、profile、agent 三层 home 与真实目录的映射，附件存放，docs:// 与插件贡献文档，以及 local:// 的歧义。

来源：需求 11、12；清单外第 9 项（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 三层 home 的方案名与真实目录；每层放项目里还是跨项目。
- `local://` 的歧义：资源 Spec 里是会话工作目录，提示词编辑器 Spec 里是附件短地址。
- 附件：按内容哈希存、能否共享、fork 会话时怎样处理。
- `docs://` 的内容（产品使用文档、SDK 作者文档、插件贡献的文档）与贡献点。
- 插件注册资源方案的接口（资源 Spec 里 planned）。
- 长期记忆落在哪一层；`artifact://` 与工具大结果的溢出（分支 t18）。

## 材料

- [`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)、[`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md)
- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 1 节（omp 的 URI）
- [调研](../../research/2026-10-28-repo-survey.md)第 5 节（旧应用的 profile home 与附件）

## 前置

t03、t05。

## 决定（开发者 2026-10-28，第三版设计稿定稿）

第一版把 Profile home 固定在项目里；第二版列了维度，开发者据此提出：Profile 不分项目、跨 Profile 的东西用 `project://` 与 `user://`、复数方案做目录、`tmp://` 统一一个 `nbook` 文件夹、去掉 `artifact://`、`docs://` 与 `skills://` 的根是虚拟目录而下面是真实目录。第三版按这些改。

### 规律

- 复数是目录：`projects://`、`sessions://`、`profiles://`、`skills://`、`docs://` 的根是虚拟目录，读它得到一段说明（这个目录是什么、怎么用）与下面的条目；根下的每个条目是真实目录，工具与 bash 都能用（harness 换成真实路径）。
- 单数是当前这一个：`project://` 等于 `projects://<主项目>/`，`session://` 等于 `sessions://<当前会话>/`，`profile://` 等于 `profiles://<当前 Profile>/`。自己的读写，别人的只读。
- 主项目：会话在哪个项目里建的；没有项目时 `project://` 不可用。
- 跨 Profile 的东西用 `project://`（随书）与 `user://`（跨书），不另设方案。

### 方案

| 方案与路径 | 真实位置 | 作用 | Agent | 算作品内容 | 没有项目时 |
|---|---|---|---|---|---|
| `projects://` | 虚拟：说明与项目列表 | 所有已登记的项目 | 只读 | — | 可用 |
| `projects://<短名>/<路径>` | `<该项目>/<路径>` | 别的书的文件（ADR 0024 的租约） | 读写 | 算 | 可用 |
| `project://<路径>` | 同 `projects://<主项目>/` | 当前书的作品文件（已实现） | 读写 | 算 | 不可用 |
| `sessions://` | 虚拟：说明与会话列表 | 所有会话 | 只读 | — | 可用 |
| `sessions://<会话 id>/…` | `<状态根>/agent/sessions/<会话 id>/home/…` | 别的会话的工作区 | 只读 | 不算 | 可用 |
| `session://<路径>` | 同 `sessions://<当前会话>/` | 本会话的工作区：计划、草稿、脚本；bash 的工作目录 | 读写 | 不算 | 可用 |
| `session://attachments/<名称>` | 同上 | 用户上传的附件；fork 时硬链接复制 | 只读 | 不算 | 可用 |
| `session://artifacts/<序号>-<工具名>.log` | 同上 | 工具大结果的全文（取代 `artifact://`） | 只读 | 不算 | 可用 |
| `profiles://` | 虚拟：说明与 Profile 目录（key、名称、来源、可不可用） | 所有 Profile | 只读 | — | 可用 |
| `profiles://<key>/…` | `<状态根>/agent/profiles/<key>/…` | 别的 Profile 的 home | 只读 | 不算 | 可用 |
| `profile://<路径>` | 同 `profiles://<当前 Profile>/` | 本 Profile 的笔记与记忆，跨书；按书的笔记由提示词约定放 `profile://books/<项目 id>/` 或写进 `project://` | 读写 | 不算 | 可用 |
| `tmp://<路径>` | `<系统临时目录>/nbook/sessions/<会话 id>/<路径>` | 一次性临时文件；会话关闭时清理，只清本状态根的会话；Linux 上 `nbook` 已被别的用户占用时用 `nbook-<用户 id>` | 读写 | 不算 | 可用 |
| `user://<路径>` | `<状态根>/user/<路径>`（已实现） | 用户的跨项目资产：`profiles/`（用户写的 Profile）、`skills/`（用户 Skill）、`AGENTS.md`（对所有 Agent 与所有书的说明） | 读；写要询问 | 不算 | 可用 |
| `docs://` | 虚拟：说明、共用文档与条目列表 | 文档目录 | 只读 | — | 可用 |
| `docs://builtin/…`、`docs://agent/…`、`docs://<插件 id>/…` | 应用包、Agent 插件、各插件包里声明的文档目录 | 产品与 SDK 文档、插件贡献的文档 | 只读 | 不算 | 可用 |
| `skills://` | 虚拟：说明与 Skill 目录（名称、说明、来源） | 所有可用的 Skill | 只读 | — | 可用 |
| `skills://<名>/…` | 该 Skill 的真实目录（内置、插件或 `user://skills/`） | Skill 的说明与脚本（t15） | 只读 | 不算 | 可用 |
| `history://…` | 虚拟 | 文件的旧版本（t13） | 只读 | 不算 | 不可用 |
| `mcp://<服务>/<资源>` | 虚拟 | MCP 资源（t19） | 按服务 | 不算 | 可用 |
| 插件方案（例如 `plot://`） | 由插件定 | 插件自己的数据 | 由插件定 | 由插件定 | 由插件定 |

与现行 Spec 不同：去掉 `local://`（会话工作目录改 `session://`，附件改 `session://attachments/`）；`user://` 的写入从“Profile 显式授权”改为“写入要询问”。bash 对虚拟的根目录不可用（`rg docs://` 报错并提示选子目录）；Agent 自己的搜索工具可以在根上展开到各条目。

状态根下的布局：

```text
<状态根>/
├── user/                          user://
│   ├── AGENTS.md
│   ├── profiles/<key>.profile.tsx
│   └── skills/<名>/
└── agent/
    ├── sessions/<会话 id>/
    │   ├── session.jsonl          会话日志，不在 home 里
    │   └── home/                  session://（含 attachments/、artifacts/）
    └── profiles/<key>/            profile://
```

### 用例子验证

| 例子 | 落到哪里 |
|---|---|
| 计划模式写计划 | `session://plan.md`（写全地址，2026-10-30 起 bash 的工作目录不再是 `session://`）；不算作品内容，只读模式下不弹审批 |
| 用户粘贴一张图 | `session://attachments/image-1.png` |
| 工具输出 300 KB | 截断后给模型，全文 `session://artifacts/3-read.log`，可以 `rg` |
| bash 跑 Python 统计字数 | 工作目录 `project://`（没有项目时 `session://`，2026-10-30 改），脚本与中间文件写全地址放 `tmp://` 或 `session://`，不落在书里 |
| 写手决定“悟空口头禅是‘俺老孙’” | 书的设定：`project://设定/人物.md` |
| 写手记“第 12 章写到第 3 节” | 写进 `project://` 的进度文件，或 `profile://books/<项目 id>/progress.md`（不随书走） |
| 用户对写手说“我不喜欢破折号” | `profile://preferences.md` |
| 用户说“所有 Agent 都用简体中文” | `user://AGENTS.md` |
| 没打开项目时聊天 | 只有 `project://` 不可用 |
| 在《A》里参考《B》的设定 | `projects://b/设定/人物.md` |
| 导演看写手的产物 | `sessions://<写手会话>/…` |
| Agent 写插件前查 SDK | 读 `docs://`（说明与目录），再 `rg docs://builtin/sdk` |
| Skill 带的脚本 | `skills://outline/scripts/count.py`，bash 执行时换成真实路径 |
| 读第 3 章三天前的版本 | `history://…`（t13） |
| 把书拷到另一台机器 | 只有作品文件跟着走 |

### 另定的两条

- 会话日志放在 `home/` 外，Agent 不能直接读写；读别的会话的对话记录在 t14 另给渲染的记录或专门的工具。
- Skill 格式遵守 Agent Skills 开放标准（`SKILL.md`），目录由 NeuroBook 自己管：来源只有内置、插件、`user://skills/`；默认不读 `~/.agents/skills`、项目里的 `.agents/skills`（写作用户的 Skill 目录不该混进写代码用的 Skill，同一 Profile 在不同机器上表现也会不同）。外部 Skill 可以复制或“导入”进 `user://skills/`；设置里另有“额外的 Skill 目录”，默认为空。书专属的 Skill 先不做（t15 再看）。

### 后续修改

- 2026-10-30（t14 讨论，开发者定）：`sessions://<会话 id>/` 改为映射整个会话目录 `<状态根>/agent/sessions/<会话 id>/`，会话日志就是 `sessions://<会话 id>/session.jsonl`（只读），别的会话的工作区在 `sessions://<会话 id>/home/`；`session://` 改为等于 `sessions://<当前会话>/home/`。上面“规律”与“方案”表里 `session://` 等于 `sessions://<当前会话>/` 的写法以这条为准。理由：Agent 要能直接读子会话的原始日志（[t14](../t14-multi-agent/README.md)、[t23](../t23-session-history/README.md)），这样不开特例、地址与真实目录一一对应，日志也不落在可写的工作区里。
- 2026-10-30（t14 讨论，开发者定）：bash（t12 的 `shell`）的工作目录改为：会话有主项目时 `project://`，没有时 `session://`。上面“方案”表与“用例子验证”里“bash 的工作目录 `session://`”以这条为准。理由：Agent 的工作大多是改这本书，相对路径直接对着书的文件；bash 是执行档、缺省弹审批（t06），写书仍要用户批准。不用 `user://`：那里是用户的 Profile、Skill 与 `AGENTS.md`，写入要询问。“用例子验证”里的两行已同步改。只读对 Agent 的文件工具生效，bash 能绕过（t12 已接受的第一版限制）。
- 2026-10-30（t14 审查后，开发者定）：任何会话都能读任何会话的 `sessions://<id>/`（日志与工作区），不做限制。

## 当前状态

讨论完成（2026-10-28）。计划与实施切片在本 Work 的讨论全部完成后另定。

## 下一步

实施时按 implementation-planning 写 `plan.md`；同时改 `workspace/resources.md`（去掉 `local://`、新增方案、`user://` 写入规则）与 `ui/prompt-editor.md`（附件地址）。
