# t69 实施计划：Files 竖切二：文件操作

## Context

- **为什么做**：第 6 步 Files 竖切的第二片（[t68 计划的“第 6 步分解”](../t68-files-resource-layer/plan.md#第-6-步分解)）。资源管理器（t70）的新建、改名、移动、复制、删除、创建内容、调整顺序与展示名都落在这里；t68 只交付了列出、读取、条件保存与事件。依据 [`workspace/files.md`](../../../../../docs/specs/workspace/files.md)（操作表、批量与逐项结果、失败与恢复、验收 2、3、8、9）、[`workspace/folder-kinds.md`](../../../../../docs/specs/workspace/folder-kinds.md)（经文件服务的操作同步清单、调整顺序与展示名、转换、用户修正未列入项与缺失条目）、[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)（变更事件）与 [`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md) 的“基础文件操作”（服务侧语义，含“源消失或身份变化时拒绝旧意图”）。
- **已有的底座**（t68）：`nbook.files` 的两份远程合同（`nbook.files/project`、`nbook.files/user`）；受根约束的原语 `backend/rooted.ts`；加锁替换 `src/backend/locked-replace.ts`；变更事件 `backend/changes.ts`；浏览器客户端 `filesKey`；测试场景 `files/testing/scene.ts`。
- **计划审查**：三个 omp 审查（设计与旧行为、运行时与边界、可实现性与测试，证据 `evidences/plan-review-*.txt`）共 31 条，本版已全部并入；取舍记在 [待确认清单](../../pending-confirmations.md) 的 t69 条目。
- **推进方式**：同 t68。不修改 `packages/neuro-book-legacy`。

## 关键设计

### 1. 原语（`backend/rooted.ts`、`backend/exclusive.ts`）

- **排他改名**（`exclusive.ts`，已起草）：`renameNoReplace(source, target)`。Linux `renameat2(RENAME_NOREPLACE)`，macOS `renamex_np(RENAME_EXCL)`，Windows `MoveFileExW(…, 0)`，经 `bun:ffi`；结果 `exists`、`missing`、`unsupported`、`cross-device`、`denied`、`failed`。不支持时不退回覆盖式 `rename`。提交本身就是检查：实现里没有“先查目标再改名”的预检分支。
- **目录项与目标分开**：t68 的 `resolve` 跟随链接，是读写正文用的目标解析。新增两个解析，都先对**完整输入路径**做 t68 的词法门禁（路径形状、控制目录首段），再解析父目录：
  - `resolveEntry(path)`：已存在的目录项。路径不能为空（根本身不能改名、移动、删除、转换）；父目录经 `resolve` 解析（包含、控制目录、根身份）且必须是目录；最后一段只 `lstat` 不跟随。结果带父目录真实路径、名字与目录项身份（dev、ino、类型、birthtime）。改名、移动、删除作用于目录项本身：链接改名就是链接改名，删链接不删目标。
  - `resolveSlot(path)`：将要出现的位置。父目录同上；名字是合法单段，项目根下不是控制目录（大小写不敏感）。
- **目录项身份令牌**：`sha256(dev:ino:birthtimeMs:类型)` 的前 32 位十六进制，不含宿主路径。用来冻结一次操作意图的源（剪贴板、拖动），不是普通文件的持久 id。
- **排他新建**：文件 `open(…, "wx")`，目录 `mkdir`（不递归）；父目录不存在为 `not-found`。
- **复制**：
  - 文件：先写到目标目录里带实例标记的临时名（沿 t68 的临时名规则），复制字节与权限位，再用排他改名放到目标名。失败删掉临时文件；删不掉时把临时文件报告为残留。
  - 目录：按现行验收 9 直接产生副本：先排他 `mkdir` 目标（目标被占用即冲突，此时还没写任何东西），再按名字顺序逐项排他复制子项。中途失败就停下，已产生的部分留在目标处并报告范围（目标根，作为最外层范围），不自动清理。
  - 链接复制为链接（`readlink` 原文、`symlink`，不跟随，不把根外内容拷进来）；设备、FIFO、套接字让这一项失败（`unsupported`），不默默跳过后报成功。
  - 复制到源自身或后代：按源的真实位置（父目录真实路径 + 名字）与目标父目录真实路径判定，在创建任何东西之前拒绝为 `into-itself`；根内目录链接别名同样拦住。
- **删除**：
  - 文件：先核对可写（`access(W_OK)`），只读为 `permission-denied`：Spec 要求“显示为只读的资源仍在服务端拒绝”，POSIX 的 `unlink` 只看父目录权限，必须自己检查。链接直接 `unlink`。
  - 目录：递归删除，子项按同一规则；遇到第一个失败就停（不改权限、不强删），报告已删除的最外层范围；根目录仍在时不宣称它已删除。
- 失败码沿用 t68，新增：`conflict`（目标已存在）、`into-itself`、`unsupported`（文件系统不支持排他改名、跨设备移动、特殊文件）、`source-changed`（源的身份与令牌不符）、`invalid-order`（清单编辑的名字不对）、`busy`（操作锁等不到）。`conflict` 的详情不再要求带基线（只有保存冲突带）。

### 2. 单项操作（`backend/operations.ts`）

合同新增方法（两份合同同一份方法表）：

| 方法 | 输入 | 成功值 |
|---|---|---|
| `identify`（读） | `{paths}`（≤ 1000） | 与输入对齐：`{kind, token}` 或 `{code, detail}` |
| `create` | `{path, kind: "file" \| "directory", before?}` | `{manifests?}`；文件为空 |
| `createContent` | `{path}`（内容树里的节点目录） | `{manifests?}`；排他创建空白 `index.md`，已有为 `conflict` |
| `rename` | `{path, name, expected?}` | `{manifests?}` |
| `convert` | `{path, to: "content" \| "plain", expected?}` | `{manifests?}` |
| `reorder` | `{directory, names}` | 只改清单里该层的顺序；名字不在清单或重复为 `invalid-order` |
| `display` | `{path, title?: string \| null, icon?: string \| null}` | 只改清单里该项的展示名与图标；`null` 去掉 |
| `include` | `{path, before?}` | 把磁盘上已有、未列入清单的项加入清单 |
| `drop` | `{path}` | 从清单移除该条目（缺失条目或用户要移出清单的项），不动磁盘 |

- `expected` 是 `identify` 得到的令牌：执行前与提交前各核对一次，不符为 `source-changed`。核对与系统调用之间的残余窗口沿 [`platform/files.md`](../../../../../docs/specs/platform/files.md) 的说明，不承诺抵御恶意并发替换。
- `manifests` 只在清单没改成时出现：`[{path: <content.xml 的资源路径>, status: "failed" | "invalid", detail}]`。文件操作已完成、清单失败是部分完成，不回滚文件操作。
- **转换**：排他改名加或去 `.content` 后缀。转为内容文件夹时：没有 `content.xml` 就排他新建，条目按当前子项的真实名字与普通排序生成（不含 `content.xml` 本身）；已有就原样保留，不论它合法与否（来回转换保留用户的清单，非法清单在列出时照常报告状态）。去后缀时清单留作普通文件。父目录在内容树里时，父清单里的条目名随之改。
- 名字规则：合法单段，不能为空、`.`、`..`，项目根下不能是控制目录。

### 3. 批量操作（`backend/operations.ts`、`backend/batch.ts`）

- `move`、`copy`：`{operation, items: [{source, target, expected?}]}`；`delete`：`{operation, items: [{path, expected?}]}`；`cancel`：`{operation}` → `{found: boolean}`。目标是完整路径：碰撞时改名或跳过由调用方决定，服务端只排他提交，不自动改名、不覆盖、不合并。只支持同一方案内的移动与复制。
- **预处理**（任何副作用之前）：
  - 源按目录项去重，键是“父目录真实路径 + 名字”（同一 inode 的两个硬链接名是两个目录项）；重复为 `skipped: duplicate`，被另一源目录覆盖为 `skipped: covered`，只操作最外层。
  - `move` 目标就是源本身（同一目录项）为 `done`，无操作、无事件；`copy` 目标就是源本身走正常路径，得到 `conflict`。
  - 移动或复制到自身或后代为 `into-itself`。
- **逐项执行**，结果与输入按下标一一对应：
  - `{status: "done", manifests?}`
  - `{status: "failed", code, detail, partial?: {removed?: Range, residual?: Range}, manifests?}`，`Range = {paths, truncated}`
  - `{status: "skipped", reason: "duplicate" | "covered"}`
  - `{status: "not-run", reason: "root-gone" | "stopped"}`
  - `{status: "cancelled"}`
- **停止**：每项开始前检查三件事：业务取消、根身份、内核传给方法的 `signal`（调用方断线、调用方入口停止、提供入口停止、项目代次结束都会触发）。正在执行的那一项按实际结果结算，之后的项分别为 `cancelled`、`not-run: root-gone`、`not-run: stopped`；已完成的项不回滚。单项业务失败（含局部 `permission-denied`）记下后继续。
- **在途登记**：批量与单项写方法都经 `context.scope.accept` 执行，提供入口停止时等它们结算后才关闭；停止时记一条诊断 `files.batch.stopped`（测试以它为屏障）。
- **取消登记**：每个调用方门面（`provideRemote` 的工厂按调用方生成）持有自己的 `operation → 取消标记` 表，别的窗口命中不了；同一门面里重复的在途 id 为 `busy`；结算后删除。`cancel` 只回答是否命中在途操作，不等批量结束。不用调用方的 `AbortSignal` 做业务取消：内核对已发出的写请求在中止时回 `unknown-outcome`，就拿不到逐项结果了。
- **大小上限**：一次最多 1000 项；输入经 JSON 编码后不超过 `TEXT_BUDGET_BYTES`（与正文同一预算），客户端发出前核对、提供者再核一次，超过为 `too-large`、不发出。结果编码后若超过预算，先把 `Range.paths` 清空并标 `truncated`，再把 `detail` 截到 200 字，保证装进一条消息；调用方按 `truncated` 重新列出核对。
- **结果未知**：断线、超时时客户端得到 `unknown-outcome`。列出只说明当前状态，不能证明旧操作已经停下；调用方不自动重试（Spec 写明）。

### 4. 清单维护与操作锁（`backend/manifest-edit.ts`）

- 在内容树里（最近的 `*.content` 祖先）新建、移入、复制进来追加条目（`before` 指定位置），改名改 `name`，移出与删除去掉条目；条目子树（嵌套 `item` 的展示名）随目录搬：移到另一个内容树时带过去，复制时复制一份。节点自己的 `index.md` 是正文，不进清单。
- **操作锁**：清单只锁 `content.xml` 的读改写不够：窗口 A 改名 a→b 后还没改清单时，窗口 B 改名 b→c，两次都成功而清单只剩 b（运行时审查用真实内核复现）。所以经文件服务、涉及内容树的操作（以及移动、改名目录）取方案根的一把操作锁，覆盖“锁内重新解析源与目标 → 捕获源条目 → 文件提交 → 清单更新 → 发出事件”。锁用 proper-lockfile，放在 t68 的锁目录（`operations.lock`），跨进程有效。实现审查后由“每个内容根一把”改为整根一把：改名内容根本身、搬动含内容根的目录时按内容根分的锁锁不全。单项与批量的每一项都经 `backend/commit.ts` 提交。等锁超时为 `busy`。复制只在捕获源条目与最后提交、改清单时持锁，复制过程本身不持锁。普通文件夹里的操作不取锁。
- 清单的读改写仍在 `content.xml` 的加锁替换里做（与 `write` 用同一把文件锁），改的是有序解析树：注释与条目顺序保留，缩进统一为两格。清单不合法、只读或写失败时不改它，结果带 `manifests`（部分完成）；下次列出按未列入与缺失规则显示。
- 外部改动不同步清单（不变）；用户经 `include`、`drop` 修正。

### 5. 事件与自己操作的回声（`backend/changes.ts`）

- **精确事件**：新建与复制 `created`（目录只发目录本身），移动、改名、转换 `renamed {from, path}`，删除 `deleted`，清单更新是 `content.xml` 的 `changed`；来源同 t68。`renamed` 与 `deleted` 对路径本身及段边界内的全部后代生效（订阅方按前缀替换或清除）。目录删除只在目录实际移除时发 `deleted(目录)`；部分删除发实际已删的最外层路径。事件编码超过预算时推 `resync`。
- **回声**：t68 只登记了保存的内容 hash，扩成预期状态表，键是真实路径：
  - `hash`：保存（不变）；
  - `absent`：删除、移出的每个实际路径（删除时逐项登记，不用整棵子树的通配）；
  - `entry`：新建、复制、移入后的目录项身份。文件与链接比 dev、ino、ctime（外部改内容会变 ctime）；目录只比 dev、ino（往里加子项会改目录的 ctime）。
  - 移动目录后，Bun 的递归监视会在新名字下报来全部后代：移动完成后遍历一次目标子树（只 `lstat`，不读内容）登记后代的身份，同时为源一侧的后代登记 `absent`。后代超过 1000 个时不逐个登记，改为在下一批推 `resync`。
  - 监视报来的路径符合登记就丢弃，不符合就作为外部变化发出并撤销该条登记；登记带时间，60 秒（注入时钟）后过期，监视关闭时清空：外部的真实修改总会让状态不符，寿命只为回收内存。

### 6. 浏览器客户端（`web/client.ts`）

- `filesKey` 门面加同名方法，按资源地址分派；批量里的地址必须同一方案，否则发出前失败为 `invalid-address`。
- 批量方法同步返回句柄 `{result: Promise<FilesResult<BatchResult>>, cancel(): Promise<FilesResult<{found: boolean}>>}`：`operation` 由客户端生成，方案与 id 都在闭包里，调用方不用记 id 也不需要反查表。
- 发出前按第 3 节核对项数与字节预算。路由层的失败（含 `unknown-outcome` 与 `cause`）原样透出。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/workspace/files.md` | “文件操作”一节：方法表、名字规则、排他提交（提交即检查）、目录项与目标、身份令牌与 `source-changed`、复制（文件经临时名，目录直接产生并在失败时报告残留，链接复制为链接、特殊文件失败）、删除（只读拒绝、遇错即停、已删范围）、批量预处理与逐项结果形状、停止条件（含内核信号）、取消方法与句柄、项数与字节预算、结果未知不自动重试、不跨根不跨设备；新增失败码 |
| `docs/specs/workspace/folder-kinds.md` | 清单维护细则：操作锁、条目子树随目录搬、正文不进清单、调整顺序与展示名、`include` 与 `drop`、转换时已有清单原样保留、部分完成的 `manifests` |
| `docs/specs/workspace/resources.md` | 变更事件加 `renamed {from}`；`renamed`、`deleted` 的前缀规则；部分删除的事件 |
| `docs/specs/platform/files.md` | 不改 |

## 切片

每片的写操作同时补客户端方法与它需要的回声登记，测试经真实窗口门面（`files(scene.window)`）或真实远程合同（`remote(scene.window).use(projectFilesContract)`）调用，不直接调用后端函数。

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 表 | Spec 修订 | `docs:check`、`governance:check` |
| S1 | 第 1 节 | 排他改名、`resolveEntry` 与 `resolveSlot`、身份令牌、排他新建、复制、删除 | `backend/exclusive.test.ts`、`backend/primitives.test.ts`：目标已存在（文件、空目录、悬空链接）时排他改名失败且两边不变；`.nbook`、`.NBOOK` 作为源与目标都拒绝，根本身拒绝；链接改名与删除作用于链接本身；复制链接不跟随；复制到自身后代（含链接别名）在创建前拒绝；目录复制遇不可读文件（模式 000）停下并报告残留、源不变；文件复制失败无临时文件残留；删除只读文件拒绝；父目录不可写时递归删除停下并报告已删范围 |
| S2 | 第 2、4、5、6 节（单项） | 单项操作、`identify`、清单编辑与操作锁、精确事件、回声、客户端方法 | `operations.test.ts`、`manifest-edit.test.ts`：每个方法在内容树与普通文件夹各验（内容专属方法在普通文件夹拒绝且无副作用）；`a→b`、`b→c` 并发后清单与磁盘一致；`content.xml` 只读或不合法时文件已改、清单字节不变、结果带 `manifests`、不发清单 `changed`；转换来回保留清单字节，已有非法清单不被覆盖；`include`、`drop`；注释保留；事件来源与 `from`，屏障内没有外部回声；操作后外部换掉同名目录、移动后外部改子文件仍发出 |
| S3 | 第 3、6 节（批量） | 批量、预处理、逐项结果、取消、停止、预算 | `batch.test.ts`：父子重叠与重复源（含链接别名、硬链接两名不误去重）；`move` 同目标无操作、`copy` 同目标冲突；身份令牌：剪切后同路径换成同字节文件被拒、换掉的文件保留；取消：外部持有 `content.xml` 的锁把第一项挡在清单更新，确认目标已落盘后取消命中，放锁后第一项 `done`、第二项 `cancelled` 且无副作用；调用方窗口关闭与提供入口停止各一例，以 `files.batch.stopped` 诊断为屏障核对后续项没执行；根在中途消失；跨两个内容树移动只一侧清单失败；结果超预算时 `truncated` |
| S4 | — | 真实项目子进程与真实 WebSocket | `project-child.test.ts`、`transport.test.ts` 增补：经真实窗口对项目子进程做一组操作并收到精确事件；预算内与超预算的批量经真实 WebSocket（超预算在客户端拒绝、连接不断）；项目子进程停止时批量停下；`smoke:server` 与 e2e 不退化 |
| S5 | — | Spec 标注、Task 证据、三个 omp 实现审查与修正 | `test:affected --since`、`typecheck`、全量 e2e、`smoke:server`、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 入口与可观察完成条件 | 片 |
|---|---|---|
| files 验收 2：普通文件与带正文、附件的目录的新建、改名、移动、复制、删除；创建内容排他 | 磁盘路径与字节；副本含正文与附件且源不变；`createContent` 已有时冲突、原字节不变 | S1–S3 |
| files 验收 3：父子重叠、重复源、独立资源；移到自身后代拒绝，同目标移动无操作；单项拒绝后继续；绑定或授权失效后停止 | 逐项结果与磁盘一致；停止覆盖根消失、调用方关闭、提供入口停止 | S3、S4 |
| files 验收 8：同名目标不覆盖、不合并，同目录复制要求改名，预检后被占用仍拒绝 | 目标先存在时冲突且两边不变；两个窗口同时复制到同一目标恰好一个成功；排他原语直接测文件、空目录、悬空链接 | S1、S3 |
| files 验收 9：目录复制中途失败保留残留并报告范围；取消不回滚已完成项、不执行未开始项 | 不可读文件让目录复制停下，`residual` 与磁盘一致；锁屏障下的取消 | S1、S3 |
| files-explorer：源消失或身份变化时拒绝旧意图 | `identify` 令牌在替换后得到 `source-changed` | S3 |
| folder-kinds：经文件服务的子项操作同步清单；调整顺序与展示名只改清单；转换；用户修正未列入与缺失；清单失败为部分完成 | 列出结果与清单原文；`manifests` 指明哪份清单 | S2、S3 |
| resources 验收 5：经文件服务的改名产生带新旧地址的改名事件 | `renamed` 带 `from` 与来源；屏障内没有外部回声 | S2、S4 |

## 验证

- 每片：上表的自跑验证与变异检查（每条判据各一个变异，例如排他改名换成普通 `rename`、去掉复制的后代检查、停止条件不看 `signal`、回声目录只比类型、去掉操作锁）。收口见 S5。
- 未验证边界：macOS、Windows 的排他改名与大小写不敏感卷（只有 Linux）。“预检之后、提交之前目标被占用”没有不加产品钩子的确定性屏障：实现里没有预检分支，排他性全由原语承担，原语与“目标先存在”的测试覆盖它，两个窗口同时复制只作竞态冒烟。root 用户、ACL 下的权限场景不测（测试以普通用户运行，root 时跳过权限用例）。

## 不做与风险

- 不做：界面、剪贴板、拖动（t70）；dirty 文档的复制与移动结算（t71）；跨根搬运；跨设备移动；回收站与撤销；结果未知后的操作状态查询（调用方按当前状态核对）。
- 风险：`bun:ffi` 在 Bun 里标为实验性。只调一个系统调用，封装在 `exclusive.ts` 一处；不可用时报 `unsupported`。
- 风险：清单维护与文件操作不是一个事务。操作锁保证经文件服务的操作之间顺序一致；外部改动与写失败按部分完成报告，列出时的未列入与缺失规则兜底。
