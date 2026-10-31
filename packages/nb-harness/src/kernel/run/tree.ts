/**
 * 会话树：回退目标、`rewind`、`switchBranch`、兄弟节点（docs/specs/harness/runtime.md 输出 35–37）。
 *
 * 回退只换叶子（写 `leafChanged`），日志不删。目标是一轮之前、一轮之后、或某一步的模型请求之前；落在运行中途时，
 * 那条分支上的运行是暂停的：`start`（或 `send`）让它接着跑，下一次模型请求的回复成为旧回复的兄弟节点（重试与 swipe）。
 */

import type {CommandMap, CommandResult, JsonValue, LogEvent, RewindTarget} from "../api/index.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";
import {accept, isEmpty, startProblem, type CommandHost} from "./commands.js";
import {interceptInput, queuedData} from "./input.js";
import {takeInputDrafts} from "./loop.js";

/** 当前路径上的回退目标，按路径顺序。一次前向扫描：用户的话在 turnStarted 之后才出现，到时补进这一轮的目标里。 */
export function rewindTargets(core: SessionCore): RewindTarget[] {
    const path = core.pathTo();
    const targets: RewindTarget[] = [];
    let turn: {id: string; targets: RewindTarget[]; inputText: string | null} | null = null;
    const add = (id: string | null, kind: RewindTarget["kind"]) => {
        if (id === null || turn === null) return;
        const target: RewindTarget = {id, kind, turnId: turn.id, inputText: turn.inputText};
        turn.targets.push(target);
        targets.push(target);
    };
    for (let index = 0; index < path.length; index += 1) {
        const event = path[index]!;
        switch (event.type) {
            case "turnStarted": {
                turn = {id: (event.data as {turnId: string}).turnId, targets: [], inputText: null};
                // 一次运行的第一轮：回到 runStarted 之前（运行外，干净的空闲点）；后面的轮：回到上一轮结束处（运行中途）。
                const previous = path[index - 1];
                add(previous?.type === "runStarted" ? previous.parent : event.parent, "before-turn");
                break;
            }
            case "input":
                if (turn !== null && turn.inputText === null) {
                    turn.inputText = (event.data as {text: string}).text;
                    for (const target of turn.targets) target.inputText = turn.inputText;
                }
                break;
            case "modelStarted":
                if ((event.data as {purpose: string}).purpose === "turn") add(event.parent, "after-step");
                break;
            case "turnEnded": {
                // 这一轮也是运行的最后一轮时，目标落在 runEnded 上（运行外）。
                const next = path[index + 1];
                add(next?.type === "runEnded" ? next.id : event.id, "after-turn");
                turn = null;
                break;
            }
        }
    }
    return targets;
}

export function rewindCommand(host: CommandHost, args: CommandMap["rewind"]["args"] & {commandId: string}): Promise<CommandResult<"rewind">> {
    return accept(host, "rewind", args, async () => {
        const {core, control} = host;
        if (!control.idle) return {fail: "running", detail: {runId: control.active?.runId ?? ""}};
        if (args.to === null) return {fail: "invalid-target"};
        if (!core.byId.has(args.to)) return {fail: "unknown-node"};
        if (!rewindTargets(core).some((target) => target.id === args.to)) return {fail: "invalid-target"};
        const leaf: string = args.to;
        const moved: EventDraft = {type: "leafChanged", kind: "ctrl", scope: "session", data: {leaf}};
        if (args.resend === undefined) return {value: {leaf}, drafts: [moved]};
        // 编辑重发：回退后入队；目标在运行外就开新的运行，在运行中途就让暂停的运行接着跑。
        if (isEmpty(args.resend)) return {fail: "empty-input"};
        const problem = startProblem(host);
        if (problem !== null) return {fail: problem};
        const intercepted = await interceptInput(host, args.resend);
        if (!intercepted.ok) return {fail: "input-rejected", detail: intercepted.rejection};
        const inputId = core.newId();
        const queued: EventDraft = {type: "inputQueued", kind: "ctrl", scope: "session", data: queuedData(inputId, intercepted, "followup")};
        const paused = core.pathState(leaf).kernel.run;
        if (paused !== null) return {value: {leaf, inputId, runId: paused.runId}, drafts: [...intercepted.failed, moved, queued], launch: paused.runId};
        const runId = core.newId();
        const started: EventDraft = {type: "runStarted", kind: "ctrl", scope: "path", data: {runId, kind: "chat"}};
        return {value: {leaf, inputId, runId}, drafts: [...intercepted.failed, moved, queued, started, ...takeInputDrafts(inputId, intercepted.input, core.newId())], launch: runId};
    });
}

export function switchBranchCommand(host: CommandHost, args: CommandMap["switchBranch"]["args"] & {commandId: string}): Promise<CommandResult<"switchBranch">> {
    return accept(host, "switchBranch", args, () => {
        const {core, control} = host;
        if (!control.idle) return {fail: "running", detail: {runId: control.active?.runId ?? ""}};
        const node = core.byId.get(args.node);
        if (node === undefined || node.scope !== "path") return {fail: "unknown-node"};
        const leaf = core.latestIn(node.id).id;
        return {value: {leaf}, drafts: [{type: "leafChanged", kind: "ctrl", scope: "session", data: {leaf} as JsonValue}]};
    });
}

/** 与 `node` 同一个父节点的 path 事件（含它自己），各带所在分支最近写入的末端。 */
export function siblingsOf(core: SessionCore, node: string): {node: string; latestLeaf: string}[] {
    const event: LogEvent | undefined = core.byId.get(node);
    if (event === undefined || event.scope !== "path") return [];
    return core.childrenOf(event.parent).map((sibling) => ({node: sibling.id, latestLeaf: core.latestIn(sibling.id).id}));
}
