---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: agent.resources
owners:
  - nbook.agent
---

# Agent 的资源地址

## 目标与非目标

给 Agent 会话一套按资源地址读写的视图：会话自己的工作区、Profile 的笔记、临时目录、其它会话、其它书、产品文档。地址经文件服务（[`workspace.resources`](../workspace/resources.md)）分派，`nbook.agent` 注册其中五个方案，并把“当前这一个”的单数地址改写成全局地址。Agent 的文件工具与内核的资源接口都经这里读写。

不承诺：

- 浏览器访问这里的方案（随对话界面另定）；
- `history://`（文件的旧版本）与 `mcp://`（MCP 资源）；
- 插件声明自己的文档目录，`skills://` 的条目（随 Skill 目录）；
- 审批：这里只给出每个地址的分类，按分类弹不弹审批由审批与工具决定；
- 已知限制：授权只在文件服务入口按路径做，Agent 的 shell 直接操作真实目录（可以换符号链接、读写任何地方），不受这里的规则约束；临时目录只在服务端启动时清理。

## 术语与参与者

- **全局地址**：文件服务认得的地址，例如 `sessions://<会话 id>/home/plan.md`。
- **单数地址**：指“当前这一个”的地址：`project://`、`session://`、`profile://`、`tmp://`，只在 Agent 会话里有意义，使用前改写成全局地址。
- **主项目**：会话建立时所属的项目（会话头的 `project`）；没有时 `project://` 不可用。
- **会话的资源视图**（`SessionResources`）：按一个会话构造、交给这个会话的工具与内核的读写入口。
- **作品内容**：属于某本书的文件，即 `projects://` 下的文件；其余都不算。

## 输入与前置条件

单数地址的改写：

| 单数地址 | 全局地址 |
|---|---|
| `project://<路径>` | `projects://<主项目 id>/<路径>` |
| `session://<路径>` | `sessions://<当前会话 id>/home/<路径>` |
| `profile://<路径>` | `profiles://<当前 Profile>/<路径>` |
| `tmp://<路径>` | `temps://<当前会话 id>/<路径>` |

`nbook.agent` 注册的方案（每个方案的根是虚拟目录，根下第一段是挂载点，挂载点是一个真实目录）：

| 方案 | 根的说明与条目 | 挂载点 | Agent 可写的 |
|---|---|---|---|
| `sessions://` | 最近使用的会话，至多 200 个：id、标题、Profile、更新时间 | `<会话 id>` → 会话目录，只露出 `session.jsonl`（所有调用方只读）与 `home/` | 自己的 `home/`，但 `home/attachments/`、`home/artifacts/` 除外 |
| `profiles://` | Profile 目录：key、名称、来源、可不可用 | `<key>` → 这个 Profile 的笔记目录 | 当前 Profile 的 |
| `temps://` | 无条目，只有说明 | `<会话 id>` → 这个会话的临时目录 | 自己的 |
| `docs://` | 说明与 `builtin`、`agent` 两个条目 | `builtin` → 产品文档（插件 SDK 的作者文档在 `builtin/sdk/`）；`agent` → Agent 插件的文档 | 无 |
| `skills://` | 只有说明 | 无 | 无 |

`projects://` 与 `user://` 由文件服务自己提供（[`workspace.resources`](../workspace/resources.md)）；Agent 对两者都可读写。

前置条件：会话的资源视图只由 `nbook.agent` 按内核给的会话上下文（会话 id、当前 Profile、主项目）构造，不经共享服务交给别的插件。

## 输出与可观察行为

1. **改写**：单数地址按上表改写；全局地址原样通过。路径先按资源地址的规则校验（含 `.`、`..`、空段等为 `invalid-address`），校验之后才拼接，不做去点段。没有主项目时 `project://` 为 `no-project`。
2. **分类**：`classify(地址)` 交回 `{content, write}`，只看改写后的全局地址，所以 `session://x` 与 `sessions://<自己>/home/x` 结果相同：
   - `content` 只对 `projects://` 为真；
   - `write`：`user://` 为 `ask`；`projects://` 与上表中 Agent 可写的为 `allowed`；其余为 `denied`。
