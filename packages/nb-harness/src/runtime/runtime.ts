/**
 * 运行时：把 session、profile、config、models、tools、compaction 装配成可用的 Agent；每个会话一个 OMP Agent。
 * 行为合同见 docs/specs/harness/runtime.md。
 */

import {createCompactionRegistry} from "../compaction/compaction";
import {createConfigStore} from "../config/config";
import type {ConfigStore} from "../config/config";
import {createModelCatalog, openCredentials} from "../models/models";
import {createProfileCatalog, createProfileHost} from "../profile/profile";
import type {Profile, ProfileCatalog, ProfileHost} from "../profile/profile";
import {createMemoryArtifactStore, createMemorySessionStore, createSession, openSession} from "../session/session";
import {assertToolResultBudget, DEFAULT_TOOL_RESULT_BUDGET} from "../tools/tools";
import {registerRuntimeFields} from "./fields";
import {HarnessError} from "./result";
import {recoverEntries, SessionHandle} from "./session";
import type {AgentSession, OpenRuntimeOptions, ResolvedDeps, Runtime, RuntimeDeps, RuntimeFailure, RuntimeResult} from "./types";

export type {
    AgentSession, ApprovalAnswer, ApprovalMode, ApprovalPrompt, Compacted, ContinueOptions, InteractionAnswer, Invocation, InvocationError, InvocationResult, InvocationStep, JsonValue, OpenRuntimeOptions, PendingInteraction, Preview,
    PreviewOptions, PromptOptions, ResolvedDeps, Runtime, RuntimeDeps, RuntimeEvent, RuntimeFailure, RuntimeResult, SessionEntry, SessionLog, SessionStatus, SessionSummary, StreamFn, UserInput,
} from "./types";
export {APPROVAL_FIELD, registerRuntimeFields, TOOLS_FIELD} from "./fields";
export {HarnessError, unwrap} from "./result";

const SESSION_CODES: Partial<Record<string, RuntimeFailure>> = {
    "session-exists": "session-exists",
    "session-not-found": "session-not-found",
    "corrupt-session": "corrupt-session",
    "invalid-session-id": "invalid-input",
};

function sessionFailure(code: string, detail: string): RuntimeResult<never> {
    return {ok: false, code: SESSION_CODES[code] ?? "log-failed", detail: `${code}：${detail}`};
}

/** 存储与目录按完整的方法集合认：只看一两个属性会把恰好带 `current` 字段的配置对象、类数组对象误当成它们。 */
const isConfigStore = (value: unknown): value is ConfigStore => {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Partial<ConfigStore>;
    return typeof candidate.replace === "function" && typeof candidate.subscribe === "function" && typeof candidate.current === "object" && candidate.current !== null;
};
const isProfileCatalog = (value: unknown): value is ProfileCatalog => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value as Partial<ProfileCatalog>;
    return typeof candidate.get === "function" && typeof candidate.list === "function" && Array.isArray(candidate.issues);
};

/** 一份配置对象 → 配置存储；不合法时把全部问题一次报出。 */
function configStoreOf(config: RuntimeDeps["config"]): ConfigStore {
    if (isConfigStore(config)) return config;
    const created = createConfigStore(config);
    if (!created.ok) throw new HarnessError("invalid-config", created.problems.map((problem) => `${problem.path}：${problem.reason}`).join("\n"));
    return created.value;
}

/** 一组 Profile → 目录；目录里的错误（重复 id）在装配时就报。 */
function catalogOf(profiles: RuntimeDeps["profiles"]): ProfileCatalog {
    if (isProfileCatalog(profiles)) return profiles;
    if (!Array.isArray(profiles)) throw new HarnessError("invalid-profile", "profiles 要么是 Profile 目录（有 get、list、issues），要么是 Profile 数组");
    const catalog = createProfileCatalog([{source: "inline", profiles: profiles as readonly Profile[]}]);
    const errors = catalog.issues.filter((issue) => issue.severity === "error");
    if (errors.length > 0) throw new HarnessError("invalid-profile", errors.map((issue) => `${issue.code} ${issue.path}：${issue.detail}`).join("\n"), errors);
    return catalog;
}

/** 按输入对象的身份缓存归一化结果：deps 是活的，使用方换了 `deps.config` 之后下一次读取才重新归一化。 */
function normalized<I extends object, O>(convert: (input: I) => O): (input: I) => O {
    let last: {input: I; output: O} | null = null;
    return (input) => {
        if (last === null || last.input !== input) last = {input, output: convert(input)};
        return last.output;
    };
}

/**
 * 填缺省项：目录按配置存储建（配置 replace 后目录跟着变）；主机、工具、压缩注册表给空的；会话与溢出存储给内存的。
 * 用 getter 而不是拷一份：使用方传进来的 deps 对象是活的（测试在建好运行时之后换 model.stream、往 tools 里加来源），拷贝会把这条路断掉。
 */
