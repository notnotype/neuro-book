---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: agent.builtin-tools
owners:
  - nbook.agent
---

# Agent 的内置工具

## 目标与非目标

`nbook.agent` 经自己的 `agent.tools` 贡献点交出第一批工具：`read`、`write`、`edit`（hashline 与 replace 两条贡献）、`grep`、`glob`、`shell`。工具按资源地址（[`agent.resources`](resources.md)）读写，模型用 code agent 通常的方式工作。

不承诺：

- 工具不接审批：它们只声明等级（读、写、执行），要不要问由审批决定；`shell` 的只读白名单也在审批里。
- `shell` 只在前台，不转后台；不补它的安全缺口：能绕过只读模式、读到密钥、改任何文件，环境变量原样继承。它改的文件不算这个会话的改动，只能算外部改动。
- `read` 不读 PDF 与其它要转换的格式；`edit` 不删除、不移动、不新建文件；工具不提供待办、提问与切换模式。
- `edit` 不冻结基线：一次调用内读到的基线只用于这次写回，不带到调用之外。
- 多文件的 `edit` 不是整次原子。
- `grep`、`glob` 不在虚拟根上跑，不进搜索根下面的目录链接。
- 文字说明之外的渲染：对话界面怎样显示这些工具不在这里定。
- 已知限制：定位与读之间链接被换掉的竞态不防；地址替换只认命令里直接写出的地址；Windows 上的 `shell` 未验证。

## 术语与参与者

- **全局地址**、**单数地址**：见 [`agent.resources`](resources.md)。
- **全文**：工具结果放不下时保存在这个会话 `artifacts/` 下的完整输出。
- **输出窗口**：`shell` 交回给模型的输出。总量不超过 50 KB、2000 行且没有超过 768 字节的行时是全部；否则是开头与结尾各至多 20 KB、500 行，中间注明省略，单行超过 768 字节的截断并标出。

## 输入与前置条件

| id | 交给模型的名字 | 等级 | 并发 | 参数 |
|---|---|---|---|---|
| `nbook.agent.read` | `read` | 读 | shared | `path`、`offset?`（≥ 1 的整数）、`limit?`（1 到 2000 的整数） |
| `nbook.agent.write` | `write` | 写 | exclusive | `path`、`content` |
| `nbook.agent.edit` | `edit` | 写 | exclusive | hashline：`customFormat` 给出的语法 |
| `nbook.agent.edit-replace` | `edit` | 写 | exclusive | `path`、`old_string`、`new_string`、`replace_all?` |
| `nbook.agent.grep` | `grep` | 读 | shared | `pattern`、`path?`、`glob?`、`ignoreCase?`、`context?`（0 到 10）、`limit?`（1 到 500，缺省 100） |
| `nbook.agent.glob` | `glob` | 读 | shared | `pattern`、`path?`、`limit?`（1 到 1000，缺省 200） |
| `nbook.agent.shell` | `shell` | 执行 | exclusive | `command`、`timeout?`（秒，1 到 3600，缺省 300） |
| `nbook.agent.ask`（planned） | `ask` | 读 | exclusive | `questions`：1 到 4 题，每题 `question`、`header?`、`options`（2 到 4 个，`label`、`description?`）、`multiSelect?` |
| `nbook.agent.ask-form`（planned） | `ask` | 读 | exclusive | 同上，每题多一个 `form?`（JSON Schema） |

- 两条 `edit` 给模型的名字相同，Profile 只绑一条，由 Profile 选（主创绑 replace，[`builtin-profiles.md`](builtin-profiles.md)）；同一会话绑了两条按 [`harness/runtime.md`](../harness/runtime.md) 输出 15 处理。
- 输入的地址接受单数与全局两种写法，规则同 [`agent.resources`](resources.md) 输出 1。
- `grep`、`glob` 的 `path` 缺省是 `shell` 的工作目录。
- 工具说明用中文；`edit` 引擎的英文文字原样（[ADR 0034](../../adr/0034-language-policy.md)）。

## 输出与可观察行为

共同：

