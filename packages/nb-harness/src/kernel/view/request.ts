/**
 * 视图：由某一刻的状态算出一次模型请求（提案第 8 节）。只在要发请求与预览时算。
 * Profile 的 `prompt`、`system`、`turn` 出错时这次请求算不出来，交回问题，由运行以 `profile-failed` 收口；
 * 扩展的 `contribute` 出错只让这个槽这次不交，`commit` 出错用缺省的提交，都记成问题由调用方转成诊断。
 */

import type {ConversationTurn, Message, ModelRequest, PromptChild, RenderTable, RequestPurpose, ToolDeclaration} from "../api/index.js";
import {committedTurns} from "../state/history.js";
import type {Assembly} from "../extension/assemble.js";
import {viewCtx, type StateAt, type ViewEnvironment} from "../extension/ctx.js";
import {createFormat, type RenderSources} from "./format.js";
import {renderTemplate, type SlotContent} from "./render.js";
import {standardLayout} from "./standard-layout.js";

export interface ViewProblem {
    readonly code: "contribute-threw" | "commit-threw" | "turn-node-count";
    readonly extension: string;
    readonly error?: unknown;
}

export type ComputedRequest =
    | {readonly ok: true; readonly request: ModelRequest; readonly problems: readonly ViewProblem[]}
    | {readonly ok: false; readonly entry: "prompt" | "system" | "turn"; readonly error: unknown; readonly problems: readonly ViewProblem[]};

export interface RequestInputs {
    readonly assembly: Assembly;
    readonly state: StateAt;
    readonly environment: ViewEnvironment;
    readonly purpose: RequestPurpose;
    readonly model: string;
    readonly effort?: string;
    readonly tools: readonly ToolDeclaration[];
}

type ProfileShape = {
    system?: PromptChild | ((view: unknown) => PromptChild);
    prompt?: (view: unknown) => PromptChild;
    turn?: (turn: ConversationTurn, format: unknown, view: unknown) => (Message | null)[];
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

export function renderSources(assembly: Assembly): RenderSources {
    const profile = assembly.profile as unknown as ProfileShape;
    const extensions = new Map<string, RenderTable>();
    for (const item of assembly.order) if (item.role !== "profile" && item.definition.render !== undefined) extensions.set(item.definition.id, item.definition.render as RenderTable);
    return {profile: profile.render ?? {}, extensions};
}

export function computeRequest(inputs: RequestInputs): ComputedRequest {
    const {assembly, state, environment} = inputs;
    const problems: ViewProblem[] = [];
    const profileItem = assembly.order[assembly.order.length - 1]!;
    const profile = assembly.profile as unknown as ProfileShape;
    const profileView = viewCtx(assembly, profileItem, state, environment);
    const format = createFormat(renderSources(assembly));

    const slots: SlotContent[] = [];
    for (const item of assembly.order) {
        for (const [name, contribution] of Object.entries(item.definition.contribute ?? {}) as [string, {volatile?: boolean; value: (view: unknown) => string | null | undefined}][]) {
            try {
                const text = contribution.value(viewCtx(assembly, item, state, environment));
                if (typeof text === "string" && text !== "") slots.push({name, extension: item.definition.id, volatile: contribution.volatile === true, text});
            } catch (error) {
                problems.push({code: "contribute-threw", extension: item.definition.id, error});
            }
        }
    }

    const committed = (turn: ConversationTurn): (Message | null)[] => {
        if (profile.commit === undefined) return format.turn(turn);
        try {
            return profile.commit(turn, format);
        } catch (error) {
            problems.push({code: "commit-threw", extension: profileItem.definition.id, error});
            return format.turn(turn);
        }
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
                return (last === undefined ? turns : turns.slice(-last)).flatMap(committed);
            },
            turn: () => {
                const current = state.history.current;
                if (current === null) return [];
                return guard("turn", () => (profile.turn === undefined ? format.turn(current) : profile.turn(current, format, profileView)));
            },
        });
        if (rendered.turnNodes !== 1) problems.push({code: "turn-node-count", extension: profileItem.definition.id});
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
        if (error instanceof ProfileEntryError) return {ok: false, entry: error.entry, error: error.original, problems};
        throw error;
    }
}
