/**
 * `edit`（docs/specs/agent/builtin-tools.md 输出 10–13）：行锚与替换共用 `pi-natives` 的引擎。引擎只算新内容，落盘都经写入接口：
 * 一次调用内读到基线，写回时核对，不把基线带到调用之外（t12 决定 12）。
 */

import {EditSession, EditStore, editDescription, editGrammar, editInspect} from "@oh-my-pi/pi-natives";
import type {EditApplyOutcome, EditPolicy, EditUrlResolution, EditWriteRequest, EditWriteResponse} from "@oh-my-pi/pi-natives";

import type {ToolResult} from "../../kernel/contracts.js";
import {failed, failure, schemeOf} from "../files/index.js";
import type {Baseline, SessionFiles} from "../files/index.js";
import type {SessionEditStores} from "./snapshot.js";
import type {KitToolDeclaration, KitToolImplementation} from "./types.js";

type Mode = "hashline" | "replace";

/**
 * 引擎的本地路径分支（相对路径按 `cwd`、`~` 按 `homeDir`）不能碰到真实目录：目标都先按资源地址校验过，这两个只是兜底，
 * 写一个不存在的目录。
 */
const NO_LOCAL_PATHS = "/nonexistent/harness-kit-edit";
/** 与 `read` 的单行上限对应：有行锚来源的长行引擎仍认，没有的拒绝。 */
const MAX_COLUMNS = 2_000;

/** `note` 接在引擎的说明后面：地址怎么写、能改什么是宿主的事实。 */
export const hashlineDeclaration = (note: string): KitToolDeclaration => ({
    description: `${editDescription("hashline")}${note}`,
    parameters: {type: "object", properties: {input: {type: "string"}}, required: ["input"]},
    customFormat: {syntax: "lark", definition: editGrammar("hashline") as string},
    version: "1",
    concurrency: "exclusive",
    effect: "write",
});

export const replaceDeclaration = (note: string): KitToolDeclaration => ({
    description: `${editDescription("replace")}${note}`,
    parameters: {
        type: "object",
        properties: {path: {type: "string"}, old_string: {type: "string"}, new_string: {type: "string"}, replace_all: {type: "boolean"}},
        required: ["path", "old_string", "new_string"],
    },
    version: "1",
    concurrency: "exclusive",
    effect: "write",
});

/**
 * 进引擎前把目标换成全局地址：引擎的结果头照抄输入的写法，这样输出才是全局地址，不必去改引擎的文字（输出 1）。
 * hashline 只改文件头行：正文行都以 `+` 开头，不会被当成头。
 */
