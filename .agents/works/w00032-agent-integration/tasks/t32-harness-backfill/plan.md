# t32 实施计划：把落在 nbook.agent 里的通用部分补回 nb-harness

## Context

本稿（第三稿）按开发者 2026-11-10 的四条决定（[README](README.md) 的“决定”表）修订第二稿：`ask` 直接用 nb-form 的核心入口校验表单，nb-form 的 `nb-ui`、`vue` 改为可选 peer，模型规则不在本 Task 搬。第二稿对第一轮计划审查与独立设计的处理见 README 的“计划第一稿的处理”。

[t02](../t02-harness-baseline/README.md) 决定 3 按“离开 NeuroBook 还能不能用”分工，资源地址的登记机制、审批判定、压缩、通用文件工具归 harness。之后 t06、t11、t12 把压缩方法、审批判定、守卫、会话句柄表、通用工具、资源视图写进了 `nbook.agent`。模型角色与压缩触发点的规则（`nbook.models` 的 `shared/rules.ts`、`shared/compaction.ts`）由 [w00043 t02](../../../w00043-neurobot/tasks/t02-host-base/README.md) 连同模型服务搬进新包 `nb-models`，本 Task 不碰 `nbook.models`。NeuroBot（[w00043](../../../w00043-neurobot/README.md)）在 nb-runtime 上自建、要复用这些能力，而领域包不许依赖应用包（[`packages/AGENTS.md`](../../../../../packages/AGENTS.md)、[`docs/modules/monorepo-boundaries.md`](../../../../../docs/modules/monorepo-boundaries.md)）。本 Task 把实现补回 `packages/nb-harness`，用户可观察的行为、贡献 id、设置、日志里的字符串与界面都不变；唯一的例外是会话句柄表的两个错误类（类名与停止时的消息），列在 baseline 的“预期差异”里。

期望结果：nb-harness 多一层“宿主套件”（`src/kit/`），只用内核的公开入口写成，不认识 NeuroBook；`nbook.agent` 只剩贡献点接线、NeuroBook 的地址方案与文字、Agent 模式、设置与界面。NeuroBot 拿 kit 加自己的文件访问实现（`SessionFiles`）与文字，就能装出同样的工具、审批、压缩与会话管理。

依据：[ADR 0035](../../../../../docs/adr/0035-harness-log-driven-kernel.md)（扩展只用公开接口、常见写法做成 helper）、[ADR 0040](../../../../../docs/adr/0040-file-writes-staged-and-committed-by-root-owner.md)（读不经文件服务，写只经暂存与根拥有者提交）、[ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)（以源码发 npm，源码值导入的第三方包写进本包的 dependencies 或 peerDependencies）、[ADR 0031](../../../../../docs/adr/0031-nb-story-supports-windows.md)、[t08](../t08-resources-home/README.md) 实施前决定 1（方案都注册进文件服务）、[t11](../t11-compaction/README.md) 决定 5（摘要小节按写小说定）、[NeuroBot 提案](../../../../../docs/proposals/neurobot.md)。

开发者已确认：

- 2026-11-09：按 t02 决定 3 补回 nb-harness、不新建包，与 t14 的界面静态稿阶段并行；NeuroBot 要让另一个 bot 判定工具调用，本 Task 不实现，但判定接口不能写死判定者（w00043 决定表）。
- 2026-11-10：NeuroBot 提案待定项 1 选 (b)，模型服务（`packages/neuro-book/src/plugins/models/backend/core.ts`：按角色解析模型、服务商与模型配置、OMP 凭据库、给 harness 的模型端口）由 [w00043 t02](../../../w00043-neurobot/tasks/t02-host-base/README.md) 抽成两边共用的包；本 Task 不碰 `packages/neuro-book/src/server/`、`packages/neuro-book/src/web/`。
- 2026-11-10：开发者同意 w00043 t02 新建 `nb-models`，`models/shared/rules.ts`、`models/shared/compaction.ts` 改由 t02 搬进 `nb-models`。本 Task 不搬模型规则、不加 `./models/rules` 子路径，不改 `packages/neuro-book/src/plugins/models/` 下任何文件（要搬的代码没有引用它，只有留下的 `agent.ts`、`plugin.ts` 引用 `models/shared/contracts`）。kit 要用的压缩角色 id 留在 `kit/shapes.ts` 的 `MODEL_ROLES`；`nb-models` 的内置角色表必须包含它的每个 id，断言由 t02 写（从 `@notnotype/nb-harness/kit/shapes` 取，所以 t02 的这一步在本 Task 合入之后）。
- 2026-11-10：nb-harness 直接依赖 `@notnotype/nb-form`，但只导入它的核心入口（`.`：表单描述、检查、解析、校验；运行时只依赖 TypeBox，对 nb-ui 只 `import type` 自 `@notnotype/nb-ui/text`，由 `packages/nb-form/src/boundary.test.ts` 守着），不导入 `./vue`、`./locales`、`./lab-sources`；表单怎么画由各宿主决定。nb-harness 加一条导入边界测试守住这一点。第二稿的 `AskForms` 注入删去。
- 2026-11-10：nb-form 的 `@notnotype/nb-ui` 从 `dependencies` 改为 `peerDependencies`，与 `vue` 一起标为可选 peer（只有 `./vue` 用到），并加进 nb-form 的 `devDependencies` 供它自己的测试与类型检查用，目的是装 nb-story 时不连带装上 Vue 一套。同一目的下本稿把 peer `typescript` 也标为可选（理由见那一节）。这是公开包的依赖变化，按 [`packages/AGENTS.md`](../../../../../packages/AGENTS.md)“发布合同变化先记为跨 Module 决策”，以 Task README“决定”表的这一条为记录，放进本 Task 第 1 片（见“`packages/nb-form/package.json`”一节）。
- 2026-11-10：压缩摘要的小节由应用决定：只由宿主在建方法时给，不做按 Profile 换。
- 2026-11-10：新增的公开子路径按推荐同意，清单按本稿的目录：`./kit/shapes`、`./kit/files`、`./kit/files/local`、`./kit/testing`、`./kit/commands`、`./kit/tools`、`./kit/approval`、`./kit/compaction`、`./kit/guards`、`./kit/sessions`，目录名 `src/kit/`；其中只有 `./kit/shapes`、`./kit/files` 可进浏览器。按 `packages/AGENTS.md`，这条 exports 变化以 Task README“决定”表为跨 Module 决策的记录。

工作方式与约束：

- 代码在 worktree 里改；Spec 与 Task 记录在主工作区 master 上改（新 Spec `harness/host-kit.md` 在开工前，其余在代码合入之后，见“Spec 与文档改动”）。
- 每片搬完就删掉应用里的旧文件、改完全部调用方，不留转发的旧入口（[`common.md`](../../../../../docs/standards/code/common.md)“迁移完整切换消费者并删除旧入口”）。公开入口（`nbook/plugins/agent/shared/*`、`nbook/plugins/files/shared/contracts`、SDK 的 `nbook/sdk/agent`）的导出名不变，需要时改成从 harness 转出。
- 另一个会话在做 t14（多 Agent 的界面静态稿）。本 Task 不碰 t14 的记录与草稿；t14 的前后端实施在本 Task 合入之后开始，它的通用部分直接写进 `nb-harness/src/kit/`。

## 技术选型

| 通用问题 | 选用 | 理由；否决 |
|---|---|---|
| `bash` 命令解析 | `unbash`（已在 `packages/neuro-book` 依赖里，6.0.3，纯 JS、无依赖、ISC） | 随 `bash-dialect.ts` 原样搬进 nb-harness 的 `dependencies`，应用包去掉这条依赖；不换库 |
| 行锚编辑、搜索、内嵌 shell、`hashline` 排版 | `@oh-my-pi/pi-natives`（nb-harness 已依赖，版本 18.14.0 已锁） | 现有实现就用它；不引 `pi-coding-agent`（包规则禁止） |
| `ask` 的表单检查与校验 | `@notnotype/nb-form` 的核心入口（仓库已有，`ask` 现在就用它） | 写进 nb-harness 的 `dependencies`；只导入 `.`（`checkDescription`、`resolveForm`、`validateForm`）。nb-form 的 `nb-ui`、`vue`、`typescript` 改为可选 peer，装 nb-story 时不再连带装 Vue 组件库。否决“宿主注入校验”（开发者 2026-11-10 定） |
| 图片缩放 | `Bun.Image`（现有实现，nb-harness 内核的 `model/omp.ts` 已在用） | 不加库 |
| 路径通配 | `Bun.Glob`（规则求值现有实现） | 不加库 |
| 合同测试的运行器 | `bun:test`（`./kit/testing` 作为发布的源码导入它，照 `./kernel/testing` 的先例） | `scripts/release/packages.ts` 对 `bun:` 前缀直接放行，不进依赖表 |

没有用库替换手写实现的地方，不需要对照测试切片。

## 关键设计

### 总体：`packages/nb-harness/src/kit/`

新目录 `src/kit/`（宿主套件）：宿主把内核装成产品时用的通用件。规则：

- 只经内核的公开入口引用内核（`../../kernel/index.js`、`../../kernel/contracts.js`），不引 `kernel/` 内部文件，也不引旧 harness（`src/*.ts`、`src/tools/`）与 `src/models/`。这与 ADR 0035“常见写法只用公开接口写成”一致，也让 t31 删旧实现、把 `kernel/` 上移一层时只改这一处导入前缀。
- 子目录单向依赖，由 `src/kit/architecture.test.ts` 按目录表检查（写法照 `src/kernel/architecture.test.ts`：TypeScript 语法树读出导入，区分值导入与 `import type`，登记可依赖的目录、包与内置模块）：

| 目录 | 可依赖的 kit 目录 | 外部包 | 内置模块 |
|---|---|---|---|
| `shapes.ts`（单文件） | — | `typebox`；`kernel/contracts.js` 只许 `import type` | 无 |
| `files/`（`local.ts` 除外） | `shapes` | `kernel/contracts.js` 只许 `import type` | 无 |
| `files/local.ts` | `files` | — | `node:fs/promises`、`node:path`、`node:crypto` |
| `testing/` | `files` | — | `bun:test` |
| `commands/` | — | `unbash` | — |
| `tools/` | `files`、`commands`、`shapes` | `@oh-my-pi/pi-natives`；`@notnotype/nb-form`（只许这个根说明符，不许子路径） | `node:fs`、`node:fs/promises`、`node:os`、`node:path` |
| `approval/` | `files`、`commands`、`shapes` | `typebox` | — |
| `compaction/` | `files`、`tools`、`shapes` | — | `node:fs/promises` |
| `guards/` | — | — | `node:crypto` |
| `sessions/` | — | — | `node:crypto` |

