/**
 * 装配：把七个模块接成一个能用的 `Runtime`。内核自己不做 I/O、不读环境变量、没有单例，
 * 配置从哪来、凭据存哪、工具能碰哪些文件、会话写到哪，都在这里由使用方决定——产品里的 `nbook.agent` 插件做的是同一件事。
 *
 * 一步一步：
 * 1. 配置快照：`createConfigStore` 校验并冻结一份配置；校验失败会一次列出全部问题（不是第一条），这里直接抛出。
 *    运行时按它建模型目录，之后 `replace` 配置，目录跟着变。
 * 2. 凭据：OMP 的 SQLite 凭据库，路径由我们给（`:memory:` 是内存库）；key 经 `apiKeys` 写进去，内核不会去读环境变量。
 * 3. 资源寻址：内置的 `read`、`edit` 按 `方案://路径` 读写，方案由这里登记（docs/specs/workspace/resources.md 的首批方案）：
 *    `project://` 作品目录（`createLocalFileAccess({root})` 把一个目录当根，根外的路径一律 `outside-root`）、`local://` 本会话的工作目录
 *    （按会话 id 各建一个）、`tmp://` 临时目录、`docs://` 只读的参考文档。产品里 `project://` 由项目实例提供、`tmp://` 映射系统临时目录。
 * 4. Profile 主机：注册方的节点与数据源在这里登记（示例注册了 `<WorkspaceTree />`）；运行时创建时会把自己的字段登记进来。
 *    不注册任何东西的使用方可以不传 `host`。
 * 5. 会话存储：JSONL，每个会话一个文件；目录要先存在。溢出存储放在它旁边（`<会话 id>.artifacts/`）：工具结果超过预算时全文在这里，
 *    模型经 `artifact://` 方案回读（场景 6）。不传 `artifacts` 就是内存实现。
 * 6. 压缩注册表：自带 `soft`；场景 4 用 `soft.completeImpl` 把它的摘要传输换成脚本。不传就是缺省的注册表。
 * 7. `createRuntime(deps)`：`models`、`tools`、`compaction`、`host` 都可以省略；`model.stream` 不传就是 OMP 的真实网络传输。
 *
 * 行为合同：docs/specs/harness/runtime.md 的“输入与前置条件”（`RuntimeDeps`）；各依赖的合同见对应模块的 Spec。
 */

import {mkdir} from "node:fs/promises";
import {join} from "node:path";
import {createRuntime} from "@notnotype/nb-harness";
import type {Runtime, RuntimeDeps, StreamFn} from "@notnotype/nb-harness";
import {fileURLToPath} from "node:url";
import {createArtifactProvider, createBuiltinTools, createResourceAccess} from "@notnotype/nb-harness/builtin";
import {createLocalFileAccess, createSessionDirectories} from "@notnotype/nb-harness/builtin/local";
import {createCompactionRegistry} from "@notnotype/nb-harness/compaction";
import type {CompactionMethod, CompleteImpl} from "@notnotype/nb-harness/compaction";
import {createConfigStore} from "@notnotype/nb-harness/config";
import {openCredentials} from "@notnotype/nb-harness/models";
import {createProfileCatalog, createProfileHost} from "@notnotype/nb-harness/profile";
import type {Profile} from "@notnotype/nb-harness/profile";
import {createJsonlArtifactStore, createJsonlSessionStore} from "@notnotype/nb-harness/session/jsonl";
import type {ToolSource} from "@notnotype/nb-harness/tools";
import {registerWorkspaceTree} from "./nodes/workspace-tree";

