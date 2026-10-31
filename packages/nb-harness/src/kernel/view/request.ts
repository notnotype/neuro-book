/**
 * 视图：由某一刻的状态算出一次模型请求（docs/specs/harness/profile.md）。只在要发请求与预览时算。
 *
 * 失败分两类，都由调用方转成诊断与收口：
 * - 算不出请求：Profile 的 `prompt`、`system`、`turn` 抛错，或模板结构不合规（`profile-failed`）；请求里工具调用与
 *   结果不成对（`request-invalid`）。
 * - 照常发请求、只记问题：扩展的 `contribute` 与 `render` 出错、`commit` 出错或交回不成对的消息（改用缺省的提交）、
 *   槽没摆或摆错、开发检查不过。
 *
 * 已提交的轮经 `ViewCache` 只渲染一次（输出 10）；开发检查只在 `checks` 为真时做（预览不做，免得改掉“上一次渲染”）。
 */

import type {ConversationTurn, DiagnosticCode, EntryPoint, Message, ModelRequest, PromptChild, RenderTable, RequestPurpose, ToolDeclaration} from "../api/index.js";
import {committedTurns} from "../state/history.js";
import type {Assembly} from "../extension/assemble.js";
import {viewCtx, type StateAt, type ViewEnvironment} from "../extension/ctx.js";
import {blockKeys, isPrefix, type ViewCache} from "./cache.js";
import {createFormat, type RenderSources} from "./format.js";
import {renderTemplate, TemplateError, type SlotContent} from "./render.js";
import {standardLayout} from "./standard-layout.js";
import {pairingProblem} from "./validate.js";

export interface ViewProblem {
    readonly code: DiagnosticCode;
    readonly extension: string;
    readonly entry: EntryPoint;
    readonly message: string;
    readonly hint?: string;
    readonly params?: Readonly<Record<string, string | number | boolean>>;
    readonly event?: {readonly id: string; readonly type: string; readonly seq: number};
    readonly error?: unknown;
    /** 诊断合并键里的定位对象：槽名或轮 id。 */
    readonly subject?: string;
}

export type ComputedRequest =
    | {readonly ok: true; readonly request: ModelRequest; readonly problems: readonly ViewProblem[]}
    | {readonly ok: false; readonly reason: "profile-failed"; readonly entry: "prompt" | "system" | "turn"; readonly code: "threw" | "invalid-output"; readonly error: unknown; readonly problems: readonly ViewProblem[]}
    | {readonly ok: false; readonly reason: "request-invalid"; readonly problems: readonly ViewProblem[]};

export interface RequestInputs {
    readonly assembly: Assembly;
    readonly state: StateAt;
    readonly environment: ViewEnvironment;
    readonly purpose: RequestPurpose;
    readonly model: string;
    readonly effort?: string;
    readonly tools: readonly ToolDeclaration[];
    readonly cache: ViewCache;
    /** 开发检查（前缀稳定、提交一致）；发请求时随开发模式，预览时关。 */
    readonly checks: boolean;
}

type ProfileShape = {
    system?: PromptChild | ((view: unknown) => PromptChild);
    prompt?: (view: unknown) => PromptChild;
    turn?: (turn: ConversationTurn, format: unknown) => (Message | null)[];
    commit?: (turn: ConversationTurn, format: unknown) => (Message | null)[];
    render?: RenderTable;
};

class ProfileEntryError extends Error {
    constructor(readonly entry: "prompt" | "system" | "turn", readonly original: unknown) {
        super(`profile ${entry} threw`);
    }
}

function guard<T>(entry: "prompt" | "system" | "turn", fn: () => T): T {
    try {
        return fn();
    } catch (error) {
        throw new ProfileEntryError(entry, error);
    }
}

function messageList(entry: "commit" | "turn", value: unknown): Message[] {
    if (!Array.isArray(value)) throw new TypeError(`${entry} must return an array of messages`);
    return value.filter((message): message is Message => message !== null && message !== undefined);
}

export function renderSources(assembly: Assembly, onProblem: RenderSources["onProblem"]): RenderSources {
    const profile = assembly.profile as unknown as ProfileShape;
    const extensions = new Map<string, RenderTable>();
    for (const item of assembly.order) if (item.role !== "profile" && item.definition.render !== undefined) extensions.set(item.definition.id, item.definition.render as RenderTable);
    return {profile: profile.render ?? {}, extensions, profileId: assembly.profile.id, onProblem};
}

