/**
 * 重复的工具调用（docs/specs/agent/run-guards.md 输出 7–12）：先提醒，提醒之后结果还一样才停。计数放在 path 片里，回退时跟着回去。
 * 只比较调用不比较结果就停，会误伤反复跑同一条命令等后台任务的做法：参数相同，结果在变。
 */

import {createHash} from "node:crypto";

import {conv, defineExtension, ext, slice} from "@notnotype/nb-harness/kernel";
import type {AgentExtensionImplementation} from "../../shared/points";

import {refusal} from "./refusal";

const ARGS_SUMMARY_LIMIT = 400;

interface LoopState {
    /** 上一条回复的工具调用；上一条没有工具调用时为 null。 */
    readonly hash: string | null;
    readonly count: number;
    /** 这段重复里每一步的结果都相同。 */
    readonly sameResults: boolean;
    readonly previousResults: string | null;
    readonly currentResults: string;
    /** 这段重复提醒过了。换了调用整个状态清零，所以别的调用重复时会先提醒。 */
    readonly redirected: boolean;
    readonly stopped: boolean;
}

const INITIAL: LoopState = {hash: null, count: 0, sameResults: true, previousResults: null, currentResults: "", redirected: false, stopped: false};

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value === null || typeof value !== "object") return value;
    const input = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonical(input[key])]));
}

/** 调用的顺序、参数键的顺序都不算不同。 */
const callsHash = (calls: readonly {readonly tool: string; readonly args: unknown}[]): string => sha256(JSON.stringify(calls.map((call) => JSON.stringify([call.tool, canonical(call.args)])).sort()));

/** `threshold` 每次判断时现读。 */
export function loopGuard(threshold: () => number): AgentExtensionImplementation {
    return defineExtension({
        id: "nbook.agent.loop-guard",
        state: {loop: slice.path<LoopState>(INITIAL)},
        events: {
            redirected: conv<{tool: string; count: number; args: string}>(),
            stopped: ext<{tool: string; count: number}>(),
        },
        reduce: {
            assistant: (event, {loop}) => {
                const calls = event.data.toolCalls;
                if (calls.length === 0) return {loop: {...INITIAL, stopped: loop.stopped}};
                const hash = callsHash(calls);
                if (hash !== loop.hash) return {loop: {...INITIAL, hash, count: 1, stopped: loop.stopped}};
                const sameResults = loop.sameResults && (loop.previousResults === null || loop.previousResults === loop.currentResults);
                return {loop: {...loop, count: loop.count + 1, sameResults, previousResults: loop.currentResults, currentResults: ""}};
            },
            toolResult: (event, {loop}) => ({loop: {...loop, currentResults: sha256(JSON.stringify([loop.currentResults, event.data.status, event.data.text]))}}),
            redirected: (_event, {loop}) => ({loop: {...loop, count: 0, sameResults: true, redirected: true}}),
            stopped: (_event, {loop}) => ({loop: {...loop, stopped: true}}),
            // 只有用户的新话解除。`start` 接着跑时 `inputId` 是 null：它没有带来新的东西，解除了就会一直循环下去。
            turnStarted: (event, {loop}) => (event.data.inputId === null ? undefined : {loop: INITIAL}),
            steer: () => ({loop: INITIAL}),
        },
        render: {
            redirected: (event) => `<system-reminder>\nYou called \`${event.data.tool}\` ${String(event.data.count)} times in a row with the same arguments: \`${event.data.args}\`.\nDo not repeat this call. Use different arguments, choose another tool, or finish with what you have.\n</system-reminder>`,
        },
        on: {
            assistant: (event, ctx) => {
                const limit = threshold();
                const {loop} = ctx.state;
                if (limit <= 0 || event.data.toolCalls.length === 0 || loop.count < limit) return;
                const call = event.data.toolCalls[0]!;
                if (loop.redirected && loop.sameResults) ctx.emit("stopped", {tool: call.tool, count: loop.count});
                else ctx.emit("redirected", {tool: call.tool, count: loop.count, args: JSON.stringify(call.args).slice(0, ARGS_SUMMARY_LIMIT)});
            },
        },
        intercept: {
            model: async (request, next, ctx) => {
                if (ctx.phase === "preview" || !ctx.state.loop.stopped) return next(request);
                return refusal(request, "tool-call-loop", "the same tool calls kept repeating with the same results after a reminder; the model request was not sent");
            },
        },
    });
}