export type AssembleOptions = {
    /** 工具的根：模型只能读写这个目录里的文件。必须已存在。 */
    workspace: string;
    /** 会话与凭据库的目录；不存在会创建。`local://` 的会话目录与 `tmp://` 也放在它下面。 */
    state: string;
    /** `docs://` 指向的只读目录；缺省是示例自带的 `examples/docs/`。 */
    docs?: string;
    /** `HarnessConfig` 形状的配置（见 docs/specs/harness/config.md）。 */
    config: unknown;
    profiles: readonly Profile[];
    /** 服务 id → API key，写进凭据库。 */
    apiKeys?: Readonly<Record<string, string>>;
    /** 模型流的传输；不传用 OMP 的 `streamSimple`（真实网络）。 */
    model?: {stream?: StreamFn};
    /** 审批模型的传输与超时。 */
    judge?: {stream?: StreamFn; timeoutMs?: number};
    /** 压缩：替换内置 `soft` 的摘要传输，或再注册别的方法。 */
    compaction?: {soft?: {completeImpl?: CompleteImpl}; methods?: readonly CompactionMethod[]};
    /** 一次调用最多多少轮模型回复；缺省 50。 */
    maxTurns?: number;
    /** 内置工具之外的工具来源（场景 6 的 dump）。 */
    tools?: readonly ToolSource[];
};

export type Assembled = {
    runtime: Runtime;
    deps: RuntimeDeps;
    /** 关闭凭据库。会话句柄各自 `close()`。 */
    close(): void;
};

export async function assemble(options: AssembleOptions): Promise<Assembled> {
    const config = createConfigStore(options.config);
    if (!config.ok) throw new Error(`配置无效：\n${config.problems.map((problem) => `  ${problem.path}: ${problem.reason}`).join("\n")}`);

    await mkdir(join(options.state, "sessions"), {recursive: true});
    await mkdir(join(options.state, "tmp"), {recursive: true});
    const credentials = await openCredentials({sqlitePath: join(options.state, "auth.sqlite"), ...(options.apiKeys === undefined ? {} : {apiKeys: options.apiKeys})});
    if (!credentials.ok) throw new Error(`凭据库打不开：${credentials.detail}`);

    // 凭据库已经打开：后面任一步失败都要先关掉它再抛，否则调用方拿不到 Assembled、也就没法关
    try {
        const sessions = join(options.state, "sessions");
        const artifacts = createJsonlArtifactStore({root: sessions});
        const project = createLocalFileAccess({root: options.workspace});
        const resources = createResourceAccess({
            project: {provider: project, doc: "作品目录"},
            local: {provider: createSessionDirectories({root: join(options.state, "local")}), doc: "本会话的工作目录，放草稿与中间产物"},
            tmp: {provider: createLocalFileAccess({root: join(options.state, "tmp")}), doc: "临时目录"},
            docs: {provider: createLocalFileAccess({root: options.docs ?? fileURLToPath(new URL("./docs/", import.meta.url)), readonly: true}), doc: "写作参考文档，只读"},
            artifact: {provider: createArtifactProvider(artifacts), doc: "超过预算的工具结果全文，只读；按结果里给的 artifact://N 回读，可带 offset、limit"},
        });
        const host = createProfileHost();
        registerWorkspaceTree(host, project);

        const compaction = createCompactionRegistry(options.compaction?.soft === undefined ? {} : {soft: options.compaction.soft});
        for (const method of options.compaction?.methods ?? []) {
            const registered = compaction.register(method);
            if (!registered.ok) throw new Error(`注册压缩方法 ${method.id} 失败：${registered.detail}`);
        }

        const deps: RuntimeDeps = {
            config: config.value,
            profiles: createProfileCatalog([{source: "examples", profiles: options.profiles}]),
            host,
            credentials: credentials.value,
            tools: [createBuiltinTools({resources}), ...(options.tools ?? [])],
            compaction,
            store: createJsonlSessionStore({root: sessions}),
            artifacts,
            ...(options.maxTurns === undefined ? {} : {limits: {maxTurns: options.maxTurns}}),
            ...(options.model === undefined ? {} : {model: options.model}),
            ...(options.judge === undefined ? {} : {judge: options.judge}),
        };
        return {runtime: createRuntime(deps), deps, close: () => credentials.value.close()};
    } catch (error) {
        credentials.value.close();
        throw error;
    }
}
