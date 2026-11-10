# t32 实施计划：把落在 nbook.agent 里的通用部分补回 nb-harness

## Context

[t02](../t02-harness-baseline/README.md) 决定 3 按“离开 NeuroBook 还能不能用”分工，资源地址的登记机制、审批判定、压缩、通用文件工具归 harness。之后 t06、t11、t12 把压缩方法、审批判定、守卫、会话句柄表、通用工具、资源视图写进了 `nbook.agent`，模型角色与压缩触发点的规则写进了 `nbook.models`。NeuroBot（[w00043](../../../w00043-neurobot/README.md)）在 nb-runtime 上自建、要复用这些能力，而领域包不许依赖应用包（[`packages/AGENTS.md`](../../../../../packages/AGENTS.md)、[`docs/modules/monorepo-boundaries.md`](../../../../../docs/modules/monorepo-boundaries.md)）。本 Task 把实现补回 `packages/nb-harness`，用户可观察的行为、贡献 id、设置、日志里的字符串与界面都不变。

期望结果：nb-harness 多一层“宿主套件”（`src/kit/`），只用内核的公开入口写成，不认识 NeuroBook；`nbook.agent`、`nbook.models` 只剩贡献点接线、NeuroBook 的地址方案与文字、设置与界面。NeuroBot 拿 kit 加自己的文件访问实现与文字就能装出同样的工具、审批、压缩与会话管理。

依据：[ADR 0035](../../../../../docs/adr/0035-harness-log-driven-kernel.md)（扩展只用公开接口、常见写法做成 helper）、[ADR 0040](../../../../../docs/adr/0040-file-writes-staged-and-committed-by-root-owner.md)（读不经文件服务，写只经暂存与根拥有者提交）、[ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)（以源码发 npm，源码值导入的第三方包写进本包依赖）、[ADR 0031](../../../../../docs/adr/0031-nb-story-supports-windows.md)、[t08](../t08-resources-home/README.md) 实施前决定 1（方案都注册进文件服务）、[t11](../t11-compaction/README.md) 决定 5（摘要小节按写小说定）。

开发者已确认：2026-11-09 同意按 t02 决定 3 补回 nb-harness、不新建包，与 t14 的界面静态稿阶段并行；NeuroBot 要让另一个 bot 判定工具调用，本 Task 不实现，但判定接口不能写死判定者（w00043 决定表）。

工作方式与约束：

- 代码在 worktree 里改；Spec 与 Task 记录在主工作区 master 上改（代码合入之后，见“Spec 与文档改动”）。
- 每片搬完就删掉应用里的旧文件、改完全部调用方，不留转发的旧入口（[`common.md`](../../../../../docs/standards/code/common.md)“迁移完整切换消费者并删除旧入口”）。公开入口（`nbook/plugins/agent/shared/*`、`nbook/plugins/models/shared/contracts`、SDK 的 `nbook/sdk/agent`）的导出名不变，需要时改成从 harness 转出。
- 另一个会话在做 t14（多 Agent 的界面静态稿）。本 Task 不碰 t14 的记录与草稿；t14 的前后端实施在本 Task 合入之后开始，它的通用部分直接写进 `nb-harness/src/kit/`。
- `implementation-planning` 要求的“独立设计”这次没有派子代理（派发说明不许开），请审查时一并补上。

## 技术选型

| 通用问题 | 选用 | 理由；否决 |
|---|---|---|
| `bash` 命令解析 | `unbash`（已在 `packages/neuro-book` 依赖里，6.0.3，纯 JS、无依赖、ISC） | 随 `bash-dialect.ts` 原样搬进 nb-harness 的 `dependencies`，应用包去掉这条依赖；不换库 |
| 行锚编辑、搜索、内嵌 shell、`hashline` 排版 | `@oh-my-pi/pi-natives`（nb-harness 已依赖，版本 18.14.0 已锁） | 现有实现就用它；不引 `pi-coding-agent`（包规则禁止） |
| `ask` 的表单校验 | 由宿主注入（`AskForms`），nb-harness 不依赖 `@notnotype/nb-form` | Task README 写“nb-form 只依赖 TypeBox”，实际它的 `dependencies` 有 `@notnotype/nb-ui`（带 `@iconify-json/lucide`、`reka-ui` 等，peer 有 `vue`、`nuxt`）；nb-story 现在只把 nb-form 放 devDependencies。nb-harness 依赖它，`npm i @notnotype/nb-story` 就会装一整套 Vue 组件库。否决“nb-harness 直接依赖 nb-form”（见“需要开发者确认”第 1 条） |
| 图片缩放 | `Bun.Image`（现有实现，nb-harness 内核的 `model/omp.ts` 已在用） | 不加库 |
| 路径通配 | `Bun.Glob`（规则求值现有实现） | 不加库 |

没有用库替换手写实现的地方，不需要对照测试切片。

## 关键设计

### 总体：`packages/nb-harness/src/kit/`

新目录 `src/kit/`（宿主套件）：宿主把内核装成产品时用的通用件。规则：

- 只经内核的公开入口引用内核（`../../kernel/index.js`、`../../kernel/contracts.js`），不引 `kernel/` 内部文件，也不引旧 harness（`src/*.ts`、`src/tools/`）。这与 ADR 0035“常见写法只用公开接口写成”一致，也让 t31 删旧实现、把 `kernel/` 上移一层时只改这一处导入前缀。
- 子目录单向依赖，由 `src/kit/architecture.test.ts` 按目录表检查（写法照 `src/kernel/architecture.test.ts`：TypeScript 语法树读出导入，登记可依赖的目录、包与内置模块）：

| 目录 | 可依赖的 kit 目录 | 外部包 | 内置模块 |
|---|---|---|---|
| `shapes.ts`（单文件） | — | `typebox` | 无（浏览器也要用） |
| `files/` | — | — | `node:fs/promises`、`node:path`、`node:crypto` |
| `commands/` | — | `unbash` | — |
| `tools/` | `files`、`commands`、`shapes` | `@oh-my-pi/pi-natives` | `node:fs`、`node:fs/promises`、`node:os`、`node:path` |
| `approval/` | `files`、`commands`、`shapes` | `typebox` | — |
| `compaction/` | `files`、`tools` | — | `node:fs/promises` |
| `guards/` | — | — | `node:crypto` |
| `sessions/` | — | — | `node:crypto` |

- 同一个架构测试守住 ADR 0040 在 harness 这一侧的不变量“工具不自己写盘”：`tools/`、`compaction/`、`approval/` 从 `node:fs`、`node:fs/promises` 只能具名导入只读的函数（`open`、`stat`、`lstat`、`readFile`、`readdir`、`realpath`、`createReadStream`），源码里不出现 `Bun.write`；唯一例外是 `tools/shell.ts` 的输出暂存（`mkdtempSync`、`openSync`、`writeSync`、`closeSync`、`rmSync`，在 `os.tmpdir()` 里，不在任何根里），按文件名单独放行。写盘只在 `files/local.ts`（本机实现）。
- 子路径导出（`package.json` 的 `exports`，属于公开合同变更，见“需要开发者确认”第 5 条）：`./kit/shapes`、`./kit/files`、`./kit/commands`、`./kit/tools`、`./kit/approval`、`./kit/compaction`、`./kit/guards`、`./kit/sessions`，以及模型规则的 `./models/rules`。
- 文字：NeuroBook 专有的说明文字、提示词、扩展 id、日志里会出现的原因串都由宿主传入；kit 只留与应用无关的文字（放回的提示、shake 的占位、模式闸门的拒绝文字、守卫的提醒）。kit 不给这些宿主文字缺省值，免得出现第三套要维护的提示词。

