/**
 * 进程内的插件宿主（docs/specs/harness/runtime.md 输出 57）：`agent.extensions` 贡献点的接收者，加上经它打开的会话。
 *
 * 贡献的生命周期照平台的事务：`prepare` 预占（不合规则、重名、依赖成环在这里否决，整个插件的激活随之失败）→
 * `published` 生效（之后新开的会话装上它，已打开的会话重新装配）→ `revoke` 撤回（幂等；运行中的会话这次运行里跳过它，
 * 空闲时重新装配）。`implementation()` 每次装配时现取，宿主不缓存它（撤回之后它会抛错）。
 */

import type {AgentHost, ContributedExtension, CreateSessionOptions, Diagnostic, ExtensionHandle, ExtensionInfo, SessionApi, SessionEnv} from "../api/index.js";
import {diagnosticCodes} from "../api/index.js";
import {contributedIdProblem} from "../extension/assemble.js";
import {closeSession, createSession, currentProfileOf, notifyAssemblyChanged, openSession} from "./session.js";

export class ExtensionRejected extends Error {
    constructor(readonly code: "bad-extension-id" | "duplicate-extension-id" | "dependency-cycle", message: string) {
        super(message);
        this.name = "ExtensionRejected";
    }
}

export function createAgentHost(base: Omit<SessionEnv, "extensions">): AgentHost {
    const prepared = new Map<string, ExtensionHandle>();
    const published = new Map<string, ExtensionHandle>();
    const sessions = new Map<string, SessionApi>();
    const diagnostics: Diagnostic[] = [];
    const contributed = (): ContributedExtension[] => [...published.values()].map((handle) => ({extension: handle.implementation(), plugin: handle.plugin}));
    const env: SessionEnv = {...base, extensions: contributed};

    const reject = (code: ExtensionRejected["code"], extension: string, message: string): never => {
        diagnostics.push({id: `${code}|${extension}`, level: diagnosticCodes[code], code, extension, entry: "assembly", params: {}, message, count: 1, firstSeq: 0, lastSeq: 0, persisted: false});
        throw new ExtensionRejected(code, message);
    };

    /** 加上这一个之后，声明里的依赖有没有成环（只看声明，不激活插件）。 */
    const cycleWith = (handle: ExtensionHandle): boolean => {
        const graph = new Map<string, readonly string[]>([...published.values(), ...prepared.values(), handle].map((item) => [item.id, item.declaration.dependsOn ?? []]));
        const visiting = new Set<string>();
        const done = new Set<string>();
        const visit = (id: string): boolean => {
            if (done.has(id)) return false;
            if (visiting.has(id)) return true;
            visiting.add(id);
            const found = (graph.get(id) ?? []).some(visit);
            visiting.delete(id);
            done.add(id);
            return found;
        };
        return visit(handle.id);
    };

    /**
     * 正在建或正在打开的会话还不在表里，这期间的变化记在这里，建好或打开之后补一次（否则这个会话装的是变化之前的扩展或 Profile，
     * 之后也不会再收到这次通知）。
     */
    const inFlight = new Set<{readonly added: Set<string>; readonly removed: Set<string>; readonly profiles: Set<string>}>();
    const notifyAll = async (change: {added?: string[]; removed?: string[]}): Promise<void> => {
        for (const pending of inFlight) {
            for (const id of change.added ?? []) pending.added.add(id);
            for (const id of change.removed ?? []) pending.removed.add(id);
        }
        await Promise.all([...sessions.values()].map((session) => notifyAssemblyChanged(session, env, change)));
    };
    /** 建或打开一个会话，期间的变化在它进表之后补上。 */
    const register = async <R extends {ok: boolean}>(start: () => Promise<R>, sessionOf: (result: R) => SessionApi | null): Promise<R> => {
        const pending = {added: new Set<string>(), removed: new Set<string>(), profiles: new Set<string>()};
        inFlight.add(pending);
        let result: R;
        try {
            result = await start();
        } finally {
            inFlight.delete(pending);
        }
        const session = sessionOf(result);
        if (session !== null) {
            sessions.set(session.id, session);
            const profile = pending.profiles.has(currentProfileOf(session) ?? "");
            if (pending.added.size > 0 || pending.removed.size > 0 || profile) {
                void notifyAssemblyChanged(session, env, {added: [...pending.added], removed: [...pending.removed], profile});
            }
        }
        return result;
    };

    return {
        extensions: {
            prepare(handle) {
                const problem = contributedIdProblem(handle.id, handle.plugin);
                if (problem !== null) reject("bad-extension-id", handle.id, problem);
                if (published.has(handle.id) || prepared.has(handle.id)) reject("duplicate-extension-id", handle.id, `extension id ${handle.id} is already contributed`);
                if (cycleWith(handle)) reject("dependency-cycle", handle.id, `the dependencies of ${handle.id} form a cycle`);
                prepared.set(handle.id, handle);
            },
            published(handle) {
                prepared.delete(handle.id);
                published.set(handle.id, handle);
                // 发布不等装配：平台的发布是同步的一步，各会话的装配在后台做，指令等它（runtime.md 输出 57）。
                void notifyAll({added: [handle.id]});
            },
            // 只撤回这个句柄自己的贡献：旧代次的句柄重复撤回时，同 id 的新代次不受影响（撤回幂等）。
            // 交回的 Promise 等各会话摘下它（清理函数跑完）：平台在这之后才释放插件自己的资源。
            async revoke(handle) {
                if (prepared.get(handle.id) === handle) prepared.delete(handle.id);
                if (published.get(handle.id) !== handle) return;
                published.delete(handle.id);
                await notifyAll({removed: [handle.id]});
            },
        },
        // 只通知用这些 Profile 的会话；会话按当前的 key 自己重新解析（runtime.md 输出 57）。
        async profilesChanged(keys) {
            const changed = new Set(keys);
            for (const pending of inFlight) for (const key of keys) pending.profiles.add(key);
            const affected = [...sessions.values()].filter((session) => changed.has(currentProfileOf(session) ?? ""));
            await Promise.all(affected.map((session) => notifyAssemblyChanged(session, env, {profile: true})));
        },
        list(): ExtensionInfo[] {
            return [...published.values()].map((handle) => ({id: handle.id, plugin: handle.plugin, version: (handle.implementation() as {version?: string}).version ?? "0", status: "active", tags: handle.declaration.tags ?? []}));
        },
        create(options: CreateSessionOptions) {
            return register(() => createSession(env, options), (created) => (created.ok ? created.value : null));
        },
        async open(sessionId: string) {
            const existing = sessions.get(sessionId);
            if (existing !== undefined) return {ok: true, value: existing};
            return register(() => openSession(env, sessionId), (opened) => (opened.ok ? opened.value : null));
        },
        async close(sessionId, options) {
            const session = sessions.get(sessionId);
            if (session === undefined) return;
            sessions.delete(sessionId);
            await closeSession(session, options);
        },
        diagnostics: () => [...diagnostics],
    };
}