3. **读写**：资源视图提供列出、读、写、新建、取真实路径，改写后经文件服务调用，并注明代表这个会话；写入的来源记为该会话（[`workspace.resources`](../workspace/resources.md) 的写入来源）。每个方法收调用方的 `signal`。
4. **权限**：按上表判断，Agent 写不可写的位置为 `permission-denied`；会话目录里 `session.jsonl` 与 `home/` 之外的文件为 `protected-path`，列出时也不出现。经符号链接落到不可写或受保护的位置，与直接访问那个位置同样处理。
5. **虚拟根**：列出 `sessions://`、`profiles://`、`temps://`、`docs://`、`skills://` 的根，得到说明与条目，每个条目带全局地址；读根得到同一份内容的文字（说明，加每个条目一行）；写根为 `permission-denied`；取根的真实路径为 `unsupported-capability`。
6. **按需建目录**：挂载点的真实目录还不存在时，读为 `not-found`、列出为空；第一次写、新建或取真实路径时建好（Profile 的笔记目录、会话的临时目录、会话的 `home/`）。被拒的请求不建任何目录。
7. **临时目录**：每个会话一个，在系统临时目录下按状态根分区（同一用户的两个状态根互不影响）。服务端启动时删除本状态根分区里已不存在或已归档的会话的目录；归档当下不删。
8. **产品文档**：`docs://builtin/sdk/README.md` 是插件 SDK 的作者文档，其中链接的附表与 Spec 都在 `docs://builtin/sdk/` 下可读；开发时与安装后读到的是同一份生成产物。
9. **内核的资源接口**：内核的 `resolve` 返回改写后的全局地址（校验不过的原样返回）；`read` 读文本，`not-found` 时为空，其它失败抛出。

## 状态与转换

本能力不引入持久状态。

时序与寿命：

- 资源视图跟着内核的会话上下文：会话换 Profile 后，内核按新上下文重建工具与资源视图，`profile://` 随之指向新的 Profile。
- 挂载点按需打开、空闲回收，寿命由文件服务管理（[`workspace.resources`](../workspace/resources.md)）；资源视图不持有它们。
- 临时目录在服务端运行期间不被清理；归档的会话的临时文件留到下次启动。

## 副作用与数据

- Profile 的笔记目录：`<状态根>/agent/profiles/<key>/`，跨项目，不随书走。
- 会话的工作区：`<状态根>/agent/sessions/<会话 id>/home/`；`attachments/` 由宿主写入用户上传的附件，`artifacts/` 由宿主写入工具大结果的全文。
- 临时目录：`<系统临时目录>/nbook/<状态根标记>/sessions/<会话 id>/`；`nbook` 已被别的用户占用时用 `nbook-<用户 id>`。三层容器建时权限只给本用户，使用与删除前逐层核对是本用户的真实目录（不是链接、文件或别人的目录），不符合时 `temps://` 不可用并写诊断。
- 产品文档：开发时在包的 `dist/docs/`，安装后在应用包的同名目录，只读。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `invalid-address` | 地址或路径不合法 | 修正地址 |
| `no-project` | 会话没有主项目，用了 `project://` | 改用全局地址或别的方案 |
| `permission-denied` | Agent 不能写这个位置，或写虚拟根 | 不重试 |
| `protected-path` | 会话目录里不露出的文件 | 不重试 |
| `unsupported-capability` | 方案或位置不支持这个操作（例如虚拟根的真实路径） | 不重试 |

其余失败码沿 [`workspace.resources`](../workspace/resources.md)。

## 边界与兼容

- 公开面：`agent.tools` 工具工厂的 `services.resources`（[`agent.contributions`](contributions.md)）与内核的资源接口；`AgentService` 不交出资源视图。
- 单数地址只在 Agent 一侧有意义；交给模型与工具结果里的地址是全局形式。
- 信任边界：同进程的插件受信任（ADR 0027）；文件服务只接受 `nbook.agent` 注明代表哪个会话，资源视图不经共享服务交出，别的插件无法替会话读写。

## 验收与 Smoke