- 浏览器可用的子路径有两个：`./kit/shapes`、`./kit/files`。`kit/architecture.test.ts` 从这两个入口文件顺着相对导入走完整条链：值导入只许 `typebox`，类型导入只许 `kernel/contracts.js`，不许 `node:`、`bun:`、OMP、`pi-natives` 与 `@notnotype/nb-form`。`kernel/contracts.js` 已经被浏览器经 `agent/shared/remote.ts` 值导入（`commandErrors`、`storageErrors`），这两条链不新增它之外的内核文件。
- nb-form 的导入边界：同一个架构测试另有一条，扫 nb-harness `src/` 下全部非测试源码（含旧 harness 与内核），说明符以 `@notnotype/nb-form/` 开头的（`./vue`、`./locales`、`./lab-sources` 与以后加的子路径）一律越界，以 `@notnotype/nb-ui` 开头或为 `vue` 的也越界（含 `import type`：nb-harness 自己不需要 nb-ui 的类型）；并核对 nb-harness `package.json` 的 `dependencies` 不含 `@notnotype/nb-ui` 与 `vue`。上表只让 `tools/` 导入 `@notnotype/nb-form` 这个根说明符，两条合起来守住“只用 nb-form 的核心入口”。核心入口本身只依赖 TypeBox，由 nb-form 自己的 `src/boundary.test.ts` 守，这里不重复。
- 同一个架构测试守住 ADR 0040 在 harness 这一侧的不变量“工具不自己写盘”，按白名单检查 `tools/`、`compaction/`、`approval/`：对 `node:fs`、`node:fs/promises` 只许具名导入只读的函数（`open`、`stat`、`lstat`、`readFile`、`readdir`、`realpath`、`createReadStream`），禁止命名空间导入与默认导入；源码里不许出现 `Bun.write`、`Bun.file(…).write`、`.writer(`、`Bun.$`、`Bun.spawn` 与动态 `import(`。唯一例外是 `tools/shell.ts`：输出暂存（`mkdtempSync`、`openSync`、`writeSync`、`closeSync`、`rmSync`，在 `os.tmpdir()` 里，不在任何根里）与 `pi-natives` 的 `executeShell` 执行入口，按文件名单独放行。写盘只在 `files/local.ts`（本机参考实现）。
- 子路径导出（`package.json` 的 `exports`，公开合同变更，开发者 2026-11-10 已同意，见 Context）：`./kit/shapes`、`./kit/files`、`./kit/files/local`、`./kit/testing`、`./kit/commands`、`./kit/tools`、`./kit/approval`、`./kit/compaction`、`./kit/guards`、`./kit/sessions`。每个条目随第一次用到它的那片一起加（第 1 片先加 `./kit/shapes`），`kit/architecture.test.ts` 同时核对 `exports` 只列已建的入口。
- 文字：NeuroBook 专有的说明文字、提示词、扩展 id、日志里会出现的原因串与诊断消息都由宿主传入；kit 只留与应用无关的文字（放回的提示、shake 的占位、循环守卫的提醒、摘要输入的排版）。kit 不给宿主文字缺省值，免得出现第三套要维护的提示词。

### `packages/nb-harness/src/kit/files/`：文件访问接口（设计问题 1、2）

现在的依赖：工具、放回与审批都经 `SessionResources`（`agent/shared/resources.ts`，`WorkspaceFiles` 按会话绑定）读写，并直接引用 `nbook/plugins/files/shared/contracts` 的 `decodeText`、`renderVirtual`、`parseAddress`、`Baseline`。实际用到的只有 `expand`、`classify`（只看写是不是 `ask`）、`readPath`、`read`、`list`、`call(call)` 之后的 `write`/`read`，以及 `SessionArtifacts.save`；`update`、`stage`、`move`、`copy`、`delete` 等内置代码都没用。接口就按用到的定，方法名与 `SessionResources` 一致，NeuroBook 的现有对象结构上直接满足，只补一个布局：

```ts
/** 失败码是开放字符串；kit 按码分支的那几个见 KNOWN_FILE_FAILURES，其余码（宿主自己的，例如 `no-project`）原样交给模型。 */
export type FileFailure = {readonly ok: false; readonly code: string; readonly detail: string};
export type FileResult<T> = {readonly ok: true; readonly value: T} | FileFailure;
export const KNOWN_FILE_FAILURES = ["not-found", "unknown-scheme", "unsupported-capability", "invalid-address", "protected-path", "outside-root", "not-a-file", "not-a-directory", "permission-denied", "conflict", "too-large", "cancelled"] as const;
/** 读到的内容的指纹；只用来交回给 `write` 的 `expect`，kit 不解读。 */
export interface Baseline { readonly hash: string }
export type WriteExpect = Baseline | "absent" | "any";
export interface Located { readonly path: string; readonly kind: "file" | "directory" | "other" }
export interface DirectoryListing { readonly entries: ReadonlyArray<{readonly name: string; readonly kind: string}> }
/** 虚拟根：条目带全局地址，读根本身得到 `renderVirtual` 的文字。 */
export interface VirtualListing {
    readonly kind: "virtual";
    readonly description: string;
    readonly entries: ReadonlyArray<{readonly address: string; readonly title?: string; readonly meta?: Readonly<Record<string, string>>}>;
}

export interface FileCalls {
    read(address: string, options?: {readonly signal?: AbortSignal}): Promise<FileResult<{readonly bytes: Uint8Array; readonly baseline: Baseline}>>;
    write(address: string, content: Uint8Array | string, options: {readonly expect: WriteExpect; readonly createParents?: boolean; readonly signal?: AbortSignal}): Promise<FileResult<{readonly baseline: Baseline}>>;
}

/** 一个会话看到的文件：地址可以是单数写法，进来先改写。宿主按调用时的 `ToolSessionContext` 现建，不按会话缓存（换 Profile 后要按新上下文）。 */
export interface SessionFiles extends FileCalls {
    readonly layout: SessionLayout;
    /** 单数地址改写成全局地址，全局地址原样通过（幂等）；同步、不碰磁盘。 */
    expand(address: string): {readonly ok: true; readonly address: string} | FileFailure;
    /** 写这个地址要不要另外问用户：`ask` 时别的规则放行也问（permissions.md 输出 7）。 */
    classify(address: string): {readonly write: "allowed" | "ask" | "denied"} | FileFailure;
    /** 本机读路径，调用方自己读（ADR 0040 决策 1）；`<方案>://` 在方案没登记时为 `unknown-scheme`，虚拟根为 `unsupported-capability`。 */
    readPath(address: string, options?: {readonly signal?: AbortSignal}): Promise<FileResult<Located>>;
    list(address: string, options?: {readonly signal?: AbortSignal}): Promise<FileResult<DirectoryListing | VirtualListing>>;
    /** 绑定一次工具调用：经它的写入属于这次调用（来源带 `callId`，宿主据此分组）；`signal` 合进每次调用。工具每次执行只调一次并复用。 */
    call(call: {readonly callId: string; readonly signal: AbortSignal}, info?: {readonly title?: string}): FileCalls;
}

/** 这个会话的地址布局：kit 不写死任何方案。只放与文件访问和判定有关的；计划文件、日志、项目根由用到它的块各自的选项给。 */
export interface SessionLayout {
    /** `shell` 的工作目录与 `grep`、`glob` 的缺省根（可写单数地址）。 */
    readonly working: string;
    /** 模式闸门的草稿根：写只落在这里算“只写草稿”（agent/modes.md 输出 1）。 */
    readonly scratch: readonly string[];
    /** `auto` 不问审批者的写的根（permissions.md 输出 19）。 */
    readonly localWrites: readonly string[];
    /** `shell` 的环境变量：名 → 地址；定位不到真实路径的不设。 */
    readonly shellEnv: Readonly<Record<string, string>>;
    /** 以这个全局地址为根搜索时不扫的子目录（以 `/` 开头）。只省下无谓的读，授权仍以 `readPath` 为准。 */
    searchExcludes(root: string): readonly string[];
}

/** 宿主身份保存大结果的全文（resources.md 输出 11）：Agent 自己写不了这里，所以与 `SessionFiles` 分开。 */
export interface ArtifactStore {
    save(label: string, write: (sink: {write(chunk: Uint8Array): Promise<void>}) => Promise<void>): Promise<FileResult<{readonly address: string}>>;
}

/** 工具工厂拿到的服务。 */
export interface KitServices { readonly files: SessionFiles; readonly artifacts: ArtifactStore }
/** 审批、放回、内核资源接口用的工厂。`owner` 是用它的工具 id，作分组的缺省标题；不属于哪个工具时为 null。 */
export type SessionFilesFactory = (context: ToolSessionContext, owner: string | null) => SessionFiles;
```

“必须询问的写”由 `classify` 表达，不在布局里另设字段：`SessionResources` 已有同名方法，NeuroBook 不需要适配；NeuroBot 的实现同样必须给它。

同目录还有（都不引 node，经 `./kit/files` 交出）：`decodeText`（严格 UTF-8、BOM 留在文字里、含 NUL 的不是文字）与 `renderVirtual`（现 `files/shared/text.ts`、`files/shared/schemes.ts`，整个搬来，参数改成上面的结构类型）、`joinAddress`、`schemeOf`、`failed`/`failure`（把失败码同时放进结果与 `details.code`，现 `builtin/common.ts`）、`kernelResources(files): Resources` 与 `ResourceReadError`（现 `backend/resources.ts` 末尾，参数改成 `Pick<SessionFiles, "expand" | "read">`）。`decodeText`、`renderVirtual` 只留这一份：`nbook.files` 的 `shared/text.ts`、`shared/schemes.ts` 改成从 `@notnotype/nb-harness/kit/files` 转出，`files/shared/contracts.ts` 的导出名不变，文件服务、写入接口与 Agent 对“是不是文字”“虚拟根的文字”因此不会分叉。`files/shared/contracts` 被浏览器值导入（`editor/web`、`html-preview/web`），这就是 `./kit/files` 必须不引 node 的原因，`localFiles` 因此放在单独的子路径。

`files/local.ts`（`./kit/files/local`）：本机实现 `localFiles({roots, aliases, layout, classify, artifacts})`，方案名映射到本机目录，`..` 与经链接逃出根的得 `outside-root`；`write` 按基线核对后写临时文件再改名；`call` 不分组、不记来源；`classify` 必传，不给缺省值（缺省成 `allowed` 会让 bot 在放行写入下改掉自己的规则）。它的定位是 kit 测试的真实依赖（[测试写法](../../../../../docs/testing/README.md#测试写法)“依赖用真的”）与参考实现，不是 NeuroBot 的正式实现：NeuroBot 提案要的写锁、改动记录与按会话的来源限制都在 NeuroBot 自己的 `SessionFiles` 里（可以包 `localFiles`）。

`src/kit/testing/files-contract.ts`（`./kit/testing`）：参数化的 `SessionFiles` 合同测试 `sessionFilesContract(name, setup)`，`setup` 交回被测对象与夹具（一个可写的根地址，可选的虚拟根、受保护地址与未登记的方案）。逐条覆盖 `harness/host-kit.md` 的输出：`KNOWN_FILE_FAILURES` 每个码在对应情形出现、失败经结果交回而不抛错；`expand` 幂等；`readPath` 的三种 `kind`、对 `<方案>://` 的探测；`read` 与 `write` 的基线（`expect` 为旧基线得 `conflict`、`absent` 对已存在得 `conflict`、`any` 覆盖、取消后目标不变）；`list` 的两种形状。`localFiles` 在 `kit/files/local.test.ts` 里跑它，NeuroBook 的 `sessionFiles` 在 `agent/resources.test.ts` 里经真实插件跑它，两个实现对过同一份契约之后，搬进 kit、改跑 `localFiles` 的工具用例才算“替身对过契约”（[测试写法](../../../../../docs/testing/README.md#测试写法)）。

