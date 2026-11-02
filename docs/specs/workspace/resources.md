---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: workspace.resources
owners:
  - workspace-files
---

# 资源寻址与文件服务

## 目标与非目标

用 `方案://路径` 统一寻址项目、用户资产、临时目录、Agent 会话工作目录与参考文档等资源。文件服务按方案把请求分派给提供者，提供者声明自己的能力；读写、列出、glob、grep、监视都经文件服务，写入记录来源并发出变更事件。资源管理器、编辑器、Agent 文件工具与 History 等插件都是它的使用方。

实现顺序：Files 竖切（[v2 重建](../../proposals/neuro-book-v2-rebuild.md)推进顺序第 6 条）已实现 `project://` 与 `user://` 两个真实目录型提供者的读、条件保存、列出与监视（见“实现合同”“证据”）。方案注册、服务端的进程内文件服务与 `projects://`、Agent 的五个方案随 Agent 的资源地址（[`agent.resources`](../agent/resources.md)）实现（`(planned)`），第一个使用方是 Agent 的文件工具；浏览器访问已注册的方案、第三方插件注册方案、glob 与 grep 仍是 `(planned)`，随各自的第一个使用方实现（见下表“说明”一列与下文各处 `(planned)` 标注）。

非目标：远程文件系统提供者；全文索引与搜索服务；回收站与文件操作撤销；普通文件的稳定身份与引用维护（只有活页夹章节有稳定身份，见 [workspace.folder-kinds](folder-kinds.md)）；`chapter://`、`plot://` 的具体提供者（随剧情改造另定）。

## 术语与参与者

- **资源地址**：`方案://路径`，路径用 `/` 分隔，相对该方案的根；不包含服务端绝对路径。
- **项目绑定**：客户端窗口一生绑定的项目代次（[`runtime.projects`](../runtime/projects.md)）；`project://` 按它解析。
- **提供者**：实现某个方案的读写、列出、监视等操作的对象，由内置插件或插件注册。
- **真实目录型提供者**：方案根对应一个真实目录，可以给出资源的真实路径。
- **虚拟提供者**：数据不在真实目录中（例如数据库），没有真实路径。
- **能力声明**：提供者对读、写、列出、glob、grep、监视、真实路径（bash 可用）的逐项声明。
- **文件服务**：按方案分派请求、记录写入来源、汇总变更事件的唯一入口。
- **来源**：一次写入的发起方，取值为写作者（人）、Agent 会话（带会话 id）、系统、外部。
- **挂载方案**（planned）：根是虚拟目录、根下第一段（挂载点）各对应一个真实目录的方案，由注册方声明根的说明与条目、挂载点与授权规则，真实目录的读写由文件服务完成。
- **服务端文件服务**（planned）：服务端插件在进程内使用的文件服务入口，按全局地址分派到 `user://`、`projects://` 与已注册的方案。
- **使用方**：资源管理器、编辑器、Agent 文件工具、插件等经文件服务访问资源的调用者。

## 输入与前置条件

- 请求携带资源地址与操作，不携带来源。来源由提供者按内核签发的调用方身份确定（见“输出与可观察行为”的写入来源），调用方不能自称为其它来源；业务输入里出现来源字段按输入不合法拒绝。
- 资源地址的路径用 `/` 分隔、相对方案根；不得含空段、`.`、`..`、反斜杠、NUL，第一段不得是盘符形式（`C:`、`C:notes.md`），编码后不超过 4096 字节；根本身是空路径。名字里的 `:` 在 Linux 与 macOS 上是合法文件名；Windows 宿主另拒绝含 `:` 的段（备用数据流）、UNC 与设备名。
- 本能力首批方案：

  | 方案 | 根 | 类型 | 说明 |
  |---|---|---|---|
  | `project://` | 调用方绑定的项目的目录 | 真实目录型 | 由项目实例提供；客户端经 `project` 目标访问自己绑定的项目代次，不依赖“当前项目”状态 |
  | `projects://`（planned） | 已登记项目的列表，`projects://<引用>/路径` 指向该项目目录下的资源（引用是项目 id 或短名） | 虚拟列表，项目内为真实目录型 | 由 `nbook.files` 在服务端文件服务里提供，只供服务端插件使用；见输出“跨项目访问” |
  | `user://` | 状态根下的 `user/`（不存在时创建） | 真实目录型 | 跨项目共享；由服务端实例提供 |
  | `sessions://`、`profiles://`、`temps://`、`docs://`、`skills://`（planned） | 见 [`agent.resources`](../agent/resources.md) | 挂载方案 | 由 `nbook.agent` 注册，只供服务端插件使用 |

  Agent 会话里的单数地址 `project://`、`session://`、`profile://`、`tmp://` 由 Agent 改写成上表的全局地址（[`agent.resources`](../agent/resources.md)），文件服务不认它们（浏览器的 `project://` 除外）。