### `packages/nb-harness/src/kit/files/`：文件访问接口（设计问题 1、2）

现在的依赖：工具、放回与审批都经 `SessionResources`（`agent/shared/resources.ts`，`WorkspaceFiles` 按会话绑定）读写，并直接引用 `nbook/plugins/files/shared/contracts` 的 `decodeText`、`renderVirtual`、`parseAddress`、`Baseline`。实际用到的只有：`expand`、`classify`、`readPath`、`read`、`list`、`write`（`expect` 为基线或 `any`）、`call(call)` 之后的 `write`/`read`、`SessionArtifacts.save`；`update`、`move`、`copy`、`delete` 等内置工具都没用。接口就按用到的定：

```ts
/** kit 会按码分支的失败码；其余码（宿主自己的，例如 `no-project`）原样交给模型。 */
export type KnownFileFailure =
    | "not-found" | "invalid-address" | "unknown-scheme" | "unsupported-capability" /* 没有本机路径：虚拟根 */
    | "protected-path" | "outside-root" | "not-a-file" | "not-a-directory" | "permission-denied" | "too-large" | "cancelled";
export type FileFailure = {readonly ok: false; readonly code: KnownFileFailure | (string & {}); readonly detail: string};
export type FileResult<T> = {readonly ok: true; readonly value: T} | FileFailure;
/** 读到的内容的指纹；只用来交回给 `write` 的 `expect`，kit 不解读。 */
export interface Baseline { readonly hash: string }
export type DirectoryListing =
    | {readonly kind: "entries"; readonly entries: ReadonlyArray<{readonly name: string; readonly kind: string}>}
    /** 虚拟根：条目数与按上限排好的文字（NeuroBook 用 `renderVirtual`）。 */
    | {readonly kind: "virtual"; readonly count: number; render(limit: number): string};

export interface FileCalls {
    read(address: string, options?: {readonly signal?: AbortSignal}): Promise<FileResult<{readonly bytes: Uint8Array; readonly baseline: Baseline}>>;
    write(address: string, content: Uint8Array | string, options: {readonly expect: Baseline | "absent" | "any"; readonly createParents?: boolean; readonly signal?: AbortSignal}): Promise<FileResult<{readonly baseline: Baseline}>>;
}

/** 一个会话看到的文件：地址可以是单数写法，进来先改写。由宿主按 `ToolSessionContext` 建。 */
export interface SessionFiles extends FileCalls {
    readonly layout: SessionLayout;
    /** 单数地址改写成全局地址，全局地址原样通过。 */
    expand(address: string): {readonly ok: true; readonly address: string} | FileFailure;
    /** 写这个地址要不要另外问用户（`ask` 时别的规则放行也问，permissions.md 输出 7）。 */
    classify(address: string): {readonly write: "allowed" | "ask" | "denied"} | FileFailure;
    /** 本机读路径：调用方自己读（ADR 0040 决策 1）。 */
    locate(address: string, options?: {readonly signal?: AbortSignal}): Promise<FileResult<{readonly path: string; readonly kind: "file" | "directory" | "other"}>>;
    list(address: string, options?: {readonly signal?: AbortSignal}): Promise<FileResult<DirectoryListing>>;
    /** 绑定一次工具调用：写入的来源带这次调用、同一次调用的写成一组（builtin-tools.md 输出 3）；`signal` 合进每次调用。 */
    forCall(call: {readonly callId: string; readonly signal: AbortSignal}, info?: {readonly title?: string}): FileCalls;
    /** 以宿主身份存一份全文（resources.md 输出 11）：文件名由宿主生成，写入函数正常结束即提交，交回全局地址。 */
    saveArtifact(label: string, write: (sink: {write(chunk: Uint8Array): Promise<void>}) => Promise<void>): Promise<FileResult<{readonly address: string}>>;
}

/** 这个会话的地址布局：NeuroBook 专有的地址都从这里来，kit 不写死任何方案。 */
export interface SessionLayout {
    /** `shell` 的工作目录与 `grep`、`glob` 的缺省根（可写单数地址）。 */
    readonly working: string;
    /** 模式闸门的草稿根：写只落在这里算“只写草稿”（agent/modes.md）。 */
    readonly scratch: readonly string[];
    /** `auto` 不问模型的写的根（permissions.md 输出 19）。 */
    readonly localWrites: readonly string[];
    /** 交给审批模型的当前项目根；没有为 null。 */
    readonly project: string | null;
    /** 计划文件（模式切换与放回）；没有为 null。 */
    readonly plan: string | null;
    /** 完整对话日志的全局地址（放回的提示）；没有为 null。 */
    readonly log: string | null;
    /** `shell` 的环境变量：名 → 地址；定位不到真实路径的不设。 */
    readonly shellEnv: Readonly<Record<string, string>>;
    /** 以这个全局地址为根搜索时不扫的子目录（以 `/` 开头）。 */
    searchExcludes(root: string): readonly string[];
}

/** 宿主交给 kit 的工厂。`owner` 是建它的工具 id，作 `forCall` 分组的缺省标题；审批、放回、内核资源接口为 null。 */
export type SessionFilesFactory = (context: ToolSessionContext, owner: string | null) => SessionFiles;
```

同目录还有：`decodeText`（严格 UTF-8、BOM 留在文字里、含 NUL 的不是文字，与 `nbook.files` 的同名函数同一规则）、`joinAddress`、`schemeOf`、`failed`/`failure`（把失败码同时放进结果与 `details.code`，现 `builtin/common.ts`）、`kernelResources(files): Resources` 与 `ResourceReadError`（现 `backend/resources.ts` 末尾，改成建在 `SessionFiles` 上）。