1. **地址都是全局的。** 工具结果里出现的地址（文件头、目录列表、搜索结果、`edit` 的文件名、全文的链接）都是全局地址，fork 或换 Profile 后仍指向同一个文件。
2. **失败。** 失败的结果在 `details.code` 给码，不按文字判断。工具工厂的 `services` 见 [`agent.contributions`](contributions.md)。
3. **写入的来源。** `write`、`edit` 写入的来源是这个会话并带这次调用的条目 id，同一次调用里的写入成一个操作分组（[`agent.resources`](resources.md) 输出 10）。工具中止时进行中的写入随之取消。
4. **全文。** 全文的文件名由宿主生成，同一会话里不重名；单个至多 64 MiB，超出时停止写，文件末尾与工具结果都注明；Agent 不能写 `artifacts/`。保存失败不影响工具结果，结果注明“全文没能保存”与原因。

`read`：

5. **文本。** 一次至多 2000 行、50 KB；单行超过 2000 字符截断并标出。结果是 `[地址#标记]` 头加带行号的行，标记是 `edit` 的行锚依据。文件大小不受 RPC 与写入接口的上限约束。超过 4 MiB 的文件没有标记，结果说明不能用行锚改，要用 replace、`write` 或 `shell`。
6. **目录与虚拟根。** 列一层，至多 500 项。
7. **图片。** png、jpeg、gif、webp（按文件头判断）交回一行说明与图片，原图超过 20 MB 为 `too-large`。已经够小（最长边 1568 像素内、最短边 200 像素以上、125 KiB 内，不是动图）的原样交回；否则最长边缩到 1568 像素、过小的放大到最短边 200 像素（不改变比例），在 PNG、JPEG、WebP 里取最小的（可能有透明的不用 JPEG，动图只留第一帧），超过 500 KiB 时逐级降质量再缩尺寸。别的二进制为 `not-text`。
8. **链接。** 读跟随链接：指向根外的按目标读，指向受保护位置的被拒（[`workspace.resources`](../workspace/resources.md)）。

`write`：

9. 不存在就建（含上级目录），存在就整份覆盖，不核对基线。结果是 `[地址#标记]` 与行数，写完可以直接用 hashline 改。上级是文件为 `not-a-directory`，不能写的位置为 `permission-denied`。

`edit`：

10. **目标。** 目标必须是合法的资源地址且已存在。任何目标是裸路径、相对路径或未登记的方案，或者这次调用有删除、移动操作，整次拒绝，什么都不读不写。目标不存在为 `not-found`，结果提示新建要用 `write`。
11. **写回。** 写回时核对这次调用里读到的基线：被别人改了得 `conflict`，不覆盖。超过 32 MB 的目标为 `too-large`。
12. **引擎的结果。** 引擎的失败码为 `edit-<errorKind>`（例如 `edit-no_match`、`edit-unseen_lines`），写回时文件服务的失败保留它自己的码。没看过的行、陈旧的行锚按引擎的规则拒绝。
13. **部分失败。** 多文件中途失败时，已写成的文件不回退；结果在引擎文字后列出每个文件的全局地址、已写入或失败、失败码，模型能看到哪些已经改了。

`grep`、`glob`：

14. **结果。** 都是全局地址，按路径与行号排序。不露出的文件（会话目录的 `index.json`、`blobs/`，项目的 `.nbook/`）不出现，也占不掉 `limit`。结果多于 `limit` 时注明还有更多。
15. **范围。** 虚拟根为 `unsupported-capability`，它下面的真实目录可以搜。搜索根可以是链接，`grep` 的根可以是目录或文件，`glob` 的根必须是目录（否则 `not-a-directory`）；根下面的目录链接不进。隐藏文件都搜，按 `.gitignore` 过滤。
16. **模式。** `grep` 的 `pattern` 是 `pi-natives` 的正则。不合法的模式不报错，按字面搜或得到零条。
17. **预算。** `grep` 单行至多 500 字符，结果至多 50 KB，30 秒期限，到了交回已有的结果并注明“不完整”，与“没有匹配”分开。`glob` 候选至多 5,000 个，到上限而可见结果不够时注明“不完整”；5 秒期限，到了为 `timeout`。

`shell`：