搬走的文件引用留下的文件，逐个处理：

| 引用 | 处理 |
|---|---|
| `builtin/common.ts` → `shared/resources`（`Expanded`、`SessionResources`） | 换成 `SessionFiles`；`globalAddress` 改用 `files.expand` |
| `read.ts` → `decodeText`、`renderVirtual` | 用 kit 的同名函数；虚拟根照旧由 `list` 交回 `kind: "virtual"`，截断与“还有几项”的文字由 kit 拼，和现在一样 |
| `edit.ts` → `Baseline` 类型 | kit 的 `Baseline` |
| `search.ts` → `parseAddress`（只为跳过项目根的 `.nbook/`） | `layout.searchExcludes(root)` |
| `shell.ts` → `workingAddress`、`NBOOK_PROJECT`/`NBOOK_SESSION` | `layout.working`、`layout.shellEnv` |
| `preview.ts` → `shared/remote` 的 `ApprovalPreview` | kit 在 `shapes.ts` 定 `FilePreview`（同形状），`shared/remote.ts` 的 `ApprovalPreview` 改为它的别名（`import type`） |
| `compaction/restore.ts` → `WorkspaceFiles`、`sessionResources`、`decodeText`、`session://plan.md`、`sessions://<id>/session.jsonl` | `SessionFilesFactory`；放回的选项 `planOf`、`logOf` |
| `permissions/hook.ts` → `WorkspaceFiles`、`sessionResources`、`workingAddress`、`project://`、`session://`、`tmp://`、`readProjectRules` | `SessionFilesFactory` 与 `layout`；项目规则改为选项 `projectRules(context, signal)`，`project-rules.ts` 留在应用；`project://` 只剩审批模型要，改为 `modelReviewer` 的 `projectOf` |
| `permissions/modes.ts`（留在应用）→ `builtin/common` 的 `failed` | 改从 `@notnotype/nb-harness/kit/files` 取，其余不动 |

NeuroBook 的实现留在 `packages/neuro-book/src/plugins/agent/backend/resources.ts`：现有 `sessionResources`、`sessionArtifacts`、`bind`、`lazy`、`expand`、`classify` 不动（它们也是第三方工具 `services.resources` 的实现，SDK 合同不变），新增

- `sessionLayout(context)`：`working` 有主项目为 `project://`、否则 `session://`；`scratch` 为 `session://`、`tmp://`；`localWrites` 再加有主项目时的 `project://`；`shellEnv` 为 `NBOOK_SESSION → session://`，有主项目时另加 `NBOOK_PROJECT → project://`；`searchExcludes` 对 `projects://<名>`（用 `parseAddress` 判断）交回 `["/.nbook"]`。
- `sessionFiles(resources, context): SessionFiles`：`{...resources, layout: sessionLayout(context)}`；返回类型标注就是编译期检查，`SessionResources` 的方法一旦与接口失配就编译失败。`sessionArtifacts` 原样当 `ArtifactStore`（签名已一致）。
- `filesFor(files: WorkspaceFiles): SessionFilesFactory`：`(context, owner) => sessionFiles(sessionResources(files, context, owner), context)`，在 `agent.ts` 建一次，交给审批钩子、放回与 `kernelResources`；`plugin.ts` 的审批预览也用它。工具仍经 `AgentTools` 的 `services` 拿 `SessionResources`，由包装层套上布局。`filesFor` 只在 `nbook.agent` 内部传递，不进 `AgentService`：别的插件拿不到能代表会话的读写，这条不变量不变。

这样 ADR 0040 的保证原样保住：读按读授权拿本机路径后自己读；写都经 `WorkspaceFiles.write`/`stage`，带 `as: {agent: {session, profile, entry}}`，由拥有根的进程在锁里提交并记账，同一次调用一个操作分组；全文以宿主身份经 `stage` 写进 `artifacts/`。t08 的方案注册（`backend/schemes.ts` 的五个方案经 `files.schemes`）不动。

### 资源视图与地址怎么切（设计问题 2）

t02 决定 3 的“资源地址的登记机制”归 harness，在 kit 里是 `SessionFiles`/`SessionLayout` 这份合同（`harness/host-kit.md`）与建在它上面的 `kernelResources`：宿主经它把“地址怎么改写、怎么定位、怎么写、哪些根有特殊含义”交给 kit。kit 只持有地址的形状（`joinAddress`、`schemeOf`）；地址的完整校验（`parseAddress`）、单数别名表、方案注册与授权属于宿主的文件服务（NeuroBook 是 `nbook.files`，[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)），留在应用，kit 不另写一份地址解析器。

| 文件 | 去向 |
|---|---|
| `agent/backend/resources.ts` | `kernelResources`、`ResourceReadError` 进 `kit/files/`；其余留下，并加 `sessionLayout`、`sessionFiles`、`filesFor` |
| `agent/backend/schemes.ts` | 全部留下（具体方案与映射目录） |
| `agent/shared/resources.ts` | 全部留下、不改（SDK 的 `AgentToolServices`） |
| `files/shared/text.ts`、`files/shared/schemes.ts` 的 `renderVirtual` | 实现进 `kit/files/`，这里改为转出；`VirtualListing`、`VirtualEntry` 类型留在 `nbook.files`（结构上满足 kit 的类型） |

### `packages/nb-harness/src/kit/commands/`

`bash-dialect.ts`、`dialects.ts`（`Dialects`、`createDialects`、`commandEffect`）原样搬来，`bash-dialect.test.ts` 跟着搬。`tools/shell.ts` 与 `approval/hook.ts` 都用它，放在两者之下，避免 `tools` 与 `approval` 互相依赖。

### `packages/nb-harness/src/kit/tools/`（设计问题 6）

搬来 `read.ts`、`image.ts`、`write.ts`、`edit.ts`、`search.ts`、`shell.ts`、`shell-address.ts`、`ask.ts`，`preview.ts` 的试算部分，以及 `common.ts` 里的 `SessionEditStores` 与 `read.ts` 的 `renderSnapshot`（合成 `snapshot.ts`，放回也用）。每个工具交出：

```ts
export interface KitTool {
    /** 声明里序列化得了的部分；宿主补 id、`provider`、`providerName`。 */
    readonly declaration: {readonly description: string; readonly parameters: Readonly<Record<string, unknown>>; readonly version: string; readonly concurrency: "shared" | "exclusive"; readonly effect: ToolEffect; readonly customFormat?: {readonly syntax: "lark"; readonly definition: string}};
    create(context: ToolSessionContext, services: KitServices): ToolImplementation;
    effect?(args: Readonly<Record<string, unknown>>): ToolEffect;
    subjects?(args: Readonly<Record<string, unknown>>): readonly ToolSubject[];
}
export interface BuiltinToolTexts {
    /** `read`、`write` 的 `path` 参数说明（NeuroBook：“资源地址，例如 project://正文/第一章.md、session://plan.md”）。 */
    readonly pathParameter: string;
    /** `edit` 两种模式说明末尾的一段。 */
    readonly editNote: string;
    /** `shell` 的整段说明（工作目录、地址替换、环境变量、全文存哪里都是宿主的事实）。 */
    readonly shell: string;
}
export function builtinTools(options: {readonly stores: SessionEditStores; readonly dialects: Dialects; readonly texts: BuiltinToolTexts}):
    Readonly<Record<"read" | "write" | "edit" | "editReplace" | "grep" | "glob" | "shell" | "ask" | "askForm", KitTool>>;
/** 审批预览的试算（builtin-tools.md 输出 26）：宿主按自己的工具 id 选 `kind`。 */
export function previewChanges(kind: "write" | "hashline" | "replace", args: Readonly<Record<string, unknown>>, files: SessionFiles, stores: SessionEditStores, sessionId: string, signal: AbortSignal): Promise<FilePreview>;
```

`kit/tools/ask.ts` 照现在的 `builtin/ask.ts` 直接从 `@notnotype/nb-form` 导入 `checkDescription`、`resolveForm`、`validateForm`，判定写法原样搬：提问前 `checkDescription(form, {policy: "agent"})` 为 `invalid` 时，只把 `severity === "error"` 的问题拼进 `ask-form-invalid` 的文字与 `details.problems`（警告不算，不拦提问）；回答的表单值用 `validateForm(resolveForm(form), value)` 校验。`ask` 的说明与失败文字与应用无关，随工具进 kit（baseline 核对逐字不变）。

`ToolSubject` 在 `kit/shapes.ts`（与 `agent/shared/points.ts` 的同名类型同形状）。points.ts 的 `ToolSubject` 是 SDK 的公开类型，留在应用不动：它经 `subjectsOf` 交给 kit 的审批钩子时由编译器核对可赋值，不需要另写检查。SDK 的类型面因此不变（`src/sdk/surface.test.ts`、`plugin-sdk/build-plugin.test.ts` 守着）。