`files/local.ts`：本机实现 `localFiles({roots, aliases, layout, artifacts, classify?})`，方案名映射到本机目录，`..` 与经链接逃出根的得 `outside-root`；`write` 按基线核对后写临时文件再改名；`forCall` 不分组。它是 kit 测试用的真实依赖（[测试写法](../../../../../docs/testing/README.md#测试写法)“依赖用真的”），也是 NeuroBot“直接读写 bot 的电脑”的实现（见“需要开发者确认”第 4 条）。

搬走的文件引用留下的文件，逐个处理：

| 引用 | 处理 |
|---|---|
| `builtin/common.ts` → `shared/resources`（`Expanded`、`SessionResources`） | 换成 `SessionFiles`；`globalAddress` 改用 `files.expand` |
| `read.ts` → `decodeText`、`renderVirtual` | `decodeText` 用 kit 的；虚拟根由宿主的 `list` 交回 `kind: "virtual"`，kit 调 `render(500)` |
| `edit.ts` → `Baseline` 类型 | kit 的 `Baseline` |
| `search.ts` → `parseAddress`（只为跳过项目根的 `.nbook/`） | `layout.searchExcludes(root)` |
| `shell.ts` → `workingAddress`、`NBOOK_PROJECT`/`NBOOK_SESSION` | `layout.working`、`layout.shellEnv` |
| `preview.ts` → `shared/remote` 的 `ApprovalPreview` | kit 在 `shapes.ts` 定 `FilePreview`（同形状），`shared/remote.ts` 的 `ApprovalPreview` 改为它的别名 |
| `compaction/restore.ts` → `WorkspaceFiles`、`sessionResources`、`decodeText`、`session://plan.md`、`sessions://<id>/session.jsonl` | `SessionFilesFactory`；`layout.plan`、`layout.log` |
| `permissions/hook.ts` → `WorkspaceFiles`、`sessionResources`、`workingAddress`、`project://`、`session://`、`tmp://`、`readProjectRules` | `SessionFilesFactory` 与 `layout`；项目规则改为选项 `projectRules(context, signal)`，`project-rules.ts` 留在应用 |
| `permissions/modes.ts` → `failed`、`session://plan.md` | kit 的 `failed`；`layout.plan` 与宿主文字 |

NeuroBook 的实现留在 `packages/neuro-book/src/plugins/agent/backend/resources.ts`：现有 `sessionResources`、`sessionArtifacts`、`bind`、`lazy`、`expand`、`classify` 不动（它们也是第三方工具 `services.resources` 的实现，SDK 合同不变），新增

- `sessionLayout(context)`：`working` 有主项目为 `project://`、否则 `session://`；`scratch` 为 `session://`、`tmp://`；`localWrites` 再加有主项目时的 `project://`；`project` 同理；`plan` 为 `session://plan.md`；`log` 为 `sessions://<id>/session.jsonl`；`shellEnv` 为 `NBOOK_SESSION → session://`，有主项目时另加 `NBOOK_PROJECT → project://`；`searchExcludes` 对 `projects://<名>` 交回 `["/.nbook"]`。
- `sessionFiles(workspace, context, owner)` 与 `filesFromServices(services, context)`：在 `SessionResources`、`SessionArtifacts` 外面套一层，`locate` 就是 `readPath`，`forCall` 就是 `resources.call(call, info)`，`saveArtifact` 就是 `artifacts.save`，`list` 把 `VirtualListing` 包成 `{kind: "virtual", count, render}`（截断与“还有几项”的文字仍由 kit 拼，和现在一样）。

这样 ADR 0040 的保证原样保住：读按读授权拿本机路径后自己读；写都经 `WorkspaceFiles.write`/`stage`，带 `as: {agent: {session, profile, entry}}`，由拥有根的进程在锁里提交并记账，同一次调用一个操作分组；全文以宿主身份经 `stage` 写进 `artifacts/`。t08 的方案注册（`backend/schemes.ts` 的五个方案经 `files.schemes`）不动。

### 资源视图与地址怎么切（设计问题 2）

t02 决定 3 的“资源地址的登记机制”归 harness，在 kit 里是 `SessionFiles`/`SessionLayout` 这份合同与建在它上面的 `kernelResources`：宿主经它把“地址怎么改写、怎么定位、怎么写、哪些根有特殊含义”交给 kit。地址的语法（`parseAddress`）、单数别名表、方案注册与授权属于宿主的文件服务（NeuroBook 是 `nbook.files`，[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)），留在应用；kit 不另写一份地址解析器，免得两份语法分叉。

| 文件 | 去向 |
|---|---|
| `agent/backend/resources.ts` | `kernelResources`、`ResourceReadError` 进 `kit/files/`；其余留下，并加 `sessionLayout`、`sessionFiles`、`filesFromServices` |
| `agent/backend/schemes.ts` | 全部留下（具体方案与映射目录） |
| `agent/shared/resources.ts` | 全部留下、不改（SDK 的 `AgentToolServices`） |

### `packages/nb-harness/src/kit/commands/`

`bash-dialect.ts`、`dialects.ts`（`Dialects`、`createDialects`、`commandEffect`）原样搬来，`bash-dialect.test.ts` 跟着搬。`tools/shell.ts` 与 `approval/hook.ts` 都用它，放在两者之下，避免 `tools` 与 `approval` 互相依赖。

### `packages/nb-harness/src/kit/tools/`（设计问题 6）

搬来 `read.ts`、`image.ts`、`write.ts`、`edit.ts`、`search.ts`、`shell.ts`、`shell-address.ts`、`ask.ts`，`preview.ts` 的试算部分，以及 `common.ts` 里的 `SessionEditStores` 与 `read.ts` 的 `renderSnapshot`（合成 `snapshot.ts`，放回也用）。每个工具交出：

```ts
export interface KitTool {
    /** 声明里序列化得了的部分；宿主补 id、`provider`、`providerName`。 */
    readonly declaration: {readonly description: string; readonly parameters: Readonly<Record<string, unknown>>; readonly version: string; readonly concurrency: "shared" | "exclusive"; readonly effect: ToolEffect; readonly customFormat?: {readonly syntax: "lark"; readonly definition: string}};
    create(context: ToolSessionContext, files: SessionFiles): ToolImplementation;
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
export interface AskForms {
    /** Agent 策略下不合规时交回问题（路径与码），合规交回空数组。 */
    check(form: Readonly<Record<string, unknown>>): readonly {readonly path: string; readonly code: string}[];
    /** 回答的表单值不合规时交回问题码。 */
    validate(form: Readonly<Record<string, unknown>>, value: unknown): readonly string[];
}
export function builtinTools(options: {readonly stores: SessionEditStores; readonly dialects: Dialects; readonly texts: BuiltinToolTexts; readonly forms: AskForms}):
    Readonly<Record<"read" | "write" | "edit" | "editReplace" | "grep" | "glob" | "shell" | "ask" | "askForm", KitTool>>;
/** 审批预览的试算（builtin-tools.md 输出 26）：宿主按自己的工具 id 选 `kind`。 */
export function previewChanges(kind: "write" | "hashline" | "replace", args: Readonly<Record<string, unknown>>, files: SessionFiles, stores: SessionEditStores, sessionId: string, signal: AbortSignal): Promise<FilePreview>;
```

`ToolSubject` 在 `kit/shapes.ts`（与 `agent/shared/points.ts` 的同名类型同形状）。points.ts 的 `ToolSubject` 是 SDK 的公开类型，留在应用不动：它经 `subjectsOf` 交给 kit 的审批钩子时由编译器核对可赋值，不需要另写检查。SDK 的类型面因此不变（`src/sdk/surface.test.ts`、`plugin-sdk/build-plugin.test.ts` 守着）。

NeuroBook 一侧 `agent/backend/builtin/index.ts` 留下：贡献 id 与 `providerName` 的表、`BuiltinToolTexts` 的 NeuroBook 文字（新文件 `builtin/texts.ts`，原样取自现在的声明）、`AskForms` 的 nb-form 实现（`checkDescription(form, {policy: "agent"})`、`validateForm(resolveForm(form), value)`），以及把 `KitTool` 包成 `AgentToolImplementation` 的一层（`create: (context, services) => tool.create(context, filesFromServices(services, context))`）。`builtin/preview.ts` 只剩工具 id 到 `kind` 的表与调用 `previewChanges`。`backend/attachments.ts` 的 `imageFormat`、`prepareImage` 改从 `@notnotype/nb-harness/kit/tools` 取。

nb-harness 现有的 `src/tools/`（`read`、`edit`、`registry`、`bridge`、`effective`、`builtin`）不合并、不改。查清的调用方：nb-story 经根入口用 `createHarness`、`createToolRegistry`、`registerPlugin`（`src/qa/engine.ts`、`probe.ts`、`tools.ts`），不用旧的 `read`、`edit`；`registerBuiltinTools` 只有 `nb-agent-ui/src/harness.contract.test.ts` 与 nb-harness 自己的 `tests/harness.llm.test.ts` 在用；`createReadTool`、`createEditTool` 只有 nb-harness 的 `tests/read-tool.test.ts`、`edit-tool.test.ts`。它们属于旧 `createHarness` 的合同（交给 OMP `Agent` 的 `AgentTool`），与 kit 的 `ToolImplementation` 形状不同，按包 AGENTS.md“旧实现只为让它们的测试照跑，不再加功能”冻结，随 `createHarness` 在 [t31](../t31-nb-story-new-kernel/README.md) 一起删；合入时在 t31 的“要做的事”补这一条。kit 的工具是之后唯一维护的读、改实现。nb-story 不加载 kit；它装 nb-harness 时多装一个 `unbash`（纯 JS），Windows 上不受影响（kit 的 `shell` 等在 Windows 上能不能用未核实，nb-story 用不到）。

### `packages/nb-harness/src/kit/approval/`（设计问题 5）

搬来 `rules.ts`、`judge.ts`、`hook.ts`、`auto-review.ts`（改名 `review.ts`）、`modes.ts` 的机制部分；`rules.test.ts` 跟着搬。`kit/shapes.ts` 收 `RuleSchema`、`RulesSchema`、`Rule`、`RuleAction`、`AgentMode`、`MODE_SWITCH_KIND`、`ModeSwitchRequest`、`ModeSwitchAnswer`、`ToolSubject`、`FilePreview`，`agent/shared/permissions.ts` 改为转出它们，并保留 NeuroBook 自己的常量（`AGENT_MODES_EXTENSION`、三条审批原因串）。规则的存储形状因此只有一份。

判定链与判定者：

```ts
export interface ReviewRequest {
    readonly call: ToolCall;
    readonly effect: ToolEffect;
    /** 展开过的判定路径。 */
    readonly paths: readonly PathSubject[];
    /** `layout.project` 展开后的地址；没有为 null。 */
    readonly project: string | null;
}
/** 判定流水线判出“交给审批者”时调用。可以放行、拒绝或转问用户；不会被调用于规则或闸门已经定了的调用。 */
export type Reviewer = (request: ReviewRequest, ctx: ApprovalCtx) => Promise<ApprovalVerdict>;

export function createApprovalHook(options: {
    readonly files: SessionFilesFactory;
    readonly userRules: () => readonly Rule[];
    /** 宿主的项目层规则；没有项目为 `[]`，读不了为 `"invalid"`（NeuroBook 读 `.nbook/permissions.json`）。 */
    readonly projectRules: (context: ToolSessionContext, signal: AbortSignal) => Promise<readonly Rule[] | "invalid">;
    readonly dialects: Dialects;
    readonly modeWriteAction: () => ModeWriteAction;
    readonly subjectsOf: (tool: string, args: Readonly<Record<string, unknown>>, activate: boolean) => Promise<readonly ToolSubject[] | null>;
    readonly modeOf: (read: ApprovalCtx["read"]) => string;
    readonly review: Reviewer;
    /** 闸门转问用户时的原因串（进日志，宿主定）。 */
    readonly modeGateReason: string;
    readonly report: (code: string, message: string, params?: Record<string, unknown>) => void;
}): ApproveHook;

export function modelReviewer(options: {
    /** 系统提示词里对 Agent 的称呼（NeuroBook：“a writing and coding agent”）。 */
    readonly agentDescription: string;
    /** 判定工具声明的 `provider`（进日志的请求里）。 */
    readonly provider: string;
    /** 没判出来、转人工的原因串（宿主定，界面按它换成本地文字）。 */
    readonly reasons: {readonly failed: string; readonly escalatedPrefix: string};
    readonly report: (code: string, message: string, params?: Record<string, unknown>) => void;
    readonly timeoutMs?: number;
}): Reviewer;
```

怎么接：内核只认 `ApproveHook`（`kernel/api/host.ts`），它是 `SessionEnv.approve`，宿主整体可换。kit 的 `createApprovalHook` 是一种实现：三层规则、模式闸门与 `decide`（`judge.ts`，纯函数，导出）先判；`decide` 交回 `review` 时调 `options.review`，判定者是谁由宿主给。NeuroBook 给 `modelReviewer`（就是现在的 `autoReview`，“审批模型”）。NeuroBot 要“另一个 bot 判定”时写一个 `Reviewer`：把 `ReviewRequest` 发给判定 bot 的会话、等它的结论，交回放行、拒绝或转问用户；不必改 kit，也不必改内核。转问用户的那一步仍由内核的审批交互完成；内核的 `resolve` 只收用户应答审批（`kernel/run/interaction.ts` 的 `allowed`），所以“bot 回答已经弹出的审批请求”不在这条路上，那要改内核，留给 NeuroBot 的 Task。`review` 只在 `decide` 判到第 6 步（`auto`）时调用；NeuroBot 若要所有写都过判定者，可以直接用导出的 `decide` 与 `createApprovalHook` 之外的组合自建钩子。

`decide` 的 `MODE_ASK_REASON` 改成参数 `modeGateReason`；`MODE_BLOCKED_TEXT`（英文、与应用无关）留在 kit。项目规则读坏时的诊断码 `permission-rules-invalid` 不变，消息去掉 `.nbook/` 字样（只有码被测试断言）。

模式（`modes.ts`）：kit 交出 `createAgentModes({extensionId, reminderId, texts})`，返回 `{contract, extensions, switchModeTool(changeSettings), switchModeDeclaration}`。`texts` 含两种模式的完整与简短提示、退出提示、`switch_mode` 的说明与提问文字；计划文件地址取 `layout.plan`。NeuroBook 的 `agent/backend/permissions/modes.ts` 只剩一处 `createAgentModes({extensionId: AGENT_MODES_EXTENSION, reminderId: "nbook.agent.mode-reminder", texts: …})`，现在的文字原样搬进来；主 Profile 与钩子的 `modeOf` 用它交出的 `contract`。

留在 `agent/backend/permissions/`：`project-rules.ts`、`modes.ts`（实例与文字）、新文件 `index.ts`（`createApprovalHook` 的 NeuroBook 选项：设置、`readProjectRules`、`modelReviewer({agentDescription: "a writing and coding agent", provider: "nbook.agent", reasons: …})`）。

### `packages/nb-harness/src/kit/compaction/`（设计问题 4）

搬来 `cuts.ts`、`replies.ts`、`shake.ts`、`inplace.ts`、`summary.ts`、`restore.ts`；`compaction-methods.test.ts` 的“切点”“摘要的输入”“模型的回复”三组跟着搬，“贡献点的方法表”留下（测的是接线）。

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
    constructor(options: {readonly files: SessionFilesFactory; readonly editStores: SessionEditStores; readonly tools: BuiltinToolIds; readonly report: …});
    forget(sessionId: string): void;
    readonly run: (context: ToolSessionContext, args: CompactionRestoreArgs) => Promise<CompactionRestored>;
}
```

摘要模型按角色 `compaction` 取（`summary.ts` 的 `{role: "compaction"}`），角色 id 用 `models/rules.ts` 的常量。NeuroBook 一侧 `agent/backend/compaction/` 留下 `index.ts`（`CompactionMethods` 接收者、三个方法 id、`DEFAULT_COMPACTION_ORDER`、贡献声明）与 `prompts.ts`（现在的文字原样，改成交出一个 `CompactionPrompts` 对象），新增 NeuroBook 的 `BuiltinToolIds`（与 `builtin/index.ts` 共用一处常量）。

小节只由宿主在建方法时给，不做按 Profile 换：Profile 已有 `compaction.require` 追加要求；按 Profile 换整套小节要改内核的 Profile 类型，不在本 Task（见“需要开发者确认”第 3 条）。

要搬的代码里另找到的写小说或 NeuroBook 专有的文字，全部改成宿主给、NeuroBook 原样传入：

| 位置 | 内容 | 改成 |
|---|---|---|
| `compaction/prompts.ts` | 七个小节、“写作对话”“接着写” | `CompactionPrompts` |
| `permissions/auto-review.ts` | “a writing and coding agent”；判定工具的 `provider: "nbook.agent"` | `modelReviewer` 的 `agentDescription`、`provider` |
| `permissions/modes.ts` | “不改作品”等提示、`session://plan.md`、扩展与提醒 id | `createAgentModes` 的 `texts`、id；`layout.plan` |
| `builtin/read.ts`、`write.ts`、`edit.ts`、`shell.ts` 的说明 | `project://正文/第一章.md`、`$NBOOK_PROJECT`、`session://artifacts/` | `BuiltinToolTexts` |
| `compaction/shake.ts`、`restore.ts`、`builtin/preview.ts` | `nbook.agent.read` 等工具 id | `BuiltinToolIds`；预览的 id 表留在应用 |
| `guards/*.ts`、`session-meta.ts` | 扩展 id（事件名 `<扩展 id>/<名字>` 进日志） | 工厂参数 |
| `permissions/hook.ts`、`judge.ts` | 三条 `nbook.agent/…` 原因串 | 参数 |
| `session-meta.ts` | 标题 Profile key、标签、给标题模型的材料格式 | `SessionMeta` 选项 |