function resolveDeps(input: RuntimeDeps): ResolvedDeps {
    const config = normalized(configStoreOf);
    const profiles = normalized(catalogOf);
    // 缺省目录跟着当前的配置存储：使用方换了 deps.config 对象，下一次读目录就按新存储建
    const catalogFor = normalized((store: ConfigStore) => createModelCatalog({store}));
    const host = input.host ?? createProfileHost();
    const tools = input.tools ?? [];
    const compaction = input.compaction ?? createCompactionRegistry();
    const store = input.store ?? createMemorySessionStore();
    const artifacts = input.artifacts ?? createMemoryArtifactStore();
    // 运行时的字段要登记在实际用的那个主机上：使用方事后换了 deps.host，换上来的主机第一次被用到时登记
    let registeredHost: ProfileHost | null = null;
    const resolved = {
        get config() { return config(input.config); },
        get profiles() { return profiles(input.profiles); },
        get host() {
            const current = input.host ?? host;
            if (current !== registeredHost) {
                registerRuntimeFields(current);
                registeredHost = current;
            }
            return current;
        },
        get models() { return input.models ?? catalogFor(config(input.config)); },
        get tools() { return input.tools ?? tools; },
        get compaction() { return input.compaction ?? compaction; },
        get store() { return input.store ?? store; },
        get artifacts() { return input.artifacts ?? artifacts; },
    };
    for (const key of ["credentials", "interceptor", "approve", "limits", "now", "model", "judge"] as const) {
        Object.defineProperty(resolved, key, {get: () => input[key], enumerable: true});
    }
    return resolved as ResolvedDeps;
}

export function createRuntime(input: RuntimeDeps): Runtime {
    return buildRuntime(input, {close: () => undefined});
}

/** `owned` 是运行时自己建、由 `close()` 关的东西（`openRuntime` 开的凭据库）；不进公开签名。 */
function buildRuntime(input: RuntimeDeps, owned: {close(): void}): Runtime {
    // 预算错了在装配时就报，不等第一个工具结果
    if (input.limits?.toolResult !== undefined) {
        try {
            assertToolResultBudget({...DEFAULT_TOOL_RESULT_BUDGET, ...input.limits.toolResult});
        } catch (error) {
            throw new HarnessError("invalid-limits", error instanceof Error ? error.message : String(error));
        }
    }
    const deps = resolveDeps(input);
    // 第一次读就完成归一化与字段登记：配置、Profile 的错误在这里抛，不等第一次调用
    void deps.config;
    void deps.profiles;
    void deps.host;
    const options = deps.now === undefined ? {} : {now: deps.now};
    return {
        async createSession(input): Promise<RuntimeResult<AgentSession>> {
            if (deps.profiles.get(input.profileId) === undefined) return {ok: false, code: "unknown-profile", detail: `Profile 目录里没有 ${input.profileId}`};
            const created = await createSession(deps.store, {...options, ...(input.id === undefined ? {} : {id: input.id})});
            if (!created.ok) return sessionFailure(created.code, created.detail);
            if (input.title !== undefined) {
                const titled = await created.value.append([{type: "title_change", title: input.title, source: "user"}]);
                if (!titled.ok) return sessionFailure(titled.code, titled.detail);
            }
            return {ok: true, value: new SessionHandle(deps, created.value, input.profileId)};
        },
        async openSession(id): Promise<RuntimeResult<AgentSession>> {
            const opened = await openSession(deps.store, id, options);
            if (!opened.ok) return sessionFailure(opened.code, opened.detail);
            const recovered = await recoverEntries(opened.value);
            if (!recovered.ok) return recovered;
            return {ok: true, value: new SessionHandle(deps, opened.value, undefined)};
        },
        async listSessions() {
            const listed = await deps.store.list();
            return listed.ok ? {ok: true, value: listed.value} : sessionFailure(listed.code, listed.detail);
        },
        close: () => owned.close(),
    };
}

/**
 * 便捷入口（输出 18）：凭据可以只给 key——内部开凭据库（缺省 `:memory:`，不落盘），`close()` 关它；别的与 `createRuntime` 相同。
 * 失败抛 `HarnessError`（凭据库的失败码照 harness.models）。
 */
export async function openRuntime(options: OpenRuntimeOptions): Promise<Runtime> {
    const {credentials: given, apiKeys, credentialsPath, ...deps} = options;
    if (given !== undefined) return createRuntime({...deps, credentials: given});
    const opened = await openCredentials({sqlitePath: credentialsPath ?? ":memory:", ...(apiKeys === undefined ? {} : {apiKeys})});
    if (!opened.ok) throw new HarnessError(opened.code, opened.detail);
    try {
        return buildRuntime({...deps, credentials: opened.value}, {close: () => opened.value.close()});
    } catch (error) {
        // 装配失败时库已经开了：自己关掉，调用方拿不到句柄
        opened.value.close();
        throw error;
    }
}