1. 会话 A 经工具写 `session://plan.md`、读 `sessions://<A>/home/plan.md` 得到同样内容，来源为 A；A 写 `sessions://<B>/home/x` 为 `permission-denied`；A 读 `sessions://<B>/session.jsonl` 成功、写它被拒；A 在自己的 `home/` 里建指向 `session.jsonl` 的链接后经链接写被拒。
2. 没有主项目的会话用 `project://` 为 `no-project`；有主项目的会话经 `project://` 写书，项目实例里记下的来源为该会话。
3. 会话换 Profile 后，`profile://` 指向新 Profile，旧 Profile 的笔记变为只读。
4. 两个状态根并存，各有会话的临时文件；其中一个重启后只清掉自己分区里已归档的会话目录，另一个的文件不变。
5. 从应用包解出的安装布局中读 `docs://builtin/sdk/README.md`，并跟进其中一条附表与一条 Spec 链接。

Smoke：不适用——没有界面；由 `plugins/agent/resources.test.ts` 经真实插件宿主覆盖。

## 实现合同

- **公开入口**：`nbook/plugins/agent/shared/resources`（`SessionResources`、`ResourceClass`、`AgentToolServices`）；工具工厂的形状在 `nbook/plugins/agent/shared/points`（`AgentToolImplementation.create(context, services)`）。五个方案经 `nbook.files` 的贡献点 `files.schemes` 注册，读写都经服务端文件服务（[`workspace.resources`](../workspace/resources.md)）。
- **owner 与依赖方向**：`nbook.agent` 的服务端入口注册方案、建临时目录的容器并在注册之前做启动清理，按内核给的会话上下文构造资源视图；它依赖 `nbook.files` 的服务端文件服务，Files 不依赖它。
- **关键不变量**：
  - 资源视图只经工具工厂的 `services.resources` 与内核的 `SessionEnv.resources` 交出，`AgentService` 不交出：别的插件拿不到能代表会话的读写（`resources.test.ts`“各方案对 Agent 的权限”）。
  - 分类只看改写后的全局地址，单数与全局写法结果相同；单数地址先校验路径再拼接，不做去点段（输出 1、2，`resources.test.ts`“改写与分类”）。
  - 会话目录只露出 `session.jsonl` 与 `home/`，经链接落到别处与直接访问同样判定（输出 4，`resources.test.ts`、`files/schemes.test.ts`“授权”）。
  - 启动清理只删能确定的：索引说已归档的，或会话目录已不在的；索引读不了的会话照样保留，容器逐层核对是本用户的真实目录（输出 7，`resources.test.ts`“验收 4”）。

## 证据

- 批准依据：开发者 2026-10-28 定稿的第三版设计与 2026-10-30 的三条后续修改（[w00032 t08](../../../.agents/works/w00032-agent-integration/tasks/t08-resources-home/README.md) 的“决定”）；2026-11-02 的实施前决定与第三轮设计审查后的改判（同一 README 的“实施前的决定”、[计划](../../../.agents/works/w00032-agent-integration/tasks/t08-resources-home/plan.md)）；开发者 2026-11-02 批准晋升为 `implemented`。
- 实现入口：[`backend/resources.ts`](../../../packages/neuro-book/src/plugins/agent/backend/resources.ts)（改写、分类与内核资源接口）、[`backend/schemes.ts`](../../../packages/neuro-book/src/plugins/agent/backend/schemes.ts)（五个方案）、[`backend/temps.ts`](../../../packages/neuro-book/src/plugins/agent/backend/temps.ts)（临时目录）、[`backend/docs-root.ts`](../../../packages/neuro-book/src/plugins/agent/backend/docs-root.ts)、[`scripts/agent-docs.ts`](../../../packages/neuro-book/scripts/agent-docs.ts)（产品文档）
- 合同测试：[`resources.test.ts`](../../../packages/neuro-book/src/plugins/agent/resources.test.ts)（真实插件宿主、真实工具工厂）、[`scripts/pack-app.test.ts`](../../../packages/neuro-book/scripts/pack-app.test.ts)（应用包里的文档布局与定位）
- Smoke：不适用——没有界面；工具读写随 t12 的基础工具一起验收