function globalArgs(mode: Mode, args: Readonly<Record<string, unknown>>, expanded: ReadonlyMap<string, string>): Readonly<Record<string, unknown>> {
    if (mode === "replace") return {...args, path: expanded.get(args.path as string)};
    return {...args, input: (args.input as string).replace(/^\[([^#\r\n]+)#/gmu, (whole, path: string) => {
        const address = expanded.get(path);
        return address === undefined ? whole : `[${address}#`;
    })};
}

interface FileOutcome {
    readonly address: string;
    readonly status: "written" | "failed";
    readonly code?: string;
}

/** 部分失败时引擎的文字只剩失败消息，`details` 又不进模型请求：已写成的文件要写进文字，模型才知道（输出 13）。 */
function summary(files: readonly FileOutcome[]): string {
    return ["", "逐文件结果：", ...files.map((file) => `- ${file.address}：${file.status === "written" ? "已写入" : `失败（${file.code ?? ""}）`}`)].join("\n");
}

function editTool(mode: Mode, stores: SessionEditStores): KitToolImplementation {
    return {
        // 一次能改几个文件，路径由编辑引擎读出来，和执行时用的是同一份。
        subjects: (args) => editInspect(mode, JSON.stringify(args)).paths.map((address) => ({kind: "path", access: "write", address})),
        create: (context, {files}) => {
            const held = stores.acquire(context.sessionId);
            return {
                dispose: () => held.release(),
                execute: (args, call) => run(mode, args, files, held.store, call),
            };
        },
    };
}

/**
 * 预检目标、读基线、跑引擎。引擎只算新内容，落盘交给 `save`：工具写回并核对基线，审批预览只记下算出来的内容。
 * `save` 抛错就是这个文件写失败，引擎按部分失败收口。
 */
async function runEngine(mode: Mode, args: Readonly<Record<string, unknown>>, files: SessionFiles, store: EditStore, signal: AbortSignal, save: (address: string, content: string, baseline: Baseline) => Promise<void>): Promise<{readonly ok: true; readonly outcome: EditApplyOutcome} | {readonly ok: false; readonly failure: ToolResult}> {
    const inspection = editInspect(mode, JSON.stringify(args));
    if (inspection.fileOps.length > 0) return {ok: false, failure: failed("unsupported-capability", `unsupported-capability: edit 不删除、不移动文件（${inspection.fileOps.map((op) => `${op.kind} ${op.path}`).join("，")}），什么都没有改`)};

    const expanded = new Map<string, string>();
    for (const path of inspection.paths) {
        const address = files.expand(path);
        if (!address.ok) return {ok: false, failure: failed(address.code, `${address.code}: edit 的目标要是资源地址：${path}（${address.detail}），什么都没有改`)};
        expanded.set(path, address.address);
    }

    const baselines = new Map<string, Baseline>();
    for (const address of new Set(expanded.values())) {
        const read = await files.read(address, {signal});
        if (!read.ok) return {ok: false, failure: read.code === "not-found" ? failed("not-found", `not-found: ${address} 不存在，新建要用 write`) : failure(read)};
        baselines.set(address, read.value.baseline);
    }

    // 引擎按真实路径登记快照、交写入请求；写回要换回地址。
    const addressOf = new Map<string, string>();
    const resolveUrl = async (error: Error | null, url: string): Promise<EditUrlResolution> => {
        if (error !== null) return {error: error.message, planWritable: false};
        const located = await files.readPath(url, {signal});
        if (!located.ok) return {error: `${located.code}: ${located.detail}`, planWritable: false};
        addressOf.set(located.value.path, url);
        return {path: located.value.path, planWritable: false};
    };
    const policy: EditPolicy = {
        cwd: NO_LOCAL_PATHS,
        homeDir: NO_LOCAL_PATHS,
        mode,
        allowFuzzy: true,
        fuzzyThreshold: 0.95,
        enforceSeenLines: true,
        maxColumns: MAX_COLUMNS,
        blockAutoGenerated: false,
        planActive: false,
        urlSchemes: [...new Set([...expanded.values()].map(schemeOf))],
        urlAliasSchemes: [],
        planWritableRoots: [],
        rawInput: false,
    };

    const writer = async (error: Error | null, request: EditWriteRequest): Promise<EditWriteResponse> => {
        if (error !== null) throw error;
        const address = addressOf.get(request.path);
        const baseline = address === undefined ? undefined : baselines.get(address);
        // 预检已挡住删除与移动，地址也都读过：走到这里说明预检与引擎对目标的理解不一致，不写。
        if (address === undefined || baseline === undefined || request.op !== "update" || request.content === undefined) throw new Error(`edit engine asked for an unexpected ${request.op} of ${request.displayPath}`);
        await save(address, request.content, baseline);
        return {written: request.content};
    };

    const engine = new EditSession(store, policy, undefined, resolveUrl);
    try {
        engine.setArgsJson(JSON.stringify(globalArgs(mode, args, expanded)));
        engine.finish();
        return {ok: true, outcome: await engine.apply({lspFlush: false}, writer)};
    } finally {
        engine.close();
    }
}

async function run(mode: Mode, args: Readonly<Record<string, unknown>>, files: SessionFiles, store: EditStore, call: {readonly callId: string; readonly signal: AbortSignal}): Promise<ToolResult> {
    const scoped = files.call(call);
    const outcomes: FileOutcome[] = [];
    let writeFailure: string | null = null;
    const ran = await runEngine(mode, args, files, store, call.signal, async (address, content, baseline) => {
        const saved = await scoped.write(address, content, {expect: baseline});
        if (!saved.ok) {
            writeFailure = saved.code;
            outcomes.push({address, status: "failed", code: saved.code});
            throw new Error(`${saved.code}: ${saved.detail}`);
        }
        outcomes.push({address, status: "written"});
    });
    if (!ran.ok) return ran.failure;
    const {outcome} = ran;
    if (!outcome.isError) return {text: outcome.text, details: {mode, files: outcomes as unknown as never}};
    const code = writeFailure ?? `edit-${outcome.errorKind ?? "failed"}`;
    const partial = outcomes.some((file) => file.status === "written");
    return {text: partial ? `${outcome.text}\n${summary(outcomes)}` : outcome.text, status: "error", code, details: {mode, code, files: outcomes as unknown as never}};
}

/**
 * 审批预览（输出 26）：试算 `edit` 的结果，不写盘。引擎落盘之后会更新快照，所以在一份副本上跑，会话的行锚不受影响：
 * 副本里放这次调用引用的那些快照，行锚的校验和真的执行时一样。
 */
export async function previewEdit(mode: Mode, args: Readonly<Record<string, unknown>>, files: SessionFiles, store: EditStore, maxBytes: number, signal: AbortSignal): Promise<{readonly written: ReadonlyMap<string, string>; readonly tooLarge: ReadonlyMap<string, number>; readonly failure: {readonly code: string; readonly targets: readonly string[]} | null}> {
    const targets = new Set(editInspect(mode, JSON.stringify(args)).paths.map((path) => {
        const expanded = files.expand(path);
        return expanded.ok ? expanded.address : path;
    }));
    // 先看原文件：这时用户还没批准，不为超过预算的文件试算（`replace_all` 的结果可以比原文件大很多倍）。存在的才往下走：
    // 下面的 `readPath` 会创建挂载目录，预览不能有这个副作用。
    const sizes = new Map<string, number>();
    for (const target of targets) {
        const read = await files.read(target, {signal});
        if (read.ok) sizes.set(target, read.value.bytes.byteLength);
    }
    const tooLarge = new Map([...sizes].filter(([, bytes]) => bytes > maxBytes));
    if (tooLarge.size > 0) return {written: new Map(), tooLarge, failure: {code: "preview-skipped", targets: [...targets].filter((target) => !tooLarge.has(target))}};

    const scratch = new EditStore();
    if (mode === "hashline") {
        for (const [, path, tag] of (args.input as string).matchAll(/^\[([^#\r\n]+)#([^\]\s]+)/gmu)) {
            const expanded = files.expand(path!);
            const located = expanded.ok && sizes.has(expanded.address) ? await files.readPath(expanded.address, {signal}) : null;
            if (located?.ok !== true) continue;
            const text = store.byHashText(located.value.path, tag!);
            if (text !== null) scratch.recordSnapshot(located.value.path, text, store.seenLines(located.value.path, tag!));
        }
    }
    const written = new Map<string, string>();
    const ran = await runEngine(mode, args, files, scratch, signal, async (address, content) => {
        written.set(address, content);
    });
    const unwritten = [...targets].filter((target) => !written.has(target));
    if (!ran.ok) return {written, tooLarge, failure: {code: ran.failure.code ?? "edit-failed", targets: unwritten}};
    if (ran.outcome.isError) return {written, tooLarge, failure: {code: `edit-${ran.outcome.errorKind ?? "failed"}`, targets: unwritten}};
    // 引擎说成功却没写这个目标：副本里没有的状态（前面调用存的寄存器）算不出来，实际执行时可能会改。不能当成没有改动。
    return {written, tooLarge, failure: unwritten.length === 0 ? null : {code: "edit-no-preview", targets: unwritten}};
}

export const hashlineTool = (stores: SessionEditStores): KitToolImplementation => editTool("hashline", stores);
export const replaceTool = (stores: SessionEditStores): KitToolImplementation => editTool("replace", stores);