NeuroBook 一侧 `agent/backend/builtin/index.ts` 留下：贡献 id 与 `providerName` 的表、`BuiltinToolTexts` 的 NeuroBook 文字（新文件 `builtin/texts.ts`，原样取自现在的声明）、`switch_mode`（模式整个留在应用），以及把 `KitTool` 包成 `AgentToolImplementation` 的一层（`create: (context, services) => tool.create(context, {files: sessionFiles(services.resources, context), artifacts: services.artifacts})`）。`builtin/preview.ts` 只剩工具 id 到 `kind` 的表与调用 `previewChanges`。`backend/attachments.ts` 的 `imageFormat`、`prepareImage` 改从 `@notnotype/nb-harness/kit/tools` 取。

nb-harness 现有的 `src/tools/`（`read`、`edit`、`registry`、`bridge`、`effective`、`builtin`）不合并、不改。查清的调用方：nb-story 经根入口用 `createHarness`、`createToolRegistry`、`registerPlugin`（`src/qa/engine.ts`、`probe.ts`、`tools.ts`），不用旧的 `read`、`edit`；`registerBuiltinTools` 只有 `nb-agent-ui/src/harness.contract.test.ts` 与 nb-harness 自己的 `tests/harness.llm.test.ts`、`tests/acceptance.test.ts` 在用；`createReadTool`、`createEditTool` 只有 nb-harness 的 `tests/read-tool.test.ts`、`edit-tool.test.ts`。它们属于旧 `createHarness` 的合同（交给 OMP `Agent` 的 `AgentTool`），与 kit 的 `ToolImplementation` 形状不同，按包 AGENTS.md“旧实现只为让它们的测试照跑，不再加功能”冻结，随 `createHarness` 在 [t31](../t31-nb-story-new-kernel/README.md) 一起删；这三个名字是已发布包根入口（`src/index.ts`）的导出，删除属于发布合同变更，合入时在 t31 的“要做的事”连同这一点补上。kit 的工具是之后唯一维护的读、改实现。nb-story 不加载 kit；它装 nb-harness 时多装 `unbash`（纯 JS）与 `@notnotype/nb-form`（nb-ui、vue、typescript 都是它的可选 peer，不会被装上；`typebox` nb-story 本来就有），Windows 上不受影响（kit 的 `shell` 等在 Windows 上能不能用未核实，nb-story 用不到）。

### `packages/nb-harness/src/kit/approval/`（设计问题 5）

搬来 `rules.ts`、`judge.ts`、`hook.ts`、`auto-review.ts`（改名 `review.ts`）；`rules.test.ts` 跟着搬。Agent 模式（`modes.ts`：模式扩展、提醒、`switch_mode` 与它的文字）整个留在 NeuroBook：它没有第二个使用者，kit 只给钩子要的闸门分类（按 `layout.scratch` 判断）。`kit/shapes.ts` 收 `RuleSchema`、`RulesSchema`、`Rule`、`RuleAction`、`ToolSubject`、`FilePreview`；`agent/shared/permissions.ts` 改为转出前四个，并保留 NeuroBook 自己的 `AgentMode`、`AGENT_MODES_EXTENSION`、`MODE_SWITCH_KIND`、`ModeSwitchRequest`、`ModeSwitchAnswer` 与三条审批原因串。规则的存储形状因此只有一份。

判定链、判定者与转问：

```ts
export interface ReviewRequest {
    readonly call: ToolCall;
    readonly effect: ToolEffect;
    /** 展开过的判定路径。 */
    readonly paths: readonly PathSubject[];
}
/** `decide` 判出“交给审批者”时调用（`auto` 且不是本地写）：放行、拒绝或转问。 */
export type Reviewer = (request: ReviewRequest, ctx: ApprovalCtx) => Promise<ApprovalVerdict>;

/** 这次调用为什么要转问。 */
export type EscalationSource =
    | "rule"            // 某层规则判 ask
    | "rules-invalid"   // 项目规则读坏，写与执行一律问（permissions.md 输出 6）
    | "address"         // 写的地址 `classify` 为 ask（输出 7）
    | "gate"            // 模式闸门判为写、闸门动作是 ask
    | "mode"            // 审批模式本身要问（`ask`，或 `allow-writes` 下的执行）
    | "reviewer";       // 审批者转人工
export interface Escalation extends ReviewRequest { readonly source: EscalationSource; readonly reason?: string }
/** 要转问的调用交给谁回答。缺省原样交回 `{verdict: "ask", reason}`，由内核问用户。 */
export type Escalate = (escalation: Escalation, ctx: ApprovalCtx) => Promise<ApprovalVerdict>;

export function createApprovalHook(options: {
    readonly files: SessionFilesFactory;
    readonly userRules: () => readonly Rule[];
    /** 宿主的项目层规则；没有项目为 `[]`，读不了为 `"invalid"`（NeuroBook 读 `.nbook/permissions.json`）。 */
    readonly projectRules: (context: ToolSessionContext, signal: AbortSignal) => Promise<readonly Rule[] | "invalid">;
    /** 项目规则读不了时诊断 `permission-rules-invalid` 的消息（进日志，宿主定）。 */
    readonly projectRulesInvalidMessage: string;
    readonly dialects: Dialects;
    /** 这一刻有没有模式闸门（NeuroBook：Agent 模式不是 `normal`）。 */
    readonly gated: (read: ApprovalCtx["read"]) => boolean;
    readonly modeWriteAction: () => ModeWriteAction;
    /** 闸门的文字：转问时的原因串、拒绝时给模型的话（都进日志，宿主定）。 */
    readonly gate: {readonly askReason: string; readonly blockedText: string};
    readonly subjectsOf: (tool: string, args: Readonly<Record<string, unknown>>, activate: boolean) => Promise<readonly ToolSubject[] | null>;
    readonly review: Reviewer;
    readonly escalate?: Escalate;
    readonly report: (code: string, message: string, params?: Record<string, unknown>) => void;
}): ApproveHook;

export function modelReviewer(options: {
    /** 系统提示词里对 Agent 的称呼（NeuroBook：“a writing and coding agent”）。 */
    readonly agentDescription: string;
    /** 判定工具声明的 `provider`（进日志的请求里）。 */
    readonly provider: string;
    /** 交给审批模型作“当前项目”的根（全局地址）；没有为 null。 */
    readonly projectOf: (context: ToolSessionContext) => string | null;
    /** 没判出来、转人工的原因串（宿主定，界面按它换成本地文字）。 */
    readonly reasons: {readonly failed: string; readonly escalatedPrefix: string};
    readonly report: (code: string, message: string, params?: Record<string, unknown>) => void;
    readonly timeoutMs?: number;
}): Reviewer;
```

怎么接：内核只认 `ApproveHook`（`kernel/api/host.ts`），它是 `SessionEnv.approve`，宿主整体可换。kit 的 `createApprovalHook` 是一种实现：三层规则、闸门分类与 `decide`（`judge.ts`，纯函数，导出）先判；判出放行或拒绝的直接交回；判出“交给审批者”的调 `options.review`；判出要转问的，以及审批者转人工的，都经 `options.escalate`，带来源与原因。转问之后的结论若仍是 `ask` 且调用含命令，再附上 `remember`（“本会话都批准”要记的前缀，现在的 `rememberFor`），与现在一样。判定者与回答者由宿主给，钩子不写死“用户”或“审批模型”：

- NeuroBook 给 `modelReviewer`（就是现在的 `autoReview`，“审批模型”），不传 `escalate`，行为不变。
- NeuroBot 要“另一个 bot 判定”时写一个 `Reviewer`，把 `ReviewRequest` 发给判定 bot 的会话、等它的结论；要所有转问都先过判定 bot、或“任务运行不等审批，清单外直接拒绝”（提案第七节）时写一个 `Escalate`，按 `source` 处理。都不必改 kit，也不必改内核。要所有写都过审批者时把 `localWrites` 给空数组。
- 内核的 `resolve` 只收用户应答审批（`kernel/run/interaction.ts` 的 `allowed`），所以“bot 回答已经弹出的审批请求”不在这条路上，那要改内核，留给 NeuroBot 的 Task。

实现上要注意的两处现状：项目规则读坏与地址分类为 `ask` 都是在 `decide` 之前把规则结果改成 `{action: "ask"}`（`hook.ts`），来源在那一步就丢了，所以钩子另记一个“谁把它改成 ask”的变量（两者都成立时记后改的 `address`），`decide` 交回 `rule` 来源的询问时换成它；`decide` 的询问结果加 `source`（`rule`、`gate`、`mode`），不改它的判定顺序。缺省的 `escalate` 交回的原因与现在逐字相同：闸门为 `gate.askReason`，规则为规则自己的 `reason`，审批模型为它交回的原因，其余没有原因。

`decide` 的 `MODE_ASK_REASON` 与 `MODE_BLOCKED_TEXT` 改成选项 `gate` 的两个字段：拒绝文字说的是 NeuroBook 的 `switch_mode` 与 discuss、plan 两种模式，模式留在 NeuroBook，它的文字也留下。项目规则读坏时的诊断码 `permission-rules-invalid` 不变，消息由宿主给，NeuroBook 原样传入现在的英文消息。

留在 `agent/backend/permissions/`：`project-rules.ts`、`modes.ts`（模式扩展、提醒、`switch_mode` 与文字；`failed` 改从 kit 取）、新文件 `index.ts`（`createApprovalHook` 的 NeuroBook 选项：设置、`readProjectRules`、模式的 `gated` 与 `gate` 文字、`modelReviewer({agentDescription: "a writing and coding agent", provider: "nbook.agent", projectOf: …, reasons: …})`）。

### `packages/nb-harness/src/kit/compaction/`（设计问题 4）

搬来 `cuts.ts`、`replies.ts`、`shake.ts`、`inplace.ts`、`summary.ts`、`restore.ts`；`compaction-methods.test.ts` 的“切点”“摘要的输入”“模型的回复”三组在第二次提交搬来，“贡献点的方法表”留下（测的是接线）。

