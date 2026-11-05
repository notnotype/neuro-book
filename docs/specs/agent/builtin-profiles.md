---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: agent.builtin-profiles
owners:
  - nbook.agent
---

# Agent 的内置 Profile

## 目标与非目标

`nbook.agent` 交出第一批内置 Profile：主创（通用写作助手）与会话标题（后台给会话生成标题和一句说明）。前台会话因此有可读的标题，用户写在 `AGENTS.md` 里的说明能进上下文。

不承诺：

- 内置 Skill、写手与文风预设、研究员、行内编辑；
- adhoc 与子代理（由多 Agent 的 Spec 定义）；主创此时不提子代理；
- 提示词质量评测：这里只保证结构（有哪些节、绑哪些工具），不保证模型写得好；
- 界面：会话列表和顶栏怎样显示标题、说明，新建会话的菜单，由对话界面的 Spec 定义。

## 术语与参与者

- **主创**：key `nbook.agent.main`，用户新建会话时默认用的 Profile。
- **会话标题 Profile**：key `nbook.agent.session-title`，只有内核生成的 `yield` 工具。
- **前台会话**：会话头没有 `background`、也没有 `caller` 的会话。只有前台会话生成标题和说明。
- **说明**：会话的一句话摘要（`description`），与标题一起进快照和会话列表。
- **标题会话**：给某个前台会话生成标题和说明的后台会话，每个前台会话至多一个。
- **一轮结束**：`turnEnded{reason: "completed"}`。压缩运行没有轮，所以不算。

## 输入与前置条件

Profile 声明（[`contributions.md`](contributions.md) 的 `agent.profiles`）：

| key | 名字 | `tools.required` | `tools.optional` | 其它 |
|---|---|---|---|---|
| `nbook.agent.main` | 写作助手 | `read`、`write`、`grep`、`glob` | `edit-replace`、`shell`、`ask-form`（planned） | `icon`（planned） |
| `nbook.agent.session-title` | 会话标题 | 无 | 无 | `role: "tiny"`、`hidden: true`、`defaultTools: false` |

会话标题 Profile 的结果 schema：`{title: string（1 到 40 个字符）, description: string（1 到 120 个字符）}`，必须交回。

规则文件：`user://AGENTS.md` 与 `project://AGENTS.md`，都可以不存在。

## 输出与可观察行为

### 主创

1. 主创的提示词是中文，分节写：身份与工作范围、工作方式、写作约束、资源地址。升提示词时升 Profile 版本（[提示词规范](../../standards/prompts.md)）。
2. 主创绑 replace 那条 `edit`（`nbook.agent.edit-replace`）；用户可以用工具绑定换成 hashline 那条（这两个都是可选工具，`shell` 也能去掉）。`read`、`write`、`grep`、`glob` 是必需工具，缺了按 [`contributions.md`](contributions.md) 的不可用处理。
3. 主创的提示词不提没有绑定的工具：`shell` 的说明只在生效工具集里有它时渲染。
4. 规则文件存在时进开场，用户的在前、书的在后，各自标明来源；不存在时开场里没有对应的部分，不写诊断；书不可用（没有打开书）与文件不存在同样处理。单个文件的 UTF-8 编码超过 32 KiB 时，只放前 32 KiB（不切开一个字符），并标明已截断、全文的地址。其它读取失败写诊断 `rules-unreadable`，这个文件不进开场，运行照常。
5. 规则文件在会话创建时与每次压缩之后各读一次；两次之间改了文件，到下一次压缩才生效。`fork` 出的会话沿用复制来的内容；用 `changeProfile` 换成主创的会话，到下一次压缩才读到规则文件。

### 标题和说明

6. 前台会话一轮结束、且这个会话还没有说明或还没有标题时，服务端异步生成标题和说明。不挡这个会话：下一条输入可以立刻发出。
7. 生成的材料是这个会话当前路径上第一条用户的话和第一条有文字的回复，各取前 2000 个字符；第一条用户的话没有文字时不生成。
8. 前台会话发生一次带摘要的压缩（`compaction.replacement` 不为 null）后，服务端用摘要的前 4000 个字符和当前标题重新生成，只更新说明。不带摘要的压缩不更新。
9. 生成跑在标题会话里，每次发一条新输入，上下文只有系统提示词和这条输入，不带上一次。标题会话不进 `list` 的缺省结果、`running()`、`sessions://` 的目录，按 id 仍然读得到；它的费用不计入前台会话的累计和费用上限。
10. 用户改过标题（最近一次 `titleChanged` 是 `by: "user"`）后，自动生成不再改标题，说明照常更新。生成进行中用户改名，用户的名字保留。
11. 会话标题 Profile 解析不到可用模型时不发请求：会话还没有标题就用第一条用户的话作标题（空白折叠成一个空格，取前 30 个字符），不写说明。之后每一轮结束再判断一次：一旦解析得到模型就正常生成，自动标题被生成的标题替换。
12. 生成失败（模型失败、运行没有以 `yield` 收尾）写诊断 `session-meta-failed`，不改标题和说明。第一轮的生成在下一轮结束时再试；压缩后的更新等下一次压缩，压缩失败不会变成生成标题。同一个前台会话同时只生成一次，后到的触发排在后面，轮到时按当时的状态重新判断。
13. 标题和说明都由服务端写，模型的输出只进这两个字段。对话内容在给模型的输入里标明是材料、不是指令。

## 状态与转换

| 前台会话的状态 | 一轮结束时 | 压缩（带摘要）后 |
|---|---|---|
| 没有说明或没有标题，模型可用 | 生成标题和说明 | 只生成说明 |
| 没有说明或没有标题，模型不可用 | 没有标题时写兜底标题 | 不做 |
| 标题和说明都有，模型可用 | 不做 | 只生成说明 |
| 标题和说明都有，模型不可用 | 不做 | 不做 |