export function computeRequest(inputs: RequestInputs): ComputedRequest {
    const {assembly, state, environment, cache, checks} = inputs;
    const problems: ViewProblem[] = [];
    const profileItem = assembly.order[assembly.order.length - 1]!;
    const profileId = profileItem.definition.id;
    const profile = assembly.profile as unknown as ProfileShape;
    const profileView = viewCtx(assembly, profileItem, state, environment);
    const format = createFormat(renderSources(assembly, ({extension, event, error}) => problems.push({
        code: "render-threw",
        extension,
        entry: "render",
        event: {id: event.id, type: event.type, seq: event.seq},
        message: `render of ${event.type} in ${extension} threw; the default text is used`,
        error,
    })));
    const commits = cache.commits(assembly);
    const previousTurn = cache.lastTurn;

    const slots: SlotContent[] = [];
    for (const item of assembly.order) {
        for (const [name, contribution] of Object.entries(item.definition.contribute ?? {}) as [string, {volatile?: boolean; value: (view: unknown) => string | null | undefined}][]) {
            try {
                const text = contribution.value(viewCtx(assembly, item, state, environment));
                if (typeof text === "string" && text !== "") slots.push({name, extension: item.definition.id, volatile: contribution.volatile === true, text});
            } catch (error) {
                problems.push({code: "contribute-threw", extension: item.definition.id, entry: "contribute", subject: name, params: {slot: name}, message: `contribute ${name} of ${item.definition.id} threw; the slot is left out of this request`, error});
            }
        }
    }

    /** 一轮进历史的样子：缓存命中直接用；否则按 `commit`（不写时用 `turn`）渲染一次并记住。 */
    const committed = (turn: ConversationTurn): readonly Message[] => {
        const hit = commits.get(turn);
        if (hit !== undefined) return hit;
        let messages: Message[];
        if (profile.commit !== undefined) {
            try {
                messages = messageList("commit", profile.commit(turn, format));
                const problem = pairingProblem(messages);
                if (problem !== null) {
                    problems.push({code: "commit-invalid", extension: profileId, entry: "commit", subject: turn.id, params: {turnId: turn.id}, message: `commit of turn ${turn.id} returned messages that are not valid (${problem.message}); the default commit is used`});
                    messages = messageList("turn", format.turn(turn));
                }
            } catch (error) {
                problems.push({code: "commit-threw", extension: profileId, entry: "commit", subject: turn.id, params: {turnId: turn.id}, message: `commit of turn ${turn.id} threw; the default commit is used`, error});
                messages = messageList("turn", format.turn(turn));
            }
        } else {
            messages = guard("turn", () => messageList("turn", profile.turn === undefined ? format.turn(turn) : profile.turn(turn, format)));
            if (checks && previousTurn?.turnId === turn.id && !isPrefix(previousTurn.keys, blockKeys(messages))) {
                problems.push({code: "commit-differs", extension: profileId, entry: "turn", subject: turn.id, params: {turnId: turn.id}, message: `turn ${turn.id} was committed differently from its last rendering; write a commit if this is intended`});
            }
        }
        const frozen = Object.freeze(messages);
        commits.set(turn, frozen);
        return frozen;
    };

    try {
        const system = guard("system", () => (typeof profile.system === "function" ? profile.system(profileView) : (profile.system ?? null)));
        const template = guard("prompt", () => (profile.prompt ?? standardLayout())(profileView));
        const rendered = renderTemplate(template, {
            system,
            tools: environment.tools,
            slots,
            history: (last) => {
                const turns = committedTurns(state.history);
                // `slice(-0)` 是全部，所以 `last` 不是正数时一轮也不放。
                return (last === undefined ? turns : last > 0 ? turns.slice(-last) : []).flatMap(committed);
            },
            turn: () => {
                const current = state.history.current;
                if (current === null) return [];
                const messages = guard("turn", () => messageList("turn", profile.turn === undefined ? format.turn(current) : profile.turn(current, format)));
                if (checks) {
                    const keys = blockKeys(messages);
                    if (previousTurn?.turnId === current.id && !isPrefix(previousTurn.keys, keys)) {
                        problems.push({code: "prefix-unstable", extension: profileId, entry: "turn", subject: current.id, params: {turnId: current.id}, message: `the rendering of turn ${current.id} is not an extension of its previous rendering; the provider cache misses from the first changed block`});
                    }
                    cache.lastTurn = {turnId: current.id, keys};
                }
                return messages;
            },
        });
        for (const problem of rendered.slotProblems) {
            problems.push(problem.code === "slot-unplaced"
                ? {code: "slot-unplaced", extension: problem.extension, entry: "contribute", subject: problem.slot, params: {slot: problem.slot}, message: `slot ${problem.slot} of ${problem.extension} has content but the template does not place it; the content is dropped`, hint: "place it with <Slot name=\"…\">, or catch it with <Slot name=\"*\">, or write <Slot name=\"…\" drop> if it is not wanted"}
                : {code: "slot-volatile-in-system", extension: problem.extension, entry: "contribute", subject: problem.slot, params: {slot: problem.slot}, message: `volatile slot ${problem.slot} of ${problem.extension} is placed in the system blocks; the whole prompt cache misses whenever it changes`});
        }
        const invalid = pairingProblem(rendered.messages);
        if (invalid !== null) {
            problems.push({code: "request-invalid", extension: profileId, entry: "prompt", params: {index: invalid.index}, message: `the request is not valid: ${invalid.message}`});
            return {ok: false, reason: "request-invalid", problems};
        }
        const request: ModelRequest = {
            purpose: inputs.purpose,
            model: inputs.model,
            ...(inputs.effort === undefined ? {} : {effort: inputs.effort}),
            params: {},
            headers: {},
            system: rendered.system,
            messages: rendered.messages,
            tools: inputs.tools,
        };
        return {ok: true, request, problems};
    } catch (error) {
        if (error instanceof ProfileEntryError) return {ok: false, reason: "profile-failed", entry: error.entry, code: "threw", error: error.original, problems};
        if (error instanceof TemplateError) {
            problems.push({code: error.code, extension: profileId, entry: "prompt", message: error.message});
            return {ok: false, reason: "profile-failed", entry: "prompt", code: "invalid-output", error, problems};
        }
        throw error;
    }
}