- 方案注册（planned）：插件经贡献点 `files.schemes` 注册挂载方案，贡献 id 就是方案名；`project`、`user`、`projects` 保留给 `nbook.files`；同一方案只能有一个提供者，重复注册被拒绝。这次只接受内置插件注册；第三方插件注册与 SDK 公开面随第一个插件方案（剧情插件的 `plot://`）。挂载方案声明：
  - 支持的操作（读、写、列出、真实路径）；
  - 根的说明与条目；
  - 挂载点所在的容器目录，每个挂载点能不能在第一次写入时建、要随之建好的单段子目录；
  - 授权规则：按调用方、挂载点、操作与挂载点内的路径判断。
- 服务端文件服务（planned）：服务端插件按调用方取得，方法为列出、读、写、新建、真实路径，每个方法收调用方的 `signal`；不提供批量、删除、改名。服务端的 `nbook.agent` 可以注明代表哪个 Agent 会话（会话 id 与当前 Profile），别的调用方注明为 `invalid-input`。
- 访问 `project://` 需要有效的项目绑定（见 [workspace.files](files.md)）；绑定的项目代次结束时请求失败，不回退到其它根、不改投新代次。

## 输出与可观察行为

**能力矩阵：** 每个操作只在提供者声明了对应能力时可用，否则返回“能力不支持”，不静默降级。