保持不变的通用文字（kit 自带）：放回的两句提示、shake 的三种占位、`MODE_BLOCKED_TEXT`、循环守卫的提醒、`ask` 与 `grep`、`glob`、`read` 的说明主体。

### `packages/nb-harness/src/kit/guards/`、`src/kit/sessions/`（设计问题 3）

- `guards/`：`costGuard({id, limits})`、`loopGuard({id, threshold})`、`refusal`；`guards.test.ts` 整个搬来（只用 `createTestSession`）。`agent/backend/guards/index.ts` 留下：两个 id、贡献声明、按设置现读的闭包。
- `sessions/table.ts`：`SessionTable`、`IDLE_CLOSE_MS`，错误类改名 `SessionUnavailable`、`SessionTableStopping`（`code` 仍是 `unavailable`；消息不再写 `nbook.agent`，没有测试断言消息）。时钟从 nb-runtime 的 `RuntimeClock.schedule` 改为内核的 `Clock`（`kernel/api/basics.ts`）：空闲计时用 `clock.wait(IDLE_CLOSE_MS, controller.signal).then(复查并关闭, 忽略中止)`，取消就 `controller.abort()`。核实过的时序：到点时的复查仍在同一个同步段里做完（`then` 回调内），只比现在晚一个微任务；NeuroBook 传入的是 `agent.ts` 现有的 `kernelClock(options.clock)`，它在 `schedule` 回调里 resolve；`agent.test.ts` 推进时钟之后用 `waitUntil` 等关闭，不依赖同步关闭。
- `sessions/meta.ts`：`SessionMeta`、`sessionMetaExtension({id, tag, notify})`、`titleSessionId`（`session-title-<哈希>` 已有会话在用，不变）。选项加 `titleProfile`（NeuroBook：`SESSION_TITLE_PROFILE`）与 `material`（第一轮与压缩后两种输入文字，原样取自现在的代码）；`CreateResult` 换成内核的结果形状。贡献声明 `SESSION_META_CONTRIBUTION` 留在应用。
- 接线留在 `nbook.agent`：`shared/points.ts` 的贡献点、`compaction/index.ts`、`guards/index.ts`、`builtin/index.ts`、`tools.ts`（`agent.tools` 接收者）、`extensions.ts`、`profiles.ts`、`agent.ts` 的装配、`plugin.ts`。nb-harness 不加 nb-runtime 依赖，由架构测试守住。