```ts
/** 摘要的提示词：小节与规则由宿主定（t11 决定 5 的写小说版本留在 NeuroBook）。 */
export interface CompactionPrompts {
    inplace(require: readonly string[]): string;
    system(require: readonly string[]): string;
    input(segment: string, previous: string | null): string;
}
/** 内置工具在宿主里的 id：shake 的占位、放回找“最近读过或改过的文件”都按它认。 */
export interface BuiltinToolIds {
    readonly read: string; readonly write: string; readonly edits: readonly string[];
    readonly search: readonly string[]; readonly shell: string;
}
export function compactionMethods(options: {readonly prompts: CompactionPrompts; readonly tools: BuiltinToolIds}): {readonly shake: CompactionMethodImpl; readonly inplace: CompactionMethodImpl; readonly summary: CompactionMethodImpl};
export class CompactionRestore {
    constructor(options: {
        readonly files: SessionFilesFactory;
        readonly editStores: SessionEditStores;
        readonly tools: BuiltinToolIds;
        /** 计划文件的地址（放回时单独放、不占最近文件的名额）；没有为 null。 */
        readonly planOf: (context: ToolSessionContext) => string | null;
        /** 完整对话日志的全局地址（放回的提示里给模型）；没有为 null，不发这条提示。 */
        readonly logOf: (context: ToolSessionContext) => string | null;
        readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
    });
    forget(sessionId: string): void;
    readonly run: (context: ToolSessionContext, args: CompactionRestoreArgs) => Promise<CompactionRestored>;
}
```

摘要模型按角色取（`summary.ts` 现在写的是字面量 `{role: "compaction"}`），角色 id 改用 `kit/shapes.ts` 的 `MODEL_ROLES.compaction`（`MODEL_ROLES = {compaction: "compaction"} as const`，注释写明宿主的角色表里必须有这个 id）。审批模型只经 `ctx.model({purpose: "approval"})` 取，选哪个角色是宿主模型端口的事（NeuroBook 在 `core.ts`，归 w00043 t02），kit 不需要别的角色常量。“内置角色表包含 `MODEL_ROLES` 的每个 id”的断言由 w00043 t02 在 `nb-models` 里写；本 Task 不改 `nbook.models`，NeuroBook 现在的 `BUILTIN_ROLES` 已含 `compaction`，值不变。

NeuroBook 一侧 `agent/backend/compaction/` 留下 `index.ts`（`CompactionMethods` 接收者、三个方法 id、`DEFAULT_COMPACTION_ORDER`、贡献声明）与 `prompts.ts`（现在的文字原样，改成交出一个 `CompactionPrompts` 对象），新增 NeuroBook 的 `BuiltinToolIds`（与 `builtin/index.ts` 共用一处常量）；`planOf` 为 `session://plan.md` 展开后的地址，`logOf` 为 `sessions://<id>/session.jsonl`。

小节由应用决定（开发者 2026-11-10）：只由宿主在建方法时给，不做按 Profile 换；Profile 继续用 `compaction.require` 追加要求。

要搬的代码里另找到的写小说或 NeuroBook 专有的文字，全部改成宿主给、NeuroBook 原样传入：

| 位置 | 内容 | 改成 |
|---|---|---|
| `compaction/prompts.ts` | 七个小节、“写作对话”“接着写” | `CompactionPrompts` |
| `permissions/auto-review.ts` | “a writing and coding agent”；判定工具的 `provider: "nbook.agent"` | `modelReviewer` 的 `agentDescription`、`provider` |
| `permissions/judge.ts`、`shared/permissions.ts` | `MODE_BLOCKED_TEXT`、`MODE_ASK_REASON` | `createApprovalHook` 的 `gate` |
| `permissions/hook.ts` | `permission-rules-invalid` 的消息（含 `.nbook/`） | `projectRulesInvalidMessage` |
| `permissions/hook.ts`、`auto-review.ts` | 另两条 `nbook.agent/…` 原因串 | `modelReviewer` 的 `reasons` |
| `builtin/read.ts`、`write.ts`、`edit.ts`、`shell.ts` 的说明 | `project://正文/第一章.md`、`$NBOOK_PROJECT`、`session://artifacts/` | `BuiltinToolTexts` |
| `compaction/shake.ts`、`restore.ts`、`builtin/preview.ts` | `nbook.agent.read` 等工具 id | `BuiltinToolIds`；预览的 id 表留在应用 |
| `compaction/restore.ts` | `session://plan.md`、`sessions://<id>/session.jsonl` | `planOf`、`logOf` |
| `guards/*.ts`、`session-meta.ts` | 扩展 id（事件名 `<扩展 id>/<名字>` 进日志） | 工厂参数 |
| `session-meta.ts` | 标题 Profile key、标签、给标题模型的材料格式 | `SessionMeta` 选项 |

保持不变的通用文字（kit 自带）：放回的两句提示与日志提示、shake 的三种占位、循环守卫的提醒、摘要输入里对话的排版（“【用户】”“【助手】”“工具结果（失败）”）、`ask` 与 `grep`、`glob`、`read` 的说明主体。

### `packages/nb-harness/src/kit/guards/`、`src/kit/sessions/`（设计问题 3）

- `guards/`：`costGuard({id, limits})`、`loopGuard({id, threshold})`、`refusal`；`agent/guards.test.ts` 整个搬来（只用 `createTestSession`）。`agent/backend/guards/index.ts` 留下：两个 id、贡献声明、按设置现读的闭包。
- `sessions/table.ts`：`SessionTable`、`IDLE_CLOSE_MS`。计时口不换形状：选项 `clock` 的类型是 kit 自己定的结构类型 `{schedule(callback: () => void, ms: number): () => void}`，与 nb-runtime 的 `RuntimeClock.schedule` 同形，NeuroBook 照旧传 `options.clock`；取消同步生效，到点回调里 `entry.cancelIdle = null` 清的一定是自己，现在的时序原样保住（不经内核 `Clock.wait`：那样到点之后的取消不再生效）。错误类改名 `SessionUnavailable`、`SessionTableStopping`（`code` 仍是 `unavailable`），停止时的消息不再写 `nbook.agent`；`backend/remote.ts` 的 `instanceof` 改用新类。类名与消息会作为 `cause.name`/`message` 进远程诊断，列为 baseline 的预期差异。
- `sessions/meta.ts`：`SessionMeta`、`sessionMetaExtension({id, tag, notify})`、`titleSessionId`（`session-title-<哈希>` 已有会话在用，不变）。选项加 `titleProfile`（NeuroBook：`SESSION_TITLE_PROFILE`）与 `material`（第一轮与压缩后两种输入文字，原样取自现在的代码）；模型经内核的 `ModelPort` 取（现状）；`CreateResult` 换成内核的结果形状。贡献声明 `SESSION_META_CONTRIBUTION` 留在应用。
- 接线留在 `nbook.agent`：`shared/points.ts` 的贡献点、`compaction/index.ts`、`guards/index.ts`、`builtin/index.ts`、`tools.ts`（`agent.tools` 接收者）、`extensions.ts`、`profiles.ts`、`agent.ts` 的装配、`plugin.ts`。nb-harness 不加 nb-runtime 依赖，由架构测试守住。

### `packages/nb-form/package.json`：Vue 一侧的依赖改为可选 peer

nb-harness 依赖 nb-form 之后，`npm i @notnotype/nb-story` 会装上 nb-form；nb-form 现在把 `@notnotype/nb-ui` 写在 `dependencies`、把 `vue` 与 `typescript` 写成非可选 peer（Bun 会自动装 peer），于是连带装上 nb-ui 与它的 `reka-ui`、`@iconify-json/lucide`、`@vueuse/core` 以及 `vue`、`typescript`。这几个只有 `./vue`（以及在 `src/vue/` 下的 `./lab-sources`）用到，核心入口只在 `src/text.ts` 等处 `import type` 自 `@notnotype/nb-ui/text`，运行时不加载。

改法（只改 nb-form 的 `package.json`，源码不动）：

- `dependencies` 只留 `typebox`。
- `peerDependencies`：`@notnotype/nb-ui: "workspace:^"`、`vue`、`typescript`（后两者范围不变）；`peerDependenciesMeta` 把这三个都标 `optional: true`。`typescript` 也标可选：它在 ADR 0029 决策 2 里是给宿主编译单文件组件用的，同样只有 `./vue` 需要，不标可选的话 nb-story 的用户仍会装上一份 TypeScript，与开发者“装 nb-story 时不连带装上 Vue 一套”的目的不符。
- `devDependencies` 加 `@notnotype/nb-ui: "workspace:^"`（`vue` 已在），nb-form 自己的 `vitest`、`vue-tsc` 照旧能解析。
- 改完在仓库根 `bun install` 刷新 `bun.lock`，与 `package.json` 同一次提交；`bun.lock` 的改动只应落在 nb-form 那一节。

发布规则逐条核对（`scripts/release/packages.ts`、ADR 0029）：

- ADR 0029 决策 3“源码值导入的包写进 dependencies 或 peerDependencies”：`./vue` 值导入的 `vue`、`@notnotype/nb-ui` 在 peer 里，`release:check` 的 `undeclaredImports` 把 peer 算作已声明，可选与否不影响。决策 2 只要求 Vue 包把 `vue`、`typescript` 写成 peer，没有要求非可选，不需要新 ADR；跨 Module 决策以 Task README“决定”表那一条为记录。
- 发布清单里的内部包在任何依赖字段都必须写 `workspace:^`（`checkReleasePackages` 对 devDependencies 也查），peer 与 dev 里的 nb-ui 都写 `workspace:^`。
- `publishOrder` 把 peer 也算依赖：nb-ui 仍排在 nb-form 之前；第 5 片之后 nb-form 排在 nb-harness 之前；没有环。
- 发布清单的 9 个源码包里还没有在 `peerDependencies` 里写工作区包的先例，要实测 `bun pm pack` 把 peer 里的 `workspace:^` 改写成 `^<版本>`：`release:smoke` 打出 tarball 后读 `dist/release/` 里 nb-form 包的 `package/package.json`（`tar -xOzf <tarball> package/package.json`）核对。没有改写时停下汇报，不手改清单。

谁依赖 `./vue`、是否自己直接依赖 nb-ui 与 vue（已核对）：

| 消费者 | 用 nb-form 的什么 | nb-ui、vue 的来源 |
|---|---|---|
| 应用 `packages/neuro-book`（`private`） | 核心（`shared/settings.ts`、`builtin/ask.ts`）与 `./vue`（设置页、Lab、`agent/web/form-renderer.vue`） | 自己的 `devDependencies` 直接写了；应用包与插件 SDK 由 `pack-app.ts`、`plugin-sdk/pack.ts` 打成 bundle，生成的清单不列 nb-form，不受影响 |
| nb-story 的网页（`src/web/shell/SettingsPage.vue`） | `./vue` 与核心的类型 | 自己的 `devDependencies` 直接写了（网页打包前用 Vite 构建进包里） |
| 发布冒烟的 Vue 宿主（`pack-smoke.ts` 的 `smokeVueHost`） | `./vue` | 宿主清单直接写了 `@notnotype/nb-ui` 与 `vue` |
| 开发者面板 `packages/dev-panel` | 不用 nb-form（在源码里没搜到） | — |
| nb-harness（第 5 片起） | 只用核心 | 不需要；架构测试核对它不依赖 nb-ui 与 vue |

