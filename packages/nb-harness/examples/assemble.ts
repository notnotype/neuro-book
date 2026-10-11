/**
 * 装配：把七个模块接成一个能用的 `Runtime`。内核自己不做 I/O、不读环境变量、没有单例，
 * 配置从哪来、凭据存哪、工具能碰哪些文件、会话写到哪，都在这里由使用方决定——产品里的 `nbook.agent` 插件做的是同一件事。
 *
 * 一步一步：
 * 1. 配置快照：`createConfigStore` 校验并冻结一份配置；校验失败会一次列出全部问题（不是第一条），这里直接抛出。
 * 2. 凭据：OMP 的 SQLite 凭据库，路径由我们给；key 用 `setApiKey` 写进去，内核不会去读环境变量。
 * 3. 文件访问：`createLocalFileAccess({root})` 把工作区当根，根外的路径（`../x`、绝对路径、指向根外的符号链接）一律 `outside-root`。
 *    内置的 `read`、`edit` 只经它读写。
 * 4. Profile 主机：注册方的节点与数据源在这里登记（示例注册了 `<WorkspaceTree />`）；运行时创建时会把自己的字段登记进来。
 * 5. 会话存储：JSONL，每个会话一个文件；目录要先存在。
 * 6. 压缩注册表：自带 `soft`；场景 4 再注册一个摘要传输脚本化的方法。
 * 7. `createRuntime(deps)`：`model.stream` 不传就是 OMP 的真实网络传输；场景传脚本化的流，命令行不传。
 *
 * 行为合同：docs/specs/harness/runtime.md 的“输入与前置条件”（`RuntimeDeps`）；各依赖的合同见对应模块的 Spec。
 */

import {mkdir} from "node:fs/promises";
import {join} from "node:path";
import {createRuntime} from "@notnotype/nb-harness";
import type {Runtime, RuntimeDeps, StreamFn} from "@notnotype/nb-harness";
import {createBuiltinTools} from "@notnotype/nb-harness/builtin";
import {createLocalFileAccess} from "@notnotype/nb-harness/builtin/local";
import {createCompactionRegistry} from "@notnotype/nb-harness/compaction";
import type {CompactionMethod} from "@notnotype/nb-harness/compaction";
import {createConfigStore} from "@notnotype/nb-harness/config";
import {createModelCatalog, openCredentials} from "@notnotype/nb-harness/models";
import {createProfileCatalog, createProfileHost} from "@notnotype/nb-harness/profile";
import type {Profile} from "@notnotype/nb-harness/profile";
import {createJsonlSessionStore} from "@notnotype/nb-harness/session/jsonl";
import {registerWorkspaceTree} from "./nodes/workspace-tree";

export type AssembleOptions = {
    /** 工具的根：模型只能读写这个目录里的文件。必须已存在。 */
    workspace: string;
    /** 会话与凭据库的目录；不存在会创建。 */
    state: string;
    /** `HarnessConfig` 形状的配置（见 docs/specs/harness/config.md）。 */
    config: unknown;
    profiles: readonly Profile[];
    /** 服务 id → API key，写进凭据库。 */
    apiKeys?: Readonly<Record<string, string>>;
    /** 模型流的传输；不传用 OMP 的 `streamSimple`（真实网络）。 */
    model?: {stream?: StreamFn};
    /** 审批模型的传输与超时。 */
    judge?: {stream?: StreamFn; timeoutMs?: number};
    /** 额外注册的压缩方法（`soft` 已内置）。 */
    compaction?: readonly CompactionMethod[];
    /** 一次调用最多多少轮模型回复；缺省 50。 */
    maxTurns?: number;
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
    const credentials = await openCredentials({sqlitePath: join(options.state, "auth.sqlite")});
    if (!credentials.ok) throw new Error(`凭据库打不开：${credentials.detail}`);
    for (const [provider, key] of Object.entries(options.apiKeys ?? {})) await credentials.value.setApiKey(provider, key);

    const access = createLocalFileAccess({root: options.workspace});
    const host = createProfileHost();
    registerWorkspaceTree(host, access);

    const compaction = createCompactionRegistry();
    for (const method of options.compaction ?? []) {
        const registered = compaction.register(method);
        if (!registered.ok) throw new Error(`注册压缩方法 ${method.id} 失败：${registered.detail}`);
    }

    const deps: RuntimeDeps = {
        config: config.value,
        profiles: createProfileCatalog([{source: "examples", profiles: options.profiles}]),
        host,
        // 目录只看传入的快照；配置被 replace 时要用新快照另建目录
        models: createModelCatalog({config: config.value.current}),
        credentials: credentials.value,
        tools: [createBuiltinTools({access})],
        compaction,
        store: createJsonlSessionStore({root: join(options.state, "sessions")}),
        ...(options.maxTurns === undefined ? {} : {limits: {maxTurns: options.maxTurns}}),
        ...(options.model === undefined ? {} : {model: options.model}),
        ...(options.judge === undefined ? {} : {judge: options.judge}),
    };
    return {runtime: createRuntime(deps), deps, close: () => credentials.value.close()};
}
