# t69 实施计划：Files 竖切二：文件操作

## Context

- **为什么做**：第 6 步 Files 竖切的第二片（[t68 计划的“第 6 步分解”](../t68-files-resource-layer/plan.md#第-6-步分解)）。资源管理器（t70）的新建、改名、移动、复制、删除、创建内容、调整顺序与展示名都落在这里；t68 只交付了列出、读取、条件保存与事件。依据 [`workspace/files.md`](../../../../../docs/specs/workspace/files.md)（操作表、批量与逐项结果、失败与恢复、验收 2、3、8、9）、[`workspace/folder-kinds.md`](../../../../../docs/specs/workspace/folder-kinds.md)（经文件服务的操作同步清单、调整顺序与展示名、转换）、[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)（变更事件的新建、改名、删除）与 [`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md) 的“基础文件操作”（服务侧语义）。
- **已有的底座**（t68）：`nbook.files` 的两份远程合同（`nbook.files/project`、`nbook.files/user`，调用方 `browser`、`tui`、`project`、`server`）；受根约束的原语 `backend/rooted.ts`（根身份、包含校验、控制目录、按基线替换）；加锁替换 `src/backend/locked-replace.ts`；变更事件 `backend/changes.ts`（回声按内容 hash、临时文件名带实例标记、失同步与监视重建）；浏览器客户端 `filesKey`；测试场景 `files/testing/scene.ts`、真实项目子进程与真实 WebSocket 的测试写法。
- **推进方式**：同 t68（autonomous-delivery；worktree 逐片提交并 push；真实内核、真实文件系统、真实项目子进程；不用 mock、spy、假计时器、固定等待；变异检查用逐个备份、变异、还原并核对字节的脚本；三个 omp 审查计划与实现）。不修改 `packages/neuro-book-legacy`。

## 关键设计

### 1. 原语（`backend/rooted.ts`、新文件 `backend/exclusive.ts`）

- **排他改名**（`exclusive.ts`）：`renameNoReplace(source, target)`，目标已存在为 `EEXIST`，不覆盖、不合并。Linux 用 `renameat2(AT_FDCWD, …, RENAME_NOREPLACE)`，macOS 用 `renamex_np(…, RENAME_EXCL)`，Windows 用 `MoveFileExW(…, 0)`，经 Bun 自带的 `bun:ffi` 调用，不新增依赖（旧应用 `workspace-files/rename-no-replace.ts` 同样的原生调用，经 koffi）。文件系统不支持时为 `unsupported`，不退回会覆盖的 `rename`。2026-10-09 实测 Linux tmpfs 上文件与目录都按预期得到 `EEXIST`；macOS、Windows 未验证。
- **目录项操作与目标操作分开**（沿 [`platform/files.md`](../../../../../docs/specs/platform/files.md)）：t68 的 `resolve` 跟随链接，是读写正文用的“目标”解析。新增 `resolveEntry(path)`：父目录按 `resolve` 解析（包含、控制目录、根身份），最后一段只 `lstat` 不跟随；改名、移动、删除作用于目录项本身（链接改名就是链接改名，删链接不删目标）。不存在的目标位置用 `resolveSlot(path)`：父目录存在且在根内，名字是合法的单段，项目根下的名字不得是控制目录（大小写不敏感）。
- **排他新建**：文件 `open(…, "wx")`，目录 `mkdir`（不递归）；父目录不存在为 `not-found`，不建中间目录。
- **复制**：源是文件时复制字节与权限位；是目录时递归复制，链接复制为链接（不跟随，不把根外内容拷进来），其它类型（设备、FIFO）跳过并计入结果。复制先写到目标目录里带实例标记的临时名，整棵复制完成后用排他改名放到目标名：中途失败删掉自己的临时目录，不留半棵树；目标名被占用为冲突。删不掉的残留在结果里报告范围。
- **删除**：文件与链接 `unlink`；目录递归删除，不改权限、不 `force`（只读的子项删不掉就失败，不升级为强删）；部分删除失败时报告已删与未删。
- 所有原语沿用 t68 的错误映射（`not-found`、`permission-denied`、`outside-root`、`protected-path`、`root-gone`、`io-failed`），新增 `conflict`（目标已存在）、`into-itself`（移到自身或后代）、`unsupported`（文件系统不支持排他改名）。

### 2. 单项操作（`backend/operations.ts`）

合同新增方法（两份合同同一份方法表，写方法 `effect: "write"`）：

| 方法 | 输入 | 结果 |
|---|---|---|
| `create` | `{path, kind: "file" \| "directory", before?: string}` | `{path}`；文件为空 |
| `createContent` | `{path}`（内容树里的节点目录） | `{path: "<节点>/index.md"}`；空白 Markdown，已有为冲突，不写模板 |
| `rename` | `{path, name}`（同目录改名） | `{path}` |
| `reorder` | `{directory, names}`（内容树里的目录） | 清单里该层的新顺序；不在清单里的名字为 `invalid-input` |
| `display` | `{path, title?: string \| null, icon?: string \| null}` | 只改清单里该项的展示名与图标；`null` 去掉 |
| `convert` | `{path, to: "content" \| "plain"}` | `{path}`：加或去 `.content` 后缀（排他改名）；转为内容文件夹时按当前子项与真实名字生成清单；去后缀时清单留作普通文件 |

- 名字规则：合法单段（同资源地址的段规则），不能为空、`.`、`..`，项目根下不能是控制目录。
- 改名、移动、转换都是排他改名；新建是排他新建。文件服务内两个并发的同名新建恰好一个成功，另一个 `conflict`。

### 3. 批量操作（`backend/operations.ts`）

- `move`、`copy`：`{operation, items: [{source, target}]}`；`delete`：`{operation, paths}`。`operation` 是调用方生成的操作 id，`cancel({operation})` 用它取消（见下）。目标是完整路径：碰撞时的改名、跳过由调用方（t70 的界面）决定，服务端只排他提交，不自动改名、不覆盖、不合并。
- 预处理：源按真实目录项去重（同一目录项出现两次只做一次），父子重叠只操作最外层；被去掉的项结果为 `skipped`（原因 `duplicate` 或 `covered`）。移动到自身或后代为 `into-itself`；目标等于源为 `done`（无操作）。只支持同一方案内的移动与复制（不新增跨根搬运承诺）。
- 逐项执行，结果与输入一一对应：`{status: "done" | "failed" | "skipped" | "not-run" | "cancelled", code?, detail?, path?, manifest?}`。普通单项错误记下后继续；根不在（`root-gone`）后其余项为 `not-run`；取消后尚未开始的项为 `cancelled`，正在执行的那一项做完（不撤销已完成的项）。
- **取消**：`cancel({operation})` 是单独的方法，命中正在执行的批量操作就让它在项与项之间停下，批量调用照常返回逐项结果。不用调用方的 `AbortSignal` 取消写请求：内核对已发出的写请求在中止时一律回 `unknown-outcome`，调用方就拿不到逐项结果了。
- 一次批量的项数上限 1000，结果要装进一条 RPC 消息。
- **事件**：经文件服务的操作给精确事件：新建 `created`，移动与改名 `renamed`（带 `from`），删除 `deleted`（目录只发目录本身，订阅方按前缀推断子项），复制为 `created`；清单更新是 `content.xml` 的 `changed`。来源同 t68（按调用方身份）。合同的变更事件加 `renamed` 类型与 `from` 字段。

### 4. 清单维护（`backend/manifest-edit.ts`）

- 在内容树里（最近的 `*.content` 祖先）新建、移入、复制进来追加条目（`create` 的 `before` 指定位置），改名改 `name`，移出与删除去掉条目；条目的子树（嵌套 `item` 的展示名）随目录一起搬：移动到另一个内容文件夹时带过去，复制时复制一份。节点自己的 `index.md` 是正文，不进清单。
- 清单的读改写在 `content.xml` 的加锁替换里做（`replaceLocked` 的 `decide` 拿到当前字节重新解析），并发的两个操作不会互相丢条目。改的是有序解析树：注释与条目顺序保留，缩进统一为两格。
- 文件操作先做，清单后改：清单写失败或清单当前不合法时，该项结果为 `done` 且 `manifest: {status: "failed" | "invalid", detail}`（部分完成），不回滚文件操作；下次列出按未列入与缺失规则显示。
- 外部改动不同步清单（不变）。

### 5. 自己操作的回声（`backend/changes.ts`）

t68 只为保存登记了“内容 hash”。操作会让监视报来新建、删除、改名、整棵子树的事件，扩成“预期状态”登记：`{path, state: "absent" | "directory" | {file: hash}, subtree?: true}`。监视报来的路径符合登记的预期就丢弃（删除与移出的目录登记 `absent` 且覆盖子树：递归删除会给每个子项一个事件）；不符合就作为外部变化发出并撤销登记。临时名的过滤改为看路径里任一段（复制用的临时目录下有子项）。

### 6. 浏览器客户端（`web/client.ts`）

`filesKey` 门面加同名方法，按资源地址分派；批量方法另生成 `operation` 并返回 `{operation, result}`，`cancel(operation)` 发出取消。路由层的失败（含 `unknown-outcome` 与 `cause`）原样透出：批量调用结果未知时调用方先重新列出核对。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/workspace/files.md` | “文件操作”一节：方法与名字规则、排他提交、目录项操作与目标操作、复制（链接复制为链接、临时名再放到位、残留报告）、删除（不强删）、批量的预处理与逐项结果、停止条件、取消方法、项数上限、不跨根 |
| `docs/specs/workspace/folder-kinds.md` | 清单维护的细则：条目子树随目录搬、正文不进清单、调整顺序与展示名、转换、清单写失败与清单不合法时的部分完成、注释保留 |
| `docs/specs/workspace/resources.md` | 变更事件加 `renamed` 与 `from`；目录删除只发目录本身 |
| `docs/specs/platform/files.md` | 不改；文件服务按它的目录项与目标操作区分实现 |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 表 | Spec 修订 | `docs:check`、`governance:check` |
| S1 | 第 1 节 | 排他改名、目录项解析、排他新建、复制、删除 | `bun test`：目标已存在时文件与目录的排他改名都失败且目标不变；链接改名与删除作用于链接本身；复制链接不跟随、中途失败不留半棵树；只读子项的目录删除失败且报告已删范围；控制目录名与根外拒绝 |
| S2 | 第 2、4 节 | 单项操作、清单维护与编辑、事件类型 | 快速场地：每个单项操作在普通与内容文件夹各验一次（磁盘、清单、事件）；并发同名新建恰好一个成功；清单不合法与写失败的部分完成；注释保留 |
| S3 | 第 3 节 | 批量操作、去重、逐项结果、取消、停止条件 | 快速场地：父子重叠与重复源、移到自身后代、同目标无操作、单项失败后继续、根不在后停止、取消后未开始项为 `cancelled` 而已完成项不回滚；目录在两个内容文件夹之间移动带走条目子树 |
| S4 | 第 5、6 节 | 回声的预期状态、浏览器客户端、真实项目子进程 | 一次操作只有它自己的精确事件（屏障判定，没有临时名或子项的外部事件）；真实项目子进程里经窗口做一组操作；`smoke:server` 与 e2e 不退化 |
| S5 | — | Spec 标注、Task 证据、三个 omp 实现审查与修正 | `test:affected --typecheck`、全量 e2e、`smoke:server`、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 入口与可观察完成条件 | 片 |
|---|---|---|
| files 验收 2：普通文件与带正文、附件的目录的新建、改名、移动、复制、删除，实际路径与字节；创建内容排他、已有时冲突 | 快速场地，核对磁盘与返回 | S1–S3 |
| files 验收 3：父子重叠、重复源、两个独立资源；移到自身后代拒绝，同目标无操作；单项拒绝后继续，根不在后停止 | 逐项结果与磁盘一致 | S3 |
| files 验收 8：同名目标不覆盖、不合并，同目录复制要求改名，预检后被占用时仍拒绝 | 先建好目标再提交，得到 `conflict`、目标不变 | S1、S3 |
| files 验收 9：目录复制中途失败的残留报告；取消后已完成项不回滚、未开始项不执行 | 只读子目录让复制中途失败；取消在第一项执行中发出 | S3 |
| folder-kinds：经文件服务的子项操作同步清单；调整顺序与展示名只改清单；转换；清单写入失败为部分完成 | 列出结果与清单文本 | S2、S3 |
| resources 验收 5：经文件服务的改名产生带新旧地址的改名事件 | 订阅收到 `renamed` | S2、S4 |

## 验证

- 每片：上表的自跑验证；收口：`test:affected --typecheck`、全量 e2e、`smoke:server`、`docs:check`、`governance:check`。
- 未验证边界：macOS、Windows 的排他改名与大小写不敏感卷（只有 Linux）；跨设备（不同挂载点）的移动不支持，排他改名会失败（`EXDEV`），按 `io-failed` 报告。

## 不做与风险

- 不做：界面、剪贴板、拖动移动（t70）；dirty 文档的复制与移动结算（t71）；跨根搬运；回收站与撤销。
- 风险：`bun:ffi` 在 Bun 里标为实验性。只用它调一个系统调用，封装在 `exclusive.ts` 一处，测试直接验证排他语义；不可用时报 `unsupported`，不静默退回覆盖式改名。
- 风险：清单维护与文件操作不是一个事务。按 Spec 报告部分完成，列出时的未列入与缺失规则兜底。