### `packages/nb-harness/src/models/rules.ts`（设计问题 7）

搬：`models/shared/rules.ts` 全部（模型引用写法 `splitReference`、`referenceOf`、`roleReference`、`roleOfReference`，`providerIdFor`、`missingContextWindow`、`rolesUsing`、`seriesOf`，参数类型改成结构类型 `Pick<…>`），`models/shared/compaction.ts` 全部（`CompactionSettingSchema`、`DEFAULT_COMPACTION`、`compactionTrigger`、`effectiveCompaction`），以及 `models/backend/core.ts` 里 `port.resolve` 的选择顺序，抽成纯函数：

```ts
/** 内核按用途要的角色；宿主的角色表里必须有这几个 id。 */
export const MODEL_ROLES = {main: "main", fast: "fast", compaction: "compaction"} as const;
/** 一次模型查询选哪一个：指定的角色、会话选的（模型引用或 `role:<id>`）、Profile 缺省的模型或角色（docs/specs/models/service.md 输出 8）。 */
export function modelChoice(query: ModelQuery, defaults: {readonly model?: string; readonly role?: string}):
    | {readonly kind: "role"; readonly id: string} | {readonly kind: "selection"; readonly value: string} | {readonly kind: "reference"; readonly value: string};
```

理由：kit 的摘要方法按 `compaction` 角色取模型，审批模型按用途 `approval`、取不到时退回会话模型；NeuroBot 的模型端口要按同一规则选，kit 才能用。`core.ts` 改成按 `modelChoice` 的结果分派，`settings.ts` 的 `BUILTIN_ROLES` 用 `MODEL_ROLES` 的 id。

留下：设置项定义（`settings.ts` 的 `defineSettings`、供应商与角色的 schema、`BUILTIN_ROLES` 的轴与顺序）、`core.ts` 的服务（凭据、读改写、检测、发现、远程合同）、设置页。

`./models/rules` 是浏览器也要用的子路径（`ProvidersPage.vue`、`ManageModelsDialog.vue`、`RolesPage.vue`、`ModelEditDialog.vue`、Lab 的 `models-scene/fake-remote.ts` 在用）：`rules.ts` 只引 `typebox`，不经 `models/index.ts`（那里引 OMP）。`src/models/boundary.test.ts` 的允许表加 `typebox`，并单独核对 `rules.ts` 不引 `node:` 与 OMP。消费者全部改成从 `@notnotype/nb-harness/models/rules` 取，删掉两个旧文件；`models/shared/contracts.ts` 对外的 `roleOfReference`、`roleReference` 改为从 harness 转出（公开入口不变）。`models/shared/compaction.test.ts` 搬成 `nb-harness/src/models/rules.test.ts`，另加一条：`reserve` 模式不写基数时与内核 `triggerPoint` 的缺省一致（现在两处各写一份 15% 与 16,384，靠注释说一致）。