18. **工作目录。** 有主项目时是 `project://` 的真实路径，没有时是 `session://` 的真实路径（第一次用时建好）。
19. **地址替换。** 命令里直接写出的地址换成真实路径：只认已登记的方案与单数写法，方案前一个字符不能是字母、数字或 `-`、`_`；`https://` 与未登记的方案不动。引号外，地址到空白或 `;|&<>()` 结束，`\` 转义的字符算地址的一部分，替换后整段单引号包起；引号内到同种引号结束，替换后按所在引号编码。地址末尾的 `/` 替换后补回。不存在的目标从最近的已存在祖先（至多到方案根）接上余下的段；虚拟方案的根不算祖先，这时为 `not-found`；虚拟根与换不成真实路径的在执行前报错，这时命令不执行。heredoc、变量拼接、命令替换里的地址不保证替换。
20. **环境。** 继承服务端环境，另加 `NBOOK_PROJECT`（没有主项目时不设）与 `NBOOK_SESSION`，值是真实路径。
21. **输出。** 结果是输出窗口、退出码与是否超时或被中止；窗口放不下全部输出时附全文的全局地址，可用 `read` 分页读；放得下就不留全文。
22. **结束。** 退出码非 0 为 `exit-nonzero`，超时为 `timeout`，工具中止为 `cancelled`。超时与中止时已收到的输出照样保存。无论保存成败，一次调用命令恰好执行一次（第 19 条执行前报错的除外）。

### ask（planned）

23. 整批问题交给内核的提问通道（`ctx.ask`，[`harness/runtime.md`](../harness/runtime.md) 输出 40），运行停下等回答；每题总带“其它”。回答是 `{answers: [{selected: string[], other?: string, form?: unknown}]}`，工具按请求校验（题数、选项范围且不重复、`form` 的 schema），不合规得 `ask-invalid-answer`；用户的回答缺了这个结构也算不合规，只有 `questions: "caller"` 时的父会话可以只给文字。写成工具结果交回模型，结构化的值在 `details`。
24. `form` 先过 nb-form 的 Agent 策略（[`ui/forms.md`](../ui/forms.md) 输出 23），不合规得 `ask-form-invalid`，问题列在结果里，不打扰用户。
25. 两条 `ask` 给模型的名字相同，Profile 只绑一条（主创绑 `ask-form`），用工具绑定能换。后台会话得 `ask-unavailable`，不进等待。用户没有回答（`declined`、`interrupted`、`aborted`）得 `ask-declined`。说明里写单独调用，不和别的工具放在同一条回复。

### 审批预览（planned）

26. `edit`、`edit-replace`、`write` 有只读预览：`approvalPreview({sessionId, interactionId})` 按这个事项的参数试算，不写盘、不激活提供方，按会话的资源权限读。结果按文件分组：`diff`（`before`、`after`）、`too-large`（单个文件超过 256 KiB；`edit` 的原文件超过时不试算，这次调用的其余文件得 `failed`，码 `preview-skipped`）、`failed`（`code`；试算成功却没有这个文件的结果，比如粘贴前面调用存的寄存器，码 `edit-no-preview`）。别的工具得空列表。

## 状态与转换

工具本身不引入持久状态；行锚的快照在内存里，按会话共用，持有它的工具都释放后清掉。

时序与寿命：

- 一次 `read` 或 `write` 之后，同一会话的 `edit` 可以直接用它给的行锚；服务端重启或工具被释放后行锚失效，重新 `read`。
- 全文在命令结束后才出现；服务端进程崩溃时，运行中的 `shell` 的部分输出不进 `artifacts/`。

## 副作用与数据

- 全文：`<状态根>/agent/sessions/<会话 id>/home/artifacts/`，随会话保留，不单独清理。
- `shell` 运行期间，超出窗口的输出写在系统临时目录的一个文件里，结束时删除。

## 失败与恢复

资源视图与文件服务的码原样交回（`not-found`、`permission-denied`、`conflict`、`too-large`、`no-project`、`unknown-outcome` 等），见 [`agent.resources`](resources.md)、[`workspace.resources`](../workspace/resources.md)。本 Spec 另有：

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `not-text` | `read` 的目标是不支持的二进制 | 用 `shell` |
| `edit-<errorKind>` | `edit` 引擎的失败，文字说明原因 | 按文字修正后再试，常见的是重新 `read` |
| `unsupported-capability` | 在虚拟根上搜索或跑 `shell` | 换真实目录，或用 `read` 看虚拟根 |
| `exit-nonzero` | 命令退出码非 0 | 看输出 |
| `timeout` | `shell` 超时，或 `glob` 到期限 | 调大 `timeout` 或缩小范围 |
| `cancelled` | 工具被中止 | 无 |

## 边界与兼容

- 公开接口：工具 id、交给模型的名字、参数与失败码。Profile 按 id 绑定工具。
- 工具经资源视图读写，不另开写盘路径；`read`、`grep`、`glob` 取读路径后在本机读，由文件服务授权（[`workspace.resources`](../workspace/resources.md) 的“写入接口”）。

## 验收与 Smoke

1. 真实模型：只绑这几个工具的 Profile 读一个文件、改一行、`grep` 找到它、`shell` 统计行数。
2. 一个 `shell` 命令输出 2 MiB、中途被中止：全文落进 `artifacts/`，`read` 能分页读回；Agent 写 `artifacts/` 仍被拒；fork 之后链接仍指向原会话。
3. 暂存目录不可用：`shell` 的命令照常执行一次，结果注明“全文没能保存”。
4. `edit` 改两个文件，第二个被别人改过：第一个已写入、第二个 `conflict`，下一次模型请求的工具消息里两件事都看得到。

Smoke：`packages/neuro-book/src/plugins/agent/builtin-tools.llm.test.ts`（`test:llm`）。

## 实现合同

- **公开入口**：工具 id 与声明（`nbook.agent` 经 `agent.tools` 贡献），Profile 按 id 绑定；工具工厂的 `services` 形状在 `nbook/plugins/agent/shared/resources`。
- **owner 与依赖方向**：`nbook.agent` 的服务端入口，既贡献也接收这些工具；读写依赖 `nbook.files` 的写入接口，行锚、搜索与 shell 依赖 `@oh-my-pi/pi-natives`。
- **关键不变量**：
  - 工具不自己写盘：写都经资源视图或 `SessionArtifacts`，所以来源、分组与授权由文件服务判定（`builtin-tools.test.ts`“edit”“全文”）。
  - `edit` 的引擎只算新内容，写回核对这次调用里读到的基线；进引擎前把目标换成全局地址，不去改引擎的文字（输出 1、11，`builtin-tools.test.ts`“验收 4”）。
  - `shell` 的输出回调只做同步的事，全文在命令结束后才保存：暂存不可用不影响执行，命令恰好执行一次（输出 22，`builtin-tools.test.ts`“验收 3”）。
  - `grep` 的回调不等异步核对：匹配入队、逐文件核对，配额与期限到了都不再核对，核对过的结果留着（输出 14、17，`builtin-tools.test.ts`“grep 与 glob”）。
  - `read`、`write`、`edit` 按会话共用行锚快照，按持有的工具引用计数（`builtin-tools.test.ts`“hashline 改一行”）。

## 证据

- 批准依据：[w00032 t12](../../../.agents/works/w00032-agent-integration/tasks/t12-builtin-tools/README.md) 的决定与[第四稿计划](../../../.agents/works/w00032-agent-integration/tasks/t12-builtin-tools/plan.md)；开发者 2026-11-04 批准晋升为 `implemented`。
- 实现入口：[`backend/builtin/index.ts`](../../../packages/neuro-book/src/plugins/agent/backend/builtin/index.ts)、[`read.ts`](../../../packages/neuro-book/src/plugins/agent/backend/builtin/read.ts)、[`image.ts`](../../../packages/neuro-book/src/plugins/agent/backend/builtin/image.ts)、[`write.ts`](../../../packages/neuro-book/src/plugins/agent/backend/builtin/write.ts)、[`edit.ts`](../../../packages/neuro-book/src/plugins/agent/backend/builtin/edit.ts)、[`search.ts`](../../../packages/neuro-book/src/plugins/agent/backend/builtin/search.ts)、[`shell.ts`](../../../packages/neuro-book/src/plugins/agent/backend/builtin/shell.ts)、[`shell-address.ts`](../../../packages/neuro-book/src/plugins/agent/backend/builtin/shell-address.ts)
- 合同测试：[`builtin-tools.test.ts`](../../../packages/neuro-book/src/plugins/agent/builtin-tools.test.ts)（真实服务端内核、真实文件、真实 brush、本机的 OpenAI 兼容端点）、[`builtin-tools-project.test.ts`](../../../packages/neuro-book/src/plugins/agent/builtin-tools-project.test.ts)（真实项目子进程）
- Smoke：[`builtin-tools.llm.test.ts`](../../../packages/neuro-book/src/plugins/agent/builtin-tools.llm.test.ts)（`test:llm`，真实模型）
