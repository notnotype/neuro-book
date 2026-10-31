/**
 * 单次请求 `complete()`（docs/specs/harness/runtime.md 输出 56）：不经会话、不读写日志。只接受不声明工具的 Profile；
 * 请求是 Profile 的系统提示词加输入这一条用户消息（Profile 模板里别的内容是会话用的，不混进来），`purpose: "background"`。
 */

import {replyText} from "../api/index.js";
import type {AnyProfile, Complete, ModelRequest, RunResult} from "../api/index.js";
import {assemble} from "../extension/assemble.js";
import {viewCtx, type StateAt} from "../extension/ctx.js";
import {initialHistory} from "../state/history.js";
import {DEFAULT_CORE_SETTINGS} from "../state/kernel-state.js";
import {initialSnapshot} from "../state/snapshot.js";
import {Fragment, System, Turn} from "../view/prompt/nodes.js";
import {renderTemplate} from "../view/render.js";

const NEVER = new AbortController().signal;

export const complete: Complete = async (env, options) => {
    const profile = (await env.profiles.resolve(options.profile)) as (AnyProfile & {tools?: {required?: readonly string[]; optional?: readonly string[]}; system?: unknown}) | undefined;
    if (profile === undefined) return {ok: false, code: "unknown-profile"};
    if ((profile.tools?.required?.length ?? 0) + (profile.tools?.optional?.length ?? 0) > 0) return {ok: false, code: "profile-has-tools"};
    const assembled = assemble(profile, []);
    if (!assembled.ok) return {ok: false, code: "unknown-profile"};
    const resolution = env.models.resolve(DEFAULT_CORE_SETTINGS, "background");
    if (!resolution.ok) return {ok: false, code: resolution.code === "no-credentials" ? "no-credentials" : "no-model"};
    const {assembly} = assembled;
    const state: StateAt = {path: initialSnapshot(assembly.reducers, "path", false), session: initialSnapshot(assembly.reducers, "session", false), history: initialHistory, settings: {}};
    const view = viewCtx(assembly, assembly.order[assembly.order.length - 1]!, state, {tools: [], model: resolution.info, now: env.clock.now(), initial: options.initial ?? null});
    const usage0 = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, complete: true};
    const failed = (message: string): {ok: true; result: Omit<RunResult, "runId" | "entries">} => ({ok: true, result: {reason: "error", stopReason: "error", text: "", result: null, error: {kind: "local", code: "profile-failed", message}, usage: usage0}});
    let rendered;
    try {
        const system = typeof profile.system === "function" ? (profile.system as (view: unknown) => unknown)(view) : (profile.system ?? null);
        rendered = renderTemplate(Fragment({children: [System({}), Turn({})]}), {
            system: system as never,
            tools: [],
            slots: [],
            history: () => [],
            turn: () => [{role: "user", content: [{kind: "text", text: options.input.text, origin: {kind: "fixed", by: "kernel"}}]}],
        });
    } catch (error) {
        return failed(error instanceof Error ? error.message : String(error));
    }
    const request: ModelRequest = {purpose: "background", model: resolution.info.id, params: {}, headers: {}, system: rendered.system, messages: rendered.messages, tools: []};
    const response = await resolution.call(request, options.signal ?? NEVER, () => undefined);
    if (response.stopReason === "aborted") return {ok: true, result: {reason: "aborted", stopReason: "aborted", text: replyText(response.content), result: null, error: null, usage: response.usage}};
    if (response.stopReason === "error") {
        const error = response.error;
        return {ok: true, result: {reason: "error", stopReason: "error", text: "", result: null, error: {kind: error?.kind ?? "provider", ...(error?.code === undefined ? {} : {code: error.code}), ...(error?.message === undefined ? {} : {message: error.message})}, usage: response.usage}};
    }
    return {ok: true, result: {reason: "completed", stopReason: response.stopReason === "length" ? "length" : "stop", text: replyText(response.content), result: null, error: null, usage: response.usage}};
};