### `packages/nb-harness/src/app-neutral.test.ts`（设计问题 8）

照 `packages/nb-runtime/src/app-neutral.test.ts`：扫 `src/` 下全部非测试源码（含旧 harness 与内核），注释里也不许出现 `/nbook|neurobook/i`；导入说明符不许以 `nbook/`、`@notnotype/neuro-book`、`@notnotype/nb-runtime` 开头；`package.json` 的 `dependencies` 不含这三者。现有命中只有三处注释（`models/index.ts`、`kernel/api/model.ts`、`kernel/api/host.ts`），改写成“宿主”的说法。kit 的测试文件也用中性 id（`builtin.read` 之类），虽然扫描不管测试。

### `packages/nb-harness/AGENTS.md`、`README.md`、`docs/omp-capabilities.md`

- AGENTS.md 开头“NeuroBook 领域 harness，不追求通用”与本 Task 的目标冲突，改为：内核加宿主套件，NeuroBook 与 NeuroBot 共用，应用专有的地址、文字与 id 由宿主传入。“领域工具不在本包内实现”保留（kit 的工具是通用工具）。加 `src/kit/` 一节：分层表由 `kit/architecture.test.ts` 检查、只经内核公开入口、写盘只在 `files/local.ts`、宿主文字不给缺省值；完成门禁加上 kit 的测试。
- README.md 加 kit 与 `./models/rules` 子路径的一段。
- `docs/omp-capabilities.md` 补 kit 用到的 `pi-natives` 能力（`EditSession`、`hashline*`、`grep`、`glob`、`executeShell`），先读它现有的表再按格式加。

## Spec 与文档改动