时序与寿命：

- 生成在一轮结束之后开始，不等这次运行结束，用户此时已经能发下一条或排队；生成的写入按它落到日志的先后排在后续事件之间。
- 插件停止时，进行中的生成随标题会话以 `interrupted` 收口，结果丢弃，不写诊断；下次启动后由下一轮结束再触发。
- `fork` 出的新会话没有标题和说明，自己的第一轮结束后生成（[`harness/runtime.md`](../harness/runtime.md) 输出 37）。回退不改标题和说明。

## 副作用与数据

- 前台会话的日志多 `titleChanged{by: "auto"}` 与 `descriptionChanged`（[`harness/runtime.md`](../harness/runtime.md)），`index.json` 多 `description`。
- 每个前台会话至多多一个标题会话目录，id 是 `session-title-` 加前台会话 id 的 SHA-256 前 32 位十六进制（前台 id 最长 128 个字符，直接拼会超过 id 上限），随状态根保存，不随书走，没有单独的清理。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `session-meta-failed`（诊断） | 一次生成失败 | 不用处理，按输出 12 再试 |
| `rules-unreadable`（诊断） | 规则文件存在但读不了 | 查文件权限或编码，下次压缩或新会话重读 |
| `session-meta-conflict`（诊断） | 标题会话的 id 被别的会话占了（Profile 或后台标记对不上） | 这个前台会话不生成，不往那个会话发内容 |

## 边界与兼容

- 内置 Profile 的 key 是公开的：其它插件和用户配置可以按 key 引用（`nbook.agent.profileSettings`、工具绑定、`startTask`）。
- 没有 `description` 的旧索引读作 null，不重建；旧会话下一轮结束后补上。
- `pluginExtensions: "none"` 的 Profile 收不到这里的触发，不生成标题和说明。

## 验收与 Smoke

1. 一个前台会话跑完第一轮：标题和说明写进快照与 `list`，主会话在生成完成前就能发下一条。
2. 用户在生成进行中改名：用户的名字保留，说明照写。
3. tiny 没绑模型：第一轮后是兜底标题；绑上后下一轮结束换成生成的标题。
4. 重启后打开旧会话（没有 `description`）：列表正常，下一轮结束后补上。
5. Smoke：真实模型跑主创改一个文件，并生成标题和说明（`builtin-profiles.llm.test.ts`）。

## 实现合同

- **公开入口**：Profile key `nbook.agent.main`、`nbook.agent.session-title`（常量 `MAIN_PROFILE`、`SESSION_TITLE_PROFILE`，在 `nbook/plugins/agent/shared/contracts`）；扩展 id `nbook.agent.session-meta`（标签 `session-meta`，Profile 可以按标签排除）、`nbook.agent.rules`。
- **owner 与依赖方向**：`nbook.agent` 的服务端入口，既贡献也接收这两个 Profile；标题和说明经内核只给宿主的 `setGeneratedMeta` 写（[`harness/runtime.md`](../harness/runtime.md) 输出 72）；模型角色的解析在 `nbook.models`。
- **关键不变量**：
  - 触发用 `turnEnded`，不用 `runEnded`：压缩运行也以 `runEnded{completed}` 收口，事件不带运行种类，而它没有轮（`builtin-profiles.test.ts`“触发器在真实内核上”）。
  - 碰会话的每一步各自经 `table.accept`，只有 `waitRun` 不经：停止要等 accept 的工作，而运行要等停止关会话才收口（`builtin-profiles.test.ts`“时序”）。
  - 同一个前台会话的生成排成一条队，轮到时按当时的状态重新判断，不记“上次失败了”（`builtin-profiles.test.ts`“同时触发只发一次”）。
  - 标题会话按快照里当前的 Profile 核对，不看会话头：会话头只记建会话时的（`builtin-profiles.test.ts`“被换成别的 Profile”）。
  - 主创的提示词文字只放常量，结构测试只锁节名与工具、不锁措辞：开发者按实际创作继续改（`builtin-profiles.test.ts`“主创”）。

## 证据

- 批准依据：w00032 t18 决定 1 到 5、8 到 14（[Task README](../../../.agents/works/w00032-agent-integration/tasks/t18-builtin-profiles/README.md)）；开发者 2026-11-05 确认计划，同日批准晋升为 `implemented`。
- 实现入口：[`backend/builtin/profiles/index.ts`](../../../packages/neuro-book/src/plugins/agent/backend/builtin/profiles/index.ts)、[`main.ts`](../../../packages/neuro-book/src/plugins/agent/backend/builtin/profiles/main.ts)、[`session-title.ts`](../../../packages/neuro-book/src/plugins/agent/backend/builtin/profiles/session-title.ts)、[`rules.ts`](../../../packages/neuro-book/src/plugins/agent/backend/builtin/profiles/rules.ts)、[`backend/session-meta.ts`](../../../packages/neuro-book/src/plugins/agent/backend/session-meta.ts)
- 合同测试：[`builtin-profiles.test.ts`](../../../packages/neuro-book/src/plugins/agent/builtin-profiles.test.ts)（真实内核、真实设置与文件服务、本机的 OpenAI 兼容端点）、[`agent.test.ts`](../../../packages/neuro-book/src/plugins/agent/agent.test.ts)（声明字段）、[`control.test.ts`](../../../packages/nb-harness/src/kernel/run/control.test.ts)（`setGeneratedMeta`）
- Smoke：[`builtin-profiles.llm.test.ts`](../../../packages/neuro-book/src/plugins/agent/builtin-profiles.llm.test.ts)（`test:llm`，DeepSeek）
