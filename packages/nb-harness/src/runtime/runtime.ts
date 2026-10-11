/**
 * 运行时：把 session、profile、config、models、tools、compaction 装配成可用的 Agent；每个会话一个 OMP Agent。
 * 行为合同见 docs/specs/harness/runtime.md。
 */

import {createSession, openSession} from "../session/session";
import {registerRuntimeFields} from "./fields";
import {recoverEntries, SessionHandle} from "./session";
import type {AgentSession, Runtime, RuntimeDeps, RuntimeFailure, RuntimeResult} from "./types";

export type {
    AgentSession, ApprovalMode, Compacted, ContinueOptions, InteractionAnswer, Invocation, InvocationError, InvocationResult, JsonValue, PromptOptions, Runtime, RuntimeDeps,
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

export function createRuntime(deps: RuntimeDeps): Runtime {
    registerRuntimeFields(deps.host);
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
