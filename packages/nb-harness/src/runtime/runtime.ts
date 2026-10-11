/**
 * 运行时：把 session、profile、config、models、tools、compaction 装配成可用的 Agent；每个会话一个 OMP Agent。
 * 行为合同见 docs/specs/harness/runtime.md。
 */

import {createCompactionRegistry} from "../compaction/compaction";
import {createModelCatalog} from "../models/models";
import {createProfileHost} from "../profile/profile";
import type {ProfileHost} from "../profile/profile";
import {createSession, openSession} from "../session/session";
import {registerRuntimeFields} from "./fields";
import {recoverEntries, SessionHandle} from "./session";
import type {AgentSession, ResolvedDeps, Runtime, RuntimeDeps, RuntimeFailure, RuntimeResult} from "./types";

export type {
    AgentSession, ApprovalMode, Compacted, ContinueOptions, InteractionAnswer, Invocation, InvocationError, InvocationResult, InvocationStep, JsonValue, PendingInteraction, PromptOptions, ResolvedDeps, Runtime, RuntimeDeps,
    RuntimeEvent, RuntimeFailure, RuntimeResult, SessionEntry, SessionLog, SessionStatus, SessionSummary, StreamFn, UserInput,
} from "./types";
export {APPROVAL_FIELD, registerRuntimeFields, TOOLS_FIELD} from "./fields";

const SESSION_CODES: Partial<Record<string, RuntimeFailure>> = {
    "session-exists": "session-exists",
    "session-not-found": "session-not-found",
    "corrupt-session": "corrupt-session",
    "invalid-session-id": "invalid-input",
};

function sessionFailure(code: string, detail: string): RuntimeResult<never> {
    return {ok: false, code: SESSION_CODES[code] ?? "log-failed", detail: `${code}：${detail}`};
}

/**
 * 填缺省项：目录按配置存储建（配置 replace 后目录跟着变）；主机、工具、压缩注册表给空的。
 * 用 getter 而不是拷一份：使用方传进来的 deps 对象是活的（测试在建好运行时之后换 model.stream、往 tools 里加来源），拷贝会把这条路断掉。
 */
function resolveDeps(input: RuntimeDeps): ResolvedDeps {
    const host = input.host ?? createProfileHost();
    const models = input.models ?? createModelCatalog({config: input.config});
    const tools = input.tools ?? [];
    const compaction = input.compaction ?? createCompactionRegistry();
    // 运行时的字段要登记在实际用的那个主机上：使用方事后换了 deps.host，换上来的主机第一次被用到时登记
    let registeredHost: ProfileHost | null = null;
    const resolved = {
        get host() {
            const current = input.host ?? host;
            if (current !== registeredHost) {
                registerRuntimeFields(current);
                registeredHost = current;
            }
            return current;
        },
        get models() { return input.models ?? models; },
        get tools() { return input.tools ?? tools; },
        get compaction() { return input.compaction ?? compaction; },
    };
    for (const key of ["config", "profiles", "credentials", "store", "interceptor", "limits", "now", "model", "judge"] as const) {
        Object.defineProperty(resolved, key, {get: () => input[key], enumerable: true});
    }
    return resolved as ResolvedDeps;
}

export function createRuntime(input: RuntimeDeps): Runtime {
    const deps = resolveDeps(input);
    // 第一次读 host 就完成字段登记
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
    };
}