行为合同不变，只改 owner、实现合同与证据（[`docs/specs/README.md`](../../../../../docs/specs/README.md#实现合同与证据)）。这几份的证据行链接了要搬的文件，`docs:check` 检查活跃文档的链接，所以 Spec 在代码合入 master 之后、在主工作区紧接着提交，不在分支上改。

| 文件 | 改什么 |
|---|---|
| `docs/specs/agent/builtin-tools.md` | `owners` 加 `nb-harness`；实现合同：公开入口加 `@notnotype/nb-harness/kit/tools`（实现）与 `nbook.agent` 的 id、说明文字、`SessionFiles` 实现；依赖方向写 `nbook.agent` → kit，kit 经宿主的 `SessionFiles` 读写；“工具不自己写盘”加上 `kit/architecture.test.ts`；证据的实现入口与合同测试改到新路径 |
| `docs/specs/agent/compaction.md` | `owners` 加 `nb-harness`；实现合同写方法与放回在 kit、摘要提示词与方法 id 在 `nbook.agent`；证据路径 |
| `docs/specs/agent/permissions.md` | `owners` 改为 `nb-harness` 与 `…/agent/backend/permissions`；依赖：`unbash` 改在 nb-harness；判定在 kit 的 `createApprovalHook`，`nbook.agent` 给规则、项目层、审批者与原因串；证据路径 |
| `docs/specs/agent/sessions.md` | 实现合同：句柄表的实现在 `kit/sessions`，实例由 `nbook.agent` 持有；证据路径 |
| `docs/specs/agent/run-guards.md` | 实现入口与合同测试路径（`guards.test.ts` 移到 nb-harness）；owner 加 `nb-harness` |
| `docs/specs/agent/modes.md` | owner 加 `nb-harness`；`backend/permissions/modes.ts` 的说明改为“实例与文字”，机制在 `kit/approval/modes.ts` |
| `docs/specs/agent/resources.md` | 实现合同加 `SessionFiles` 的 NeuroBook 实现（`backend/resources.ts`）与 `kernelResources` 在 kit；证据路径 |
| `docs/specs/agent/builtin-profiles.md` | 证据的 `backend/session-meta.ts` 改到 `kit/sessions/meta.ts` 与 NeuroBook 的接线处 |
| `docs/specs/models/service.md` | 公开入口加 `@notnotype/nb-harness/models/rules`；`shared/rules`、`shared/compaction` 的提法改到新位置 |
| `docs/specs/harness/*.md` | 不改：内核的行为与接口（`ApproveHook`、`SessionEnv.compaction`、`Resources`、`Clock`）都没变；kit 不新开 Spec，它的行为合同就是上面几份 `agent/*.md` 经 NeuroBook 实例表达的那些条目，NeuroBot 用 kit 时在自己的 Spec 里引用 |
| `docs/modules/monorepo-boundaries.md` | nb-harness 那一行改为“内核与宿主套件，NeuroBook 与 NeuroBot 共用” |
| `.agents/works/w00032-agent-integration/README.md`、t31 README | 合入后在主工作区记：t32 完成；t31“要做的事”加“删 `src/tools/` 与 `registerBuiltinTools`、`createReadTool`、`createEditTool`” |

## 切片

开工前（不提交）：在 worktree 里写一个一次性脚本，把下面的值 dump 成 JSON 存到 `.local/agent/works/w00032-agent-integration/tasks/t32-harness-backfill/baseline.json`：全部内置工具贡献的声明（`BUILTIN_TOOL_CONTRIBUTIONS`）、`inplacePrompt`/`summarySystem`/`summaryInput` 对两组 `require` 的输出、模式提醒对每对新旧模式的输出、审批模型请求的 `system` 与工具声明、三条原因串、两个守卫与会话元数据的扩展 id。每片改完对一次，最后一片再对一次，必须逐字相同（工具声明进 Profile 哈希与会话快照，字不同就是行为变化）。

| 片 | 内容（对应关键设计） | 提交边界 | 自跑验证 |
|---|---|---|---|
| 1 | `kit/architecture.test.ts`（先只登记已建的目录）、`src/app-neutral.test.ts` 与三处注释、`kit/shapes.ts` 的骨架、AGENTS.md 的 kit 一节 | 一次提交 | nb-harness：`bun run typecheck`；`bun test src/kit src/app-neutral.test.ts` |
| 2 | `models/rules.ts` 与 `./models/rules`；`core.ts` 改用 `modelChoice`；web 与 Lab 的消费者；删 `shared/rules.ts`、`shared/compaction.ts` | 一次提交 | nb-harness：`bun test src/models`；neuro-book：`bun test src/plugins/models`、`bun run test:vitest src/plugins/models`、`bun run typecheck`（含 `vue-tsc`，确认浏览器能解析 harness 的纯子路径） |
| 3 | `kit/files/`（接口、`decodeText`、`kernelResources`、`localFiles` 与测试）；NeuroBook 的 `sessionLayout`、`sessionFiles`、`filesFromServices`；`agent.ts` 的 `resources` 改用 kit 的 `kernelResources` | 一次提交 | nb-harness：`bun test src/kit/files`；neuro-book：`bun test src/plugins/agent/resources.test.ts src/plugins/agent/agent.test.ts` |
| 4 | `kit/commands/`（加 `unbash` 依赖，应用删掉）；`kit/tools/` 的 `snapshot`、`read`、`image`、`write`、`edit`、`search`、`preview`；`builtin/index.ts`、`texts.ts`、`preview.ts`、`attachments.ts` 改接线；测试按“验证”一节的规则搬 | 一次提交 | nb-harness：`bun test src/kit`；neuro-book：`bun test src/plugins/agent/builtin-tools.test.ts src/plugins/agent/builtin-tools-project.test.ts src/plugins/agent/attachments.test.ts src/plugins/agent/permissions.test.ts`；对 baseline |
| 5 | `kit/tools/` 的 `shell`、`shell-address`、`ask`（`AskForms` 注入）；接线；测试 | 一次提交 | 同上，加 `session-host.test.ts`；对 baseline |
| 6 | `kit/compaction/`；`compaction/index.ts`、`prompts.ts` 改接线；`CompactionRestore` 改用 `SessionFilesFactory` 与 `BuiltinToolIds`；测试 | 一次提交 | nb-harness：`bun test src/kit/compaction`；neuro-book：`bun test src/plugins/agent/compaction.test.ts src/plugins/agent/compaction-methods.test.ts src/plugins/agent/builtin-profiles.test.ts`；对 baseline |
| 7 | `kit/shapes.ts` 补规则与模式形状；`kit/approval/`；`permissions/` 只留实例、项目规则与选项；`shared/permissions.ts` 转出；`shared/remote.ts` 的 `ApprovalPreview` 改别名 | 一次提交 | nb-harness：`bun test src/kit/approval src/kit/commands`；neuro-book：`bun test src/plugins/agent/permissions.test.ts src/plugins/agent/modes.test.ts src/plugins/agent/auto-review.test.ts src/plugins/agent/session-host.test.ts`、`bun run test:vitest src/plugins/agent/web`、`bun run typecheck`；对 baseline |
| 8 | `kit/guards/`、`kit/sessions/`；`guards/index.ts`、`agent.ts`、`plugin.ts` 改接线；删应用里的旧文件 | 一次提交 | nb-harness：`bun test src/kit`；neuro-book：`bun test src/plugins/agent`；对 baseline |
| 9 | nb-harness README、`omp-capabilities.md`；最后一次对 baseline；“验证”一节的合入前清单 | 一次提交 | 见“验证” |
| 合入后 | 主工作区：Spec、`monorepo-boundaries.md`、Work README、t31 README | 一次提交（`git commit -- <路径>`） | `bun run docs:check`、`bun run governance:check` |

顺序的理由：文件接口是工具、放回、审批共同的底；放回要用工具的行锚快照，审批要用方言与工具交出的判定对象，所以压缩与审批排在工具之后；守卫与会话不依赖别的块，放最后收尾。每片结束时应用都完整可用，不存在搬了一半的块。

## 验收映射

行为不变，每条输出由原来的测试守着；下表写这一次之后每条由哪里覆盖。“kit”指 nb-harness 里跟着代码搬来的测试（用 `localFiles` 与 `createTestSession`），“应用”指 `packages/neuro-book/src/plugins/` 下留下的测试。

| Spec 编号 | 覆盖 |
|---|---|
| `agent.builtin-tools` 输出 5、7、9、10、12、13、14、16、17、20、21、22、23、24、25、26，验收 2、3、4 | kit：`tools/*.test.ts`（从 `builtin-tools.test.ts` 搬来的对应用例）；应用：`builtin-tools.test.ts` 留下的“声明”与每个工具一条经真实插件的用例 |
| `agent.builtin-tools` 输出 1、3、4、6、8、11、15、18、19 | 应用：`builtin-tools.test.ts`（全局地址、来源与分组、全文、虚拟根、链接、不露出的文件、地址替换遇到虚拟或受保护的位置）、`builtin-tools-project.test.ts` |
| `agent.compaction` 输出 1–6，验收 1–3 | kit：`compaction/*.test.ts`；应用：`compaction.test.ts`“方法与缺省顺序”“切点”“溢出” |
| `agent.compaction` 输出 7–11 | kit：`compaction/restore.test.ts`；应用：`compaction.test.ts`“放回”第一条（NeuroBook 的计划与日志地址） |
| `agent.compaction` 输出 12 | 应用：`compaction-methods.test.ts`“贡献点的方法表”、`compaction.test.ts`“贡献的方法” |
| `agent.permissions` 输出 1、2、5、10–17 | kit：`approval/rules.test.ts`、`commands/bash-dialect.test.ts` |
| `agent.permissions` 输出 18–21 | kit：`approval/review.test.ts`（从 `auto-review.test.ts` 搬来“问审批模型”“模型看到什么”）；应用：`auto-review.test.ts` 留下“用户设置的写一律问用户”（`user://` 的分类） |
| `agent.permissions` 输出 3、4、6–9、22、23，验收 1–9 | 应用：`permissions.test.ts`、`builtin-tools-project.test.ts`、`web/permission-page.dom.test.ts`、`agent-conversation.e2e.ts` |
| `agent.modes` 全部 | 应用：`modes.test.ts`、`session-host.test.ts`“Agent 模式”、`agent-conversation.e2e.ts` |
| `agent.sessions` 输出 5、6 | kit：`sessions/table.test.ts`（`createAgentHost`、内存存储、`createTestClock`）；应用：`agent.test.ts`“会话” |
| `agent.sessions` 输出 7–15 | 应用：`sessions.test.ts`、`tasks.test.ts`、`agent.test.ts`“停止时……” |
| `agent.run-guards` 输出 3–12，验收 1、2 | kit：`guards/guards.test.ts`；应用：`agent.test.ts`“运行保护的接线” |
| `agent.resources` 输出 1、2、4–8、10、11 | 应用：`resources.test.ts`、`builtin-tools.test.ts`“全文” |
| `agent.resources` 输出 9 | kit：`files/kernel-resources.test.ts`；应用：`resources.test.ts` |
| `agent.builtin-profiles` 输出 6–13 | 应用：`builtin-profiles.test.ts`（标题 Profile 是 NeuroBook 的，用例不搬） |
| `models.service` 输出 8、9、15、17 | kit：`models/rules.test.ts`；应用：`models.test.ts` |
| 计划自己的要求：kit 不认识应用、不依赖 nb-runtime 与应用包、工具不自己写盘、`./kit/shapes` 与 `./models/rules` 不引 node 与 OMP | nb-harness：`src/app-neutral.test.ts`、`src/kit/architecture.test.ts`、`src/models/boundary.test.ts` |
| 计划自己的要求：文字、id、原因串逐字不变 | baseline 对照（每片与合入前） |

测试怎么拆，规则只有一条：断言依赖 NeuroBook 的地址方案、文件服务的授权、来源与分组、贡献 id 或 NeuroBook Profile 的留在应用；只断言工具、方法、规则自身行为的跟代码搬进 kit，改用 `localFiles`。每一块在应用里至少留一条经真实插件的集成用例证明接线。按这条规则 `builtin-tools.test.ts` 大约一半用例搬走：“read”的分页、大文件、非法 UTF-8、图片，“edit”的引擎规则、裸路径、增删移动、部分失败，“grep 与 glob”的配额与期限，“shell”的环境、引号替换、输出窗口与全文保存，“ask”的回答校验，“审批预览”的试算；直接调 `runGrep`、`runGlob`、`previewEdit` 的用例全部搬。`rules.test.ts`、`bash-dialect.test.ts`、`guards.test.ts`、`models/shared/compaction.test.ts` 整个搬。`permissions.test.ts`、`modes.test.ts`、`sessions.test.ts`、`tasks.test.ts`、`resources.test.ts`、`builtin-profiles.test.ts`、`builtin-tools-project.test.ts` 不搬。

## 验证

- 每片的命令见“切片”。包内跑文件时在包目录执行（`bun run test <路径>` 或 `bun test <路径>`），不在命令里接 `&&` 后再提交。
- 合入前跑一次：
  - `bun run test:affected --typecheck`（仓库根）：会选中 nb-harness 与依赖它的 neuro-book、nb-story、nb-agent-ui。长验证前看 `/proc/loadavg`，失败先分产品、测试与环境，单独重跑确认。
  - nb-harness 完成门禁：`bun run typecheck`、`bun test`（含 `tests/session.test.ts`、`acceptance.test.ts`、`provider.test.ts`，内核没改，按包 AGENTS.md 仍跑）。
  - `bun run release:check`（只读：核对会发布的源码导入都写进了依赖，`unbash` 漏写会在这里报）；`bun run release:smoke` 跑一次（从打好的包装 nb-story 与它的依赖；要联网装第三方包，慢时加 `prox`），确认 nb-story 装得上、跑得起来。
  - `bun run governance:check`、`bun run docs:check`。
  - 浏览器 e2e，3 个文件：`agent-conversation.e2e.ts`（审批、预览、模式切换、提问、规则写入）、`agent-profiles.e2e.ts`（工具绑定与声明）、`models.e2e.ts`（设置页改用 harness 的纯子路径）。按 `packages/neuro-book` 的 `test:e2e` 自己构建；跑前停掉多余的开发服务。
  - 真实模型：`bun run --cwd packages/neuro-book test:llm` 只跑 `compaction.llm.test.ts`、`permissions.llm.test.ts`、`builtin-tools.llm.test.ts`、`run-guards.llm.test.ts`、`agent.llm.test.ts`；缺凭据时记“未验证”。
  - 变异检查：对 `kit/architecture.test.ts` 的只读名单、`app-neutral.test.ts`、`modelChoice` 的选择顺序、`createApprovalHook` 调 `review` 的条件各改坏一次，确认对应测试失败后还原（先提交或备份再改，不用 `git checkout` 还原）。
- 实施中改动之后只重跑覆盖改动的文件和失败项；e2e 只在第 5、7 片之后各重跑 `agent-conversation.e2e.ts` 一次，其余留到合入前。
- 明确留下的未验证边界：Windows（ADR 0031 只由开发者的 Windows 机器实测；nb-story 不加载 kit，只多装 `unbash`）；kit 的 `shell`、`grep`、`glob` 在 Windows 上的行为；NeuroBot 实际接上 kit（本 Task 不做）。

## 不做与风险

不做：NeuroBot 的任何代码与它的文件访问配置；bot 应答已弹出的审批请求（要改内核 `allowed`）；按 Profile 替换摘要小节；`tools.ts`、`profiles.ts`、`frames.ts`、`remote.ts` 这类 nb-runtime 接线与远程投影的抽取（Task README 已定等 NeuroBot 写出来再比）；旧 `src/tools/` 与 `createHarness` 的删除（t31）；nb-harness 升版本与发布（远端写入，另请授权；nb-story 不需要新版本）；t14 的子代理与任务中心。

风险与兜底：

- **文字或 id 被改了一个字**：工具声明进 Profile 哈希，扩展 id 进事件名，原因串进日志，改了就是行为变化而测试不一定拦得住（测试按规范不锁措辞）。兜底是 baseline 对照，它调用的是真实的贡献声明与真实的提示词函数，实施时核对 dump 脚本确实取自这些导出，不是另抄一份。
- **浏览器第一次在运行期导入 nb-harness**（`./kit/shapes` 经 `shared/permissions.ts`，`./models/rules` 经设置页）：现在 web 只从 nb-harness 导入类型。兜底是第 2、7 片的 `vue-tsc` 与 Vitest 的 DOM 用例（Vitest 用前端的 Vite 配置解析），以及合入前的 `models.e2e.ts`、`agent-conversation.e2e.ts`（真实构建产物）。
- **两份 `decodeText`**（kit 与 `nbook.files`）：规则一样，分叉了 `read` 与写入接口对“是不是文字”的判断会不同。兜底是应用的 `resources.test.ts` 加一条用同一组字节（BOM、NUL、非法 UTF-8、空）比两者结果。
- **`SessionTable` 换时钟**：只比现在晚一个微任务；兜底是 `agent.test.ts`“会话”与“停止”几条（真实插件、nb-runtime 的手动时钟经 `kernelClock`）和 kit 的 `sessions/table.test.ts`（内核的手动时钟）。
- **测试搬走后应用的接线没人测**：兜底是“每块在应用里留一条经真实插件的集成用例”，实施时逐块核对留下的那条确实走到了 `filesFromServices`、`createApprovalHook` 的 NeuroBook 选项与 `compactionMethods` 的 NeuroBook 参数。
- **kit 绕开文件服务写盘**：兜底是 `kit/architecture.test.ts` 的只读名单（静态检查导入），NeuroBook 一侧仍由 `builtin-tools.test.ts`“输出 3”核对写入带会话来源与分组。

## 需要开发者确认

1. **nb-form 不进 nb-harness 的依赖**：Task README 写 nb-harness 新增 nb-form（“只依赖 TypeBox”），实际 nb-form 依赖 nb-ui（Vue 组件库与图标集），nb-story 现在只把它放 devDependencies。推荐：`ask` 的表单校验由宿主注入（`AskForms`），NeuroBook 用 nb-form 实现，nb-harness 只新增 `unbash`。
2. **旧 `src/tools/` 不合并、不改，留给 t31 删**：nb-story 不用旧的 `read`、`edit`；用到它们的只有 nb-agent-ui 的契约测试与 nb-harness 自己的旧测试。推荐如此，kit 的工具是唯一维护的实现。
3. **摘要小节只由宿主给**，不做按 Profile 换（要改内核的 Profile 类型）。推荐宿主给，Profile 继续用 `compaction.require` 追加要求。
4. **kit 带一个本机文件访问实现 `localFiles`**：kit 的测试需要真实依赖，NeuroBot 也直接用它。推荐做；它不含 NeuroBot 的配置与权限策略。
5. **nb-harness 新增的公开子路径**：`./kit/shapes`、`./kit/files`、`./kit/commands`、`./kit/tools`、`./kit/approval`、`./kit/compaction`、`./kit/guards`、`./kit/sessions`、`./models/rules`，目录名 `src/kit/`。按 `packages/AGENTS.md`，exports 变化要先记为跨模块决策；推荐按此确认后写进 Task README 的决定。
6. **模型角色的选择顺序（`core.ts` 的 `port.resolve`）一起搬成 `modelChoice`**：Task README 只列了 `models/shared/`。推荐搬，kit 的摘要方法与审批模型依赖这套选择顺序，NeuroBot 的模型端口要照它实现。