glob 与 grep 的能力模型待讨论（见[设计稿的后续讨论](../../proposals/project-file-foundation.md#后续重构不在本次)）：本表虚拟提供者一列的写法在讨论结论前不实施；glob、grep 与真实路径上的 bash 工具（planned）两行在真实目录型一列写的也是目标行为，缺口是还没有 glob、grep、shell 三个工具，不是文件服务这一层缺方法。

| 操作 | 真实目录型 | 虚拟提供者 |
|---|---|---|
| 读 | 返回内容与磁盘基线 | 返回实体的文本呈现 |
| 写 | 经文件服务写入并记录来源 | 只接受结构化写入（专用工具或命令），不接受改文本后解析回写 |
| 列出 | 返回一层目录项 | 由提供者枚举 |
| glob（planned） | 支持 | 由提供者枚举后匹配 |
| grep（planned） | 支持，可直接在真实路径上运行 | 由提供者实现，或声明不支持 |
| 监视 | 文件监视 | 提供者自行发出事件 |
| 真实路径（bash，planned） | 可解析为真实路径 | 不可，见下 |

- **shell（planned）：** Agent 的 shell 工具只接受能解析为真实路径的方案，工作目录有主项目时为该项目，没有时为会话的 `home/`（[`agent.resources`](../agent/resources.md)）。对虚拟方案返回明确错误，提示改用读写工具。缺口：还没有 shell 工具。
- **写入来源：** 每次经文件服务成功写入都带来源；bash 等绕过文件服务的写入由文件监视发现，来源记为外部，能按会话工作目录确定会话时记为该会话。来源按调用方身份确定：

  | 调用方 | 来源 |
  |---|---|
  | 窗口（浏览器、TUI）里的插件 | `{kind: "user", plugin}`（写作者） |
  | 服务端、项目实例里的插件 | `{kind: "system", plugin}` |
  | 服务端的 `nbook.agent` 经服务端文件服务注明代表某个会话（planned） | `{kind: "agent", session}`；经 `projects://` 写书时，`nbook.files` 把这个来源随调用带给项目实例（项目合同的这个参数只接受服务端的 `nbook.files`） |
  | 文件监视发现的变化 | `{kind: "external"}` |

  调用方身份证明的是哪个入口执行，不是谁发起：窗口里的插件替远程命令（例如 Agent 经命令系统触发的命令）执行的写入，在发起者沿命令调用链传到执行边界之前也记为写作者。
- **变更事件：** 文件服务对每个方案发出新建、修改、改名（带旧地址与新地址）、删除事件，附来源。精确的新建、改名只来自经文件服务的操作；文件监视发现的外部变化只分两类：路径现在存在为修改（可能是新建、替换或修改，订阅方按当前状态核对），不存在为删除；外部改名表现为旧地址删除、新地址修改。经文件服务的操作：新建与复制发新建（目录只发目录本身），移动、改名与文件夹类型转换发改名 `{type: "renamed", path, from}`，删除发删除，清单的更新是清单文件的修改。改名与删除对路径本身及按段边界的全部后代生效（`a/b` 覆盖 `a/b/c`，不覆盖 `a/bc`），订阅方按前缀替换或清除。目录删除只在目录实际移除时发目录的删除；部分删除（目录仍在）发实际已删除的最外层路径。事件用于刷新与记账，不保证逐条可靠投递，消费方断线后按当前状态重新核对。
- **订阅：** 订阅一个方案的变更，先收到“就绪”，之后收到成批的事件 `{type, path, source}`；文件服务自己写入与操作的回声（含它的临时文件）不再以外部来源重复发出；回声按真实路径的预期状态判定（保存比内容，新建、复制、移入比目录项身份，删除与移出比不存在），之后同一路径被外部换掉或修改仍以外部来源发出。以下情况推“失同步”，订阅方按当前状态重新核对：监视器报错；平台事件队列溢出或事件没有路径；一批待处理路径过多或装不进一条远程服务消息；同一项目代次内断线重连（断线期间的事件不补发）。订阅建立失败或结束（提供者停止、项目代次结束、根目录不在）时订阅方收到“结束”与原因，之后不再有事件。
- **按需读取：** 列出一层目录不读取文件内容，也不解析 frontmatter。
- **挂载方案（planned）：**
  - 列出根本身得到说明与条目（每个条目带全局地址）；读根本身得到同一份内容的文字；写根为 `permission-denied`；根的真实路径为 `unsupported-capability`。
  - 授权在服务入口做两次：按地址的路径一次、按解析链接之后的真实路径一次，都通过才执行；列出的子项逐项按读授权，不通过的不返回。
  - 挂载点的真实目录不存在时，读为 `not-found`、列出为空；第一次写、新建或取真实路径时，在授权通过后建挂载点的目录与声明的子目录，同名位置已是文件或链接时不覆盖；被拒的请求不建任何目录。
  - 挂载方案不做文件夹类型投影：`.content`、`.binder` 是普通目录，不维护清单。
  - 这次不支持监视与订阅。
- **跨项目访问（planned）：** `projects://` 的根列出已登记的项目；`projects://<引用>/路径` 每次调用先取得这个项目的租约（没在运行的会被打开），再调用项目实例的文件服务，结算后释放租约；调用方的 `signal` 在取得租约之后、调用之前已触发时立即释放并以 `cancelled` 结束。项目实例返回的路由失败（例如写请求结果未知 `unknown-outcome`）原样交回调用方。

## 状态与转换

本能力不引入持久状态。提供者注册随所属插件的激活与关闭登记和撤销；方案在提供者撤销后不可用，进行中的请求按 [runtime.plugins](../runtime/plugins.md) 的关闭规则结算。

| 状态/事件 | 结果 |
|---|---|
| 方案未注册 | 请求返回“方案不存在” |
| 提供者注册 | 方案可用，按能力声明受理请求 |
| 提供者撤销 | 新请求被拒；订阅收到结束通知；挂载方案等在途请求结算后关闭全部挂载点，之后不再重开 |
| 挂载点（planned） | 第一次请求时打开；没有在途请求且空闲 5 分钟后关闭，下次请求重新打开；同时打开的超过 64 个时先关空闲的，都在用就照开并写诊断 |
| 绑定的项目代次结束 | `project://` 的请求失败、订阅结束；窗口重新加载后按新绑定解析（切换项目即整页重新加载，窗口内不切换） |

## 副作用与数据

- 写入、改名、删除改变提供者背后的数据；读取、列出、监视无业务写入副作用。
- 文件监视由文件服务按订阅持有，订阅释放后停止。
- 变更事件交给订阅方（资源管理器、History 等）；事件本身不持久化，持久记账由订阅方负责（例如 History）。
- 资源地址不含服务端绝对路径；不向浏览器暴露状态根、安装目录等服务端内部路径、数据库对象或凭据。用户自己登记的项目目录路径可以显示给用户（[`runtime.projects`](../runtime/projects.md)）。

## 失败与恢复

- 方案不存在、能力不支持、地址越界、权限不足、资源不存在、写入冲突、提供者不可用各自可区分。真实目录型提供者的业务失败码：

  | 码 | 含义 | 调用方怎么办 |
  |---|---|---|
  | `invalid-address` | 地址不合法 | 修正地址 |
  | `unknown-scheme` | 没有这个方案 | 不重试 |
  | `root-gone` | 方案根被移走、删除或换成别的目录 | 提示用户；不改投其它根 |
  | `outside-root` | 解析（含符号链接）后落在方案根外 | 不重试 |
  | `protected-path` | 受保护的控制目录（见 [workspace.files](files.md)） | 不重试 |
  | `permission-denied` | 操作系统拒绝，或目标只读 | 提示用户 |
  | `not-found` | 资源不存在（含悬空链接） | 重新列出 |
  | `not-a-file`、`not-a-directory` | 类型不符 | 重新列出 |
  | `not-text` | 不是 UTF-8 文本 | 不在文本编辑器打开 |
  | `too-large` | 超过正文上限（见 [workspace.files](files.md)） | 不在文本编辑器打开 |
  | `conflict` | 保存：基线与磁盘不一致，结果带当前基线；文件操作：目标已存在 | 交冲突处理或换目标名，不覆盖 |
  | `into-itself` | 移动或复制到自身或后代 | 换目标 |
  | `source-changed` | 操作的源与冻结时的身份不符（被替换、移走） | 重新选择 |
  | `unsupported` | 文件系统不支持排他改名、跨设备移动、复制特殊文件 | 不重试 |
  | `invalid-order` | 清单编辑给的名字不在清单里或重复 | 重新列出 |
  | `busy` | 别的文件操作占着操作锁，等不到 | 稍后重试 |
  | `io-failed` | 其它读写失败 | 可重试 |
  | `unsupported-capability`（planned） | 方案或位置不支持这个操作（挂载方案没声明的操作、虚拟根的真实路径） | 不重试 |
  | `project-unavailable`（planned） | `projects://`：取不到项目的租约，或项目登记表损坏（详情带原因） | 提示用户；登记表修好后照常 |

  失败详情用资源地址描述，不带服务端绝对路径。路由层的失败（不可达、项目代次结束、写请求结果未知等）按 [远程服务](../runtime/plugin-channel.md) 原样交给调用方，不转成空结果。
- （planned）挂载方案按注册方的授权规则拒绝写入（`permission-denied`）、隐藏受保护的文件（`protected-path`），例如 `docs://` 只读；Agent 对各方案的权限见 [`agent.resources`](../agent/resources.md)。Agent 写 `user://` 要先经审批（分类为“写入要询问”），文件服务本身不拦。
- 提供者异常不影响其它方案；监视中断时通知订阅方失同步，恢复后由订阅方重新核对。

## 边界与兼容

- owner：workspace-files（文件服务与首批提供者，内置插件 `nbook.files`）。真实目录型提供者的根访问按 [platform.files](../platform/files.md) 的包含、链接与身份规则实现，由 `nbook.files` 自己的受根约束原语提供；独立的平台文件插件随第二个使用方出现。
- 文件操作的语义（批量、冲突、逐项结果）沿 [workspace.files](files.md)；文件夹类型与清单沿 [workspace.folder-kinds](folder-kinds.md)。
- 浏览器经 [远程服务](../runtime/plugin-channel.md) 调用 `project://`、`user://` 两份合同；Agent 来源的事件进入这两份合同的订阅，两份合同的版本随之各加 1（planned），开着的旧窗口得到 `version-changed` 后要刷新。浏览器访问已注册方案（planned）随对话界面另定。
- 方案注册与服务端文件服务只在服务端进程内使用，不经远程合同；第三方注册（planned）随 `plot://`。
- 已知限制（planned）：授权只在服务入口做，操作内部等锁之后的重新解析不再授权；其间能替换链接的只有 Agent 的 shell，而 shell 本就不受文件工具的规则约束。
- Agent 文件工具的入参改为资源地址，旧的路径参数随该切片迁移；glob、grep、shell 仍是 `(planned)`。

## 验收与 Smoke

1. （planned）经服务端文件服务对 `user://`、`projects://`、`sessions://`、`profiles://`、`temps://`、`docs://` 分别读、列出、取真实路径；`docs://` 写入被拒；未注册的方案返回“方案不存在”；挂载方案没声明的操作返回 `unsupported-capability`。glob、grep 随 Agent 的工具另验。
2. 写作者、Agent 会话、系统分别写入同一 Project，订阅方收到的变更事件带正确来源；调用方无法冒充其它来源。
3. （planned，依赖 shell 工具）Agent 用 shell 修改项目下的文件：文件监视发出事件，来源为外部。
4. （planned）一个内置测试插件注册挂载方案，只声明读与列出：读、列出可用；写、真实路径返回 `unsupported-capability`。重复注册同一方案被拒；插件关闭时在途请求先结算，之后方案不可用。
5. 经文件服务改名产生带新旧地址的改名事件，目录改名覆盖其后代；外部改名产生旧地址删除、新地址修改。经文件服务的新建、移动、复制、删除各只产生自己的精确事件，没有外部来源的回声；之后外部替换同名目录或修改移入的文件仍以外部来源发出。
6. 绑定的项目代次结束后，`project://` 的请求失败、订阅结束，迟到结果不投递；窗口重新加载后 `project://` 指向新绑定的项目。
7. 列出 3000 个文件的项目根与任意一层目录，不读取文件内容（以读取计数或文件访问记录核对）。
8. （planned）挂载点寿命：空闲 5 分钟后关闭、在途的不关；第 65 个照开；同一挂载点并发的第一次请求只打开一次；关闭途中到来的请求等它关完后重新打开。
9. （planned）跨项目访问：没在运行的项目经 `projects://` 读写成功，写入来源透传到项目实例；在取得租约之前、调用已发出之后分别取消，租约都被释放；项目子进程在写请求发出后断开，调用方得到 `unknown-outcome`；登记表损坏时为 `project-unavailable`，修好后照常。
10. （planned）代表会话写：服务端 `nbook.agent` 注明会话的写入，订阅方看到来源为该会话；别的服务端插件注明会话为 `invalid-input`；浏览器给项目合同带来源参数为 `permission-denied`（远程提供方不能交回路由层的 `invalid-input`）；不带的浏览器写入照常。

## 实现合同

- 公开入口：`files/shared/resource.ts`（`parseResource`、`Resource`、`Scheme`、`SCHEMES`）；写入来源与变更事件经 `files/shared/contracts.ts` 的事件 schema。
- owner 与依赖方向：`workspace-files`（内置插件 `nbook.files`）；真实目录型提供者的根访问按 [`platform.files`](../platform/files.md) 的包含、链接与身份规则，由 `nbook.files` 自己的受根约束原语提供（尚无独立的平台文件插件，随第二个使用方出现）。
- 不变量：
  - 调用方不能自称来源，来源完全由提供者按内核签发的调用方身份确定（`changes.test.ts` 的“写入来源：按调用方身份”）；
  - 文件服务自己写入的回声按真实路径的预期状态判定、不重复以外部来源发出（`changes.test.ts` 的“自己写入的回声”）；
  - 监视器报错、事件队列溢出或断线重连都推“失同步”而不是静默丢事件（`changes.test.ts` 的“订阅：共享、释放与失同步”）。

## 证据

- 批准依据：[项目文件底座与 Files 竖切](../../proposals/project-file-foundation.md)（`accepted`，2026-10-02）的“分项决定”与方案第 1、3、8 节；2026-10-09 [w00017 待确认清单](../../../.agents/works/w00017-application-runtime-architecture/pending-confirmations.md) 的 t68 条目（实现顺序、来源按调用方身份、外部事件只分修改与删除、根访问由 `nbook.files` 提供）与 t69 条目（文件操作的失败码与事件前缀规则）；[多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 3、9 节（2026-10-07 `accepted`）与开发者 2026-10-07 在 [t54 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t54-project-child-process/plan.md) 中的确认（`project://` 按客户端绑定解析、`projects://` 与路径可见性）；2026-10-14 本次晋升复核：glob、grep、bash、`tmp://`/`local://`/`docs://`/`projects://`、插件注册新方案的接口标 `(planned)`；2026-11-02 开发者在 [w00032 t08](../../../.agents/works/w00032-agent-integration/tasks/t08-resources-home/README.md) 定的方案注册、服务端文件服务、Agent 的方案与 `local://` 的取消（改为 `session://`），见 [t08 计划](../../../.agents/works/w00032-agent-integration/tasks/t08-resources-home/plan.md)。
- 实现入口：[`plugins/files/shared/resource.ts`](../../../packages/neuro-book/src/plugins/files/shared/resource.ts)、[`plugins/files/backend/changes.ts`](../../../packages/neuro-book/src/plugins/files/backend/changes.ts)
- 合同测试：[`files/shared/resource.test.ts`](../../../packages/neuro-book/src/plugins/files/shared/resource.test.ts)、[`files/changes.test.ts`](../../../packages/neuro-book/src/plugins/files/changes.test.ts)、[`files/project-child.test.ts`](../../../packages/neuro-book/src/plugins/files/project-child.test.ts)
- Smoke：不适用——没有独立 e2e，经 [`workspace.files`](files.md)、[`workbench.files-explorer`](../workbench/files-explorer.md) 的 e2e 间接覆盖资源读写部分