`pack-smoke.ts` 的 `smokeStory` 在 `bun install` 之后加一条检查：项目的 `node_modules` 里没有 `@notnotype/nb-ui`、`vue`、`typescript`，有就失败（注释写明：nb-story 不该连带装上 Vue 一套，见本 Task）。第 1 片里它恒为真；第 5 片 nb-harness 依赖 nb-form 之后，它守住可选 peer 没被装上。

已知边界：只用 nb-form 核心、又对它的源码做类型检查的项目（例如以后在仓库外对 nb-harness 跑 `tsc`），没装 nb-ui 时那条 `import type` 解析不到，报找不到模块；运行不受影响。仓库里 Bun 工作区把 nb-ui 链在根 `node_modules/@notnotype/` 下，nb-harness、nb-story 的类型检查照常解析。nb-form 的 README 写明这一点。

文档（与代码同一次提交，在 worktree 里改）：`packages/nb-form/README.md` 的“安装”段（现在写“peer 依赖 vue 与 typescript……Bun 安装时会自动装上”）改为：只用核心不需要任何 peer；用 `./vue` 的宿主自己装 `vue`、`@notnotype/nb-ui`、`typescript`；只用核心但要类型检查时装上 nb-ui（只取类型）。`packages/nb-form/AGENTS.md` 的依赖方向一节加一句：`nb-ui`、`vue`、`typescript` 是可选 peer，新增给核心用的依赖不能放进 peer。

### `packages/nb-harness/src/app-neutral.test.ts`（设计问题 8）

照 `packages/nb-runtime/src/app-neutral.test.ts`：扫 `src/` 下全部非测试源码（含旧 harness 与内核），注释里也不许出现 `/nbook|neurobook/i`；导入说明符不许以 `nbook/`、`@notnotype/neuro-book`、`@notnotype/nb-runtime` 开头；`package.json` 的 `dependencies` 不含这三者。现有命中只有三处注释（`models/index.ts`、`kernel/api/model.ts`、`kernel/api/host.ts`），改写成“宿主”的说法。kit 的测试文件也用中性 id（`builtin.read` 之类），虽然扫描不管测试。

### `packages/nb-harness/AGENTS.md`、`README.md`、`docs/omp-capabilities.md`

- AGENTS.md 开头“NeuroBook 领域 harness，不追求通用”与本 Task 的目标冲突，改为：内核加宿主套件，NeuroBook 与 NeuroBot 共用，应用专有的地址、文字与 id 由宿主传入。“领域工具不在本包内实现”保留（kit 的工具是通用工具）。加 `src/kit/` 一节：分层表由 `kit/architecture.test.ts` 检查、只经内核公开入口、写盘只在 `files/local.ts`、宿主文字不给缺省值、只有 `./kit/shapes`、`./kit/files` 可进浏览器、对 nb-form 只用核心入口（不导入 `./vue`、`./locales`、`./lab-sources`，不依赖 nb-ui 与 vue）；依赖方向一句加上 `@notnotype/nb-form`（核心）；完成门禁加上 kit 的测试。
- README.md 加 kit 子路径的一段，写明哪两个子路径可进浏览器、`./kit/testing` 给宿主跑合同测试、`ask` 的表单用 nb-form 的核心入口检查与校验（怎么画由宿主定）。
- `docs/omp-capabilities.md` 补 kit 用到的 `pi-natives` 能力（`EditSession`、`hashline*`、`grep`、`glob`、`executeShell`），先读它现有的表再按格式加。

## Spec 与文档改动

行为合同不变，只改 owner、实现合同与证据（[`docs/specs/README.md`](../../../../../docs/specs/README.md#实现合同与证据)）；kit 的文件访问接口是新合同，另开一份。

开工前，主工作区（单独一次提交，`git commit -- <路径>`）：

| 文件 | 改什么 |
|---|---|
| `docs/specs/harness/host-kit.md`（新） | `status: planned`、`owners: nb-harness`，按 [`writing-specs`](../../../../skills/writing-specs/SKILL.md) 的九节写，先只写 `SessionFiles`、`SessionLayout`、`ArtifactStore` 的合同：失败码与各自的情形、`expand` 幂等、`readPath` 的种类与对 `<方案>://` 的探测、`read`/`write` 的基线与取消、`list` 的两种形状、`call` 交回的写入属于这次调用（来源与分组由实现按调用记）、`classify`、`save` 的宿主身份与单段 `label`。不承诺里写明：kit 其余块（工具、审批、压缩、守卫、句柄表）的宿主无关条目留到 NeuroBot 接入时再从 `agent/*.md` 抽出 |
| `docs/specs/README.md` | 注册表加 `harness/host-kit.md` 一行 |

代码合入之后，主工作区紧接着提交（这几份的证据行链接了要搬的文件，`docs:check` 检查活跃文档的链接，所以不在分支上改）：

| 文件 | 改什么 |
|---|---|
| `docs/specs/harness/host-kit.md` | 补实现合同与证据（`kit/files/`、`kit/testing/files-contract.ts`、两处运行它的测试）；注册表说明加“待晋升” |
| `docs/specs/agent/builtin-tools.md` | `owners` 加 `nb-harness`；实现合同：公开入口加 `@notnotype/nb-harness/kit/tools`（实现）与 `nbook.agent` 的 id、说明文字、`SessionFiles` 实现；依赖方向写 `nbook.agent` → kit，kit 经宿主的 `SessionFiles`（`harness/host-kit.md`）读写；“工具不自己写盘”加上 `kit/architecture.test.ts`；证据的实现入口与合同测试改到新路径 |
| `docs/specs/agent/compaction.md` | `owners` 加 `nb-harness`；实现合同写方法与放回在 kit、摘要提示词、方法 id、计划与日志地址在 `nbook.agent`；证据路径 |
| `docs/specs/agent/permissions.md` | `owners` 改为 `nb-harness` 与 `…/agent/backend/permissions`；依赖：`unbash` 改在 nb-harness；判定在 kit 的 `createApprovalHook`（审批者与转问可由宿主替换），`nbook.agent` 给规则、项目层、审批者、闸门文字与原因串；证据路径 |
| `docs/specs/agent/modes.md` | 实现合同：闸门分类（输出 1）在 kit 的 `createApprovalHook`，按 `layout.scratch`；模式本身与 `switch_mode` 仍在 `backend/permissions/modes.ts`；证据路径 |
| `docs/specs/agent/sessions.md` | 实现合同：句柄表的实现在 `kit/sessions`，实例由 `nbook.agent` 持有；证据路径 |
| `docs/specs/agent/run-guards.md` | 实现入口与合同测试路径（`guards.test.ts` 移到 nb-harness）；owner 加 `nb-harness` |
| `docs/specs/agent/resources.md` | 实现合同加 `SessionFiles` 的 NeuroBook 实现（`backend/resources.ts` 的 `sessionFiles`、`filesFor`）与 `kernelResources` 在 kit；证据路径 |
| `docs/specs/agent/builtin-profiles.md` | 证据的 `backend/session-meta.ts` 改到 `kit/sessions/meta.ts` 与 NeuroBook 的接线处 |
| `docs/specs/harness/` 现有五份 | 不改：内核的行为与接口（`ApproveHook`、`SessionEnv.compaction`、`Resources`、`Clock`）都没变 |
| `docs/specs/ui/forms.md` | “边界与兼容”的“依赖”加一句：Vue 层用到的 `vue`、`@notnotype/nb-ui`（以及编译单文件组件的 `typescript`）是包的可选 peer，只用核心的消费者（例如 nb-harness）不会装上它们 |
| `docs/modules/monorepo-boundaries.md` | nb-harness 那一行改为“内核与宿主套件，NeuroBook 与 NeuroBot 共用”，依赖加 nb-form 的核心；nb-form 那一行的使用方加 nb-harness（只用核心），并写 nb-ui、vue 是 `./vue` 的可选 peer |
| `.agents/works/w00032-agent-integration/README.md`、t31 README | 合入后在主工作区记：t32 完成；t31“要做的事”加“删 `src/tools/` 与 `registerBuiltinTools`、`createReadTool`、`createEditTool`（根入口导出，发布合同变更）” |

## 切片

开工前（不提交）：在 worktree 里写一个一次性脚本，用固定输入调真实的导出，把结果 dump 成 JSON 存到 `.local/agent/works/w00032-agent-integration/tasks/t32-harness-backfill/baseline.json`：

- 宿主文字：全部内置工具贡献的声明（`BUILTIN_TOOL_CONTRIBUTIONS`）；`inplacePrompt`/`summarySystem`/`summaryInput` 对两组 `require` 的输出；审批模型请求的 `system` 与工具声明；三条原因串、`MODE_BLOCKED_TEXT`、`permission-rules-invalid` 的消息；两个守卫与会话元数据的扩展 id；标题生成的两种材料（第一轮、压缩后）。
- kit 自带的文字：`CompactionRestore.run` 对一个固定会话（读过两个文件、有计划文件）的放回消息；`shake` 对一段固定对话的输出；循环守卫的提醒；`summary` 对固定消息交给模型的输入串。
- 预期差异（对照时允许不同、逐条核对差的就是这几处）：句柄表两个错误类的类名与停止时的消息。

每片第一次提交前对一次、最后一片再对一次，除预期差异外必须逐字相同（工具声明进 Profile 哈希与会话快照，文字进日志与模型上下文，字不同就是行为变化）。dump 脚本要取自上面这些导出，不另抄一份。

每片两次提交：

- **第一次：只搬实现。** 实现搬进 kit、应用改接线、删旧文件；应用里经真实插件的测试（`agentWorld` 加脚本化模型的那些）一行不改、只改导入，照跑通过，作为“行为不变”的证据。只调被搬函数的纯单元测试（`bash-dialect.test.ts`、`rules.test.ts`、`guards.test.ts`）同一次提交跟着搬，内容不改、只改导入。
- **第二次：把用例改写进 kit。** 只断言工具、方法、规则自身行为的用例改写到 kit（`createTestSession` 加 `localFiles`），删掉应用里与之重复的；按“验收映射”末段的规则留下应用的用例。kit 新增的用例（`escalate`、合同测试、句柄表时序）也在这一次。

下表的命令都在包目录执行；“nb-harness”指 `packages/nb-harness`，“应用”指 `packages/neuro-book`。

| 片 | 内容（对应关键设计） | 第一次提交与自跑 | 第二次提交与自跑 |
|---|---|---|---|
| 1 | nb-form 的依赖改为可选 peer：`packages/nb-form/package.json`、`bun.lock`、nb-form 的 README 与 AGENTS.md、`scripts/release/pack-smoke.ts` 的 `smokeStory` 检查（“`packages/nb-form/package.json`”一节） | 只有这一次提交。仓库根：`bun install`（看 `bun.lock` 的差异只在 nb-form）、`bun run release:check`；nb-form：`bun run test`、`bun run typecheck`；应用与 nb-story：`bun run typecheck`（`./vue` 的两个消费者）；nb-story：`bun run build:web`；仓库根：`bun run release:smoke`（慢时加 `prox`），核对 tarball 里 nb-form 的 peer 已改写成版本范围、Vue 宿主构建通过、nb-story 的安装里没有 nb-ui、vue、typescript | — |
| 2 | `kit/architecture.test.ts`（先只登记已建的目录、两条浏览器链与 nb-form 导入边界那一条）、`src/app-neutral.test.ts` 与三处注释、`kit/shapes.ts` 的骨架（`MODEL_ROLES`）、AGENTS.md 的 kit 一节 | 只有这一次提交。nb-harness：`bun run typecheck`；`bun test src/kit src/app-neutral.test.ts` | — |
| 3 | `kit/files/`（接口、`decodeText`、`renderVirtual`、`kernelResources`）、`files/local.ts`；`nbook.files` 的 `text.ts`、`schemes.ts` 改为转出；NeuroBook 的 `sessionLayout`、`sessionFiles`、`filesFor`；`agent.ts` 的 `resources` 改用 kit 的 `kernelResources` | nb-harness：`bun run typecheck`、`bun test src/kit`；应用：`bun test src/plugins/agent/resources.test.ts src/plugins/agent/agent.test.ts src/plugins/files`、`bun run typecheck`；对 baseline | `kit/testing/files-contract.ts`；`kit/files/local.test.ts` 与应用 `resources.test.ts` 各跑一遍合同；`kit/files/kernel-resources.test.ts`。nb-harness：`bun test src/kit/files`；应用：`bun test src/plugins/agent/resources.test.ts` |
| 4 | `kit/commands/`（加 `unbash` 依赖，应用删掉）；`kit/tools/` 的 `snapshot`、`read`、`image`、`write`、`edit`、`search`、`preview`；`builtin/index.ts`、`texts.ts`、`preview.ts`、`attachments.ts` 改接线 | `bash-dialect.test.ts` 跟着搬。nb-harness：`bun run typecheck`、`bun test src/kit`；应用：`bun test src/plugins/agent/builtin-tools.test.ts src/plugins/agent/builtin-tools-project.test.ts src/plugins/agent/attachments.test.ts src/plugins/agent/permissions.test.ts`、`bun run typecheck`；对 baseline | `builtin-tools.test.ts` 里这几个工具自身行为的用例改写成 `kit/tools/*.test.ts`，应用删重复。nb-harness：`bun test src/kit/tools`；应用：`bun test src/plugins/agent/builtin-tools.test.ts` |
| 5 | `kit/tools/` 的 `shell`、`shell-address`、`ask`（直接用 nb-form 的核心入口）；nb-harness 的 `dependencies` 加 `@notnotype/nb-form: "workspace:^"`（仓库根 `bun install`），架构表的 `tools/` 登记它；接线 | 同第 4 片第一次，加 `src/plugins/agent/session-host.test.ts`，仓库根加 `bun run release:check`；对 baseline | `shell`、`ask`、“全文”的工具自身用例改写进 kit。命令同第 4 片第二次 |
| 6 | `kit/compaction/`；`compaction/index.ts`、`prompts.ts` 改接线；`CompactionRestore` 改用 `SessionFilesFactory`、`BuiltinToolIds`、`planOf`、`logOf`；`summary.ts` 用 `MODEL_ROLES` | nb-harness：`bun run typecheck`、`bun test src/kit`；应用：`bun test src/plugins/agent/compaction.test.ts src/plugins/agent/compaction-methods.test.ts src/plugins/agent/builtin-profiles.test.ts`、`bun run typecheck`；对 baseline | `compaction-methods.test.ts` 三组与放回的规则用例改写进 `kit/compaction/*.test.ts`。nb-harness：`bun test src/kit/compaction`；应用：`bun test src/plugins/agent/compaction.test.ts src/plugins/agent/compaction-methods.test.ts` |
| 7 | `kit/shapes.ts` 补规则形状、`ToolSubject`、`FilePreview`；`kit/approval/`（`rules`、`judge`、`hook`、`review`，含 `escalate`）；`permissions/` 只留模式、项目规则与 `index.ts` 选项；`shared/permissions.ts` 转出；`shared/remote.ts` 的 `ApprovalPreview` 改别名 | `rules.test.ts` 跟着搬。nb-harness：`bun run typecheck`、`bun test src/kit`；应用：`bun test src/plugins/agent/permissions.test.ts src/plugins/agent/modes.test.ts src/plugins/agent/auto-review.test.ts src/plugins/agent/session-host.test.ts`、`bun run test:vitest src/plugins/agent/web`、`bun run typecheck`；对 baseline | `auto-review.test.ts` 按“验收映射”的去向改写；`kit/approval/hook.test.ts` 加 `escalate`：每种来源各一条，缺省时结论与原因与不传相同，转问后仍为 `ask` 时带 `remember`。nb-harness：`bun test src/kit/approval`；应用：`bun test src/plugins/agent/auto-review.test.ts src/plugins/agent/permissions.test.ts` |
| 8 | `kit/guards/`、`kit/sessions/`；`guards/index.ts`、`agent.ts`、`plugin.ts`、`remote.ts` 改接线；删应用里的旧文件 | `guards.test.ts` 跟着搬。nb-harness：`bun run typecheck`、`bun test src/kit`；应用：`bun test src/plugins/agent`、`bun run typecheck`；对 baseline | `kit/sessions/table.test.ts`：测试里写一个与 `RuntimeClock.schedule` 同语义的手动计时口（同步取消、一次推进内按先后同步执行），覆盖空闲关闭、在用不关、停止，以及同一次推进里先到点、再取消并重新登记时不提前关；`kit/sessions/meta.test.ts` 覆盖材料与标题 id。nb-harness：`bun test src/kit/sessions` |
| 9 | nb-harness README、`omp-capabilities.md`；最后一次对 baseline；“验证”一节的合入前清单 | 只有这一次提交。见“验证” | — |
| 合入后 | 主工作区：Spec、`monorepo-boundaries.md`、Work README、t31 README | 一次提交（`git commit -- <路径>`）。`bun run docs:check`、`bun run governance:check` | — |

顺序的理由：nb-form 的依赖改动独立于搬迁，又必须先于 nb-harness 依赖 nb-form，所以单独放第 1 片，出问题时可以单独回退；文件接口是工具、放回、审批共同的底；放回要用工具的行锚快照，审批要用方言与工具交出的判定对象，所以压缩与审批排在工具之后；守卫与会话不依赖别的块，放最后收尾。每次提交结束时应用都完整可用，不存在搬了一半的块。

## 验收映射

行为不变，每条输出由原来的测试守着；下表写这一次之后每条由哪里覆盖。“kit”指 nb-harness 里的测试（用 `localFiles` 与 `createTestSession`），“应用”指 `packages/neuro-book/src/plugins/` 下留下的测试。

| Spec 编号 | 覆盖 |
|---|---|
| `harness.host-kit` 全部输出 | kit：`kit/testing/files-contract.ts`，由 `kit/files/local.test.ts`（`localFiles`）与应用 `agent/resources.test.ts`（NeuroBook 的 `sessionFiles`，真实插件）各跑一遍；分组与来源另由应用 `resources.test.ts`“写入接口的会话绑定版” |
| `agent.builtin-tools` 输出 5、7、9、10、12、13、14、16、17、20、21、22、23、24、25、26，验收 2、3、4 | kit：`tools/*.test.ts`（从 `builtin-tools.test.ts` 改写来的对应用例）；应用：`builtin-tools.test.ts` 留下的“声明”与每个工具一条经真实插件的用例 |
| `agent.builtin-tools` 输出 1、3、4、6、8、11、15、18、19 | 应用：`builtin-tools.test.ts`（全局地址、来源与分组、全文、虚拟根、链接、不露出的文件、地址替换遇到虚拟或受保护的位置）、`builtin-tools-project.test.ts` |
| `agent.compaction` 输出 1–6，验收 1–3 | kit：`compaction/*.test.ts`；应用：`compaction.test.ts`“方法与缺省顺序”“切点”“溢出” |
| `agent.compaction` 输出 7–11 | kit：`compaction/restore.test.ts`；应用：`compaction.test.ts`“放回”第一条（NeuroBook 的计划与日志地址） |
| `agent.compaction` 输出 12 | 应用：`compaction-methods.test.ts`“贡献点的方法表”、`compaction.test.ts`“贡献的方法” |
| `agent.permissions` 输出 1、2、5、10–17 | kit：`approval/rules.test.ts`、`approval/hook.test.ts`、`commands/bash-dialect.test.ts` |
| `agent.permissions` 输出 18–21 | kit：`approval/review.test.ts`（`auto-review.test.ts`“问审批模型”四条与“模型看到什么”，`role-unbound` 用内核测试模型的 `unavailable` 表造）、`approval/hook.test.ts`（“哪些调用到不了模型”前两条：本地写直接放行、规则先判）；应用：`auto-review.test.ts` 留下“用户设置的写一律问用户”（`user://` 的分类）与“答放行才放行”一条经真实插件的接线 |
| `agent.permissions` 输出 3、4、6–9、22、23，验收 1–9 | 应用：`permissions.test.ts`、`builtin-tools-project.test.ts`、`web/permission-page.dom.test.ts`、`agent-conversation.e2e.ts` |
| `agent.modes` 输出 1（闸门分类） | kit：`approval/hook.test.ts`；应用：`modes.test.ts` |
| `agent.modes` 其余 | 应用：`modes.test.ts`、`session-host.test.ts`“Agent 模式”、`agent-conversation.e2e.ts` |
| `agent.sessions` 输出 5、6 | kit：`sessions/table.test.ts`（测试里的手动计时口）；应用：`agent.test.ts`“会话”（nb-runtime 的 `ManualClock`） |
| `agent.sessions` 输出 7–15 | 应用：`sessions.test.ts`、`tasks.test.ts`、`agent.test.ts`“停止时……” |
| `agent.run-guards` 输出 3–12，验收 1、2 | kit：`guards/guards.test.ts`；应用：`agent.test.ts`“运行保护的接线” |
| `agent.resources` 输出 1、2、4–8、10、11 | 应用：`resources.test.ts`、`builtin-tools.test.ts`“全文” |
| `agent.resources` 输出 9 | kit：`files/kernel-resources.test.ts`；应用：`resources.test.ts`“内核的资源接口” |
| `agent.builtin-profiles` 输出 6–13 | 应用：`builtin-profiles.test.ts`（标题 Profile 是 NeuroBook 的，用例不搬）；kit：`sessions/meta.test.ts` |
| 计划自己的要求：kit 不认识应用、不依赖 nb-runtime 与应用包、工具不自己写盘、两个浏览器子路径不引 node 与 OMP、对 nb-form 只用核心入口且不依赖 nb-ui 与 vue | nb-harness：`src/app-neutral.test.ts`、`src/kit/architecture.test.ts` |
| 计划自己的要求：nb-form 的 Vue 一侧依赖是可选 peer，装 nb-story 不连带装上 nb-ui、vue、typescript；`./vue` 的消费者照常构建 | `release:check`；`release:smoke`（`smokeStory` 的新检查、`smokeVueHost` 构建、tarball 里 peer 的版本改写）；应用与 nb-story 的 `bun run typecheck` |
| 计划自己的要求：宿主文字与 kit 自带文字、id、原因串逐字不变 | baseline 对照（每片第一次提交前与合入前） |

测试怎么拆，规则只有一条：断言依赖 NeuroBook 的地址方案、文件服务的授权、来源与分组、贡献 id 或 NeuroBook Profile 的留在应用；只断言工具、方法、规则自身行为的改写进 kit，改用 `localFiles`。每一块在应用里至少留一条经真实插件的集成用例证明接线。按这条规则 `builtin-tools.test.ts` 大约一半用例改写进 kit：“read”的分页、大文件、非法 UTF-8、图片，“edit”的引擎规则、裸路径、增删移动、部分失败，“grep 与 glob”的配额与期限，“shell”的环境、引号替换、输出窗口与全文保存，“ask”的回答校验，“审批预览”的试算；直接调 `runGrep`、`runGlob`、`previewEdit` 的用例全部搬。`rules.test.ts`、`bash-dialect.test.ts`、`guards.test.ts` 整个搬。`permissions.test.ts`、`modes.test.ts`、`sessions.test.ts`、`tasks.test.ts`、`resources.test.ts`（另加合同测试的调用）、`builtin-profiles.test.ts`、`builtin-tools-project.test.ts` 不搬。

## 验证

- 每次提交的命令见“切片”。包内跑文件时在包目录执行（`bun run test <路径>` 或 `bun test <路径>`），不在命令里接 `&&` 后再提交。
- 合入前跑一次：
  - `bun run test:affected --typecheck`（仓库根）：会选中 nb-form、nb-harness 与依赖它们的 neuro-book、nb-story、nb-agent-ui。长验证前看 `/proc/loadavg`，失败先分产品、测试与环境，单独重跑确认。
  - nb-harness 完成门禁：`bun run typecheck`、`bun test`（含 `tests/session.test.ts`、`acceptance.test.ts`、`provider.test.ts`，内核没改，按包 AGENTS.md 仍跑）。
  - `bun run release:check`（只读：核对会发布的源码导入都写进了依赖，`unbash`、`@notnotype/nb-form` 漏写会在这里报）；`bun run release:smoke` 跑一次（从打好的包装 nb-story 与它的依赖；要联网装第三方包，慢时加 `prox`），确认 nb-story 装得上、跑得起来，`smokeStory` 的新检查确认没装上 nb-ui、vue、typescript，Vue 宿主照常构建。
  - `bun run governance:check`、`bun run docs:check`。
  - 浏览器 e2e，2 个文件：`agent-conversation.e2e.ts`（审批、预览、模式切换、提问与表单、规则写入）、`agent-profiles.e2e.ts`（工具绑定与声明）。按 `packages/neuro-book` 的 `test:e2e` 自己构建；跑前停掉多余的开发服务。
  - 真实模型：`bun run --cwd packages/neuro-book test:llm` 只跑 `compaction.llm.test.ts`、`permissions.llm.test.ts`、`builtin-tools.llm.test.ts`、`run-guards.llm.test.ts`、`agent.llm.test.ts`；缺凭据时记“未验证”。
  - 变异检查：对 `kit/architecture.test.ts` 的只读白名单、浏览器链与 nb-form 导入边界（在 kit 里写一条 `@notnotype/nb-form/vue` 的导入）、`app-neutral.test.ts`、`smokeStory` 的新检查（临时把 nb-form 的 `vue` 改回非可选 peer，确认冒烟失败）、合同测试（让 `localFiles` 把虚拟根报成别的码）、`createApprovalHook` 调 `review` 与 `escalate` 的条件、句柄表到点回调的取消判断各改坏一次，确认对应测试失败后还原（先提交或备份再改，不用 `git checkout` 还原）。
- 实施中改动之后只重跑覆盖改动的文件和失败项；e2e 只在第 5、7 片的第一次提交之后各重跑 `agent-conversation.e2e.ts` 一次，其余留到合入前。
- 明确留下的未验证边界：Windows（ADR 0031 只由开发者的 Windows 机器实测；nb-story 不加载 kit，只多装 `unbash` 与 nb-form 的核心）；kit 的 `shell`、`grep`、`glob` 在 Windows 上的行为；NeuroBot 实际接上 kit、自己的 `SessionFiles` 过合同测试（本 Task 不做）。

## 不做与风险

不做：NeuroBot 的任何代码与它的 `SessionFiles` 实现（写锁、改动记录、来源限制都在那里）；NeuroBot 的“目录外的读要审批”不进接口，由它在 `userRules` 层给缺省规则表达（规则已支持 `not`、`any` 与路径 glob），kit 不为它加字段；bot 应答已弹出的审批请求（要改内核 `allowed`）；Agent 模式进 kit（没有第二个使用者）；按 Profile 替换摘要小节；模型端口 `resolve` 的选择顺序与模型服务（w00043 t02）；`tools.ts`、`profiles.ts`、`frames.ts`、`remote.ts` 这类 nb-runtime 接线与远程投影的抽取（Task README 已定等 NeuroBot 写出来再比）；kit 其余块的宿主无关 Spec 条目（留到 NeuroBot 接入时）；旧 `src/tools/` 与 `createHarness` 的删除（t31）；nb-harness 升版本与发布（远端写入，另请授权；nb-story 不需要新版本）；t14 的子代理与任务中心。

风险与兜底：

- **文字或 id 被改了一个字**：工具声明进 Profile 哈希，扩展 id 进事件名，原因串与诊断消息进日志，放回与摘要输入进模型上下文，改了就是行为变化而测试不一定拦得住（测试按规范不锁措辞）。兜底是 baseline 对照，宿主文字与 kit 自带文字都在里面，它调用的是真实的贡献声明与真实函数，实施时核对 dump 脚本确实取自这些导出，不是另抄一份。
- **新增的浏览器导入链拖进 node 或 OMP**：浏览器早已在运行期值导入 nb-harness（`agent/shared/remote.ts` 经 `kernel/contracts`），本 Task 新增两条：`./kit/shapes`（经 `shared/permissions.ts`、`shared/remote.ts`）、`./kit/files`（经 `files/shared/contracts.ts` 转出 `decodeText`、`renderVirtual`）。这两个入口顺着相对导入只能值导入 `typebox`，类型只能 `import type` 自 `kernel/contracts.js`。兜底是 `kit/architecture.test.ts` 按整条链检查；`vue-tsc -p tsconfig.web.json`（`types` 只有 `vite/client`）只证明类型导入拉进来的文件能过类型检查，不证明打包产物里没有 OMP，后者由链检查与合入前的 `agent-conversation.e2e.ts`（真实构建产物）兜底。
- **kit 的测试改跑 `localFiles` 后与 NeuroBook 的真实行为脱节**：兜底是两个实现各跑一遍的 `SessionFiles` 合同测试；`nbook.files` 改了某个失败码时，应用里那一遍先失败。
- **测试搬走后应用的接线没人测**：兜底是“每块在应用里留一条经真实插件的集成用例”，实施时逐块核对留下的那条确实走到了 `sessionFiles`/`filesFor`、`createApprovalHook` 的 NeuroBook 选项与 `compactionMethods` 的 NeuroBook 参数。
- **改写用例时把行为一起改了**：兜底是每片两次提交，第一次提交时应用的集成测试一行不改照跑通过。
- **nb-form 的可选 peer 让 `./vue` 的消费者缺依赖，或 peer 里的 `workspace:^` 没被改写就发出去**：仓库里 `./vue` 的消费者（应用、nb-story 的网页、冒烟的 Vue 宿主）都已自己直接依赖 nb-ui 与 vue，第 1 片的类型检查、`build:web` 与 `smokeVueHost` 兜底；peer 的改写由第 1 片读 tarball 里的 `package.json` 实测，没改写就停下，不发布。
- **nb-harness 的类型检查顺着 nb-form 的源码检查**：nb-form 以源码发布，nb-harness 的 `tsc` 会检查 nb-form 核心与 `@notnotype/nb-ui/text`（无导入）；两边都是 `strict`、`moduleResolution: bundler`，nb-form 核心没用 ES2022 之后的 API（已搜过），预计能过，第 5 片的 `bun run typecheck` 证实。
- **kit 绕开文件服务写盘**：兜底是 `kit/architecture.test.ts` 的白名单（静态检查导入与 `Bun` 写法），NeuroBook 一侧仍由 `builtin-tools.test.ts`“输出 3”核对写入带会话来源与分组。

## 需要开发者确认

1. **旧 `src/tools/` 不合并、不改，留给 t31 删**（第二稿第 2 条，“决定”表里还没有答复）：nb-story 不用旧的 `read`、`edit`；用到它们的只有 nb-agent-ui 的契约测试与 nb-harness 自己的旧测试（含 `tests/acceptance.test.ts`）。`registerBuiltinTools`、`createReadTool`、`createEditTool` 是已发布包根入口的导出，删除属于发布合同变更。推荐如此：kit 的工具是唯一维护的实现，删除与发布合同的说明记进 t31。Task README“要补回的”表写的是“合并 `nb-harness/src/tools/` 里旧的 read、edit”，确认后那一格随之改。
