/**
 * `edit`（docs/specs/agent/builtin-tools.md 输出 10–13）：行锚与替换共用 `pi-natives` 的引擎。引擎只算新内容，落盘都经写入接口：
 * 一次调用内读到基线，写回时核对，不把基线带到调用之外（t12 决定 12）。
 */

import {EditSession, editDescription, editGrammar, editInspect} from "@oh-my-pi/pi-natives";
import type {EditPolicy, EditUrlResolution, EditWriteRequest, EditWriteResponse} from "@oh-my-pi/pi-natives";

import type {ToolResult} from "@notnotype/nb-harness/kernel/contracts";

import type {Baseline} from "nbook/plugins/files/shared/contracts";

import type {AgentToolDeclaration, AgentToolImplementation} from "../../shared/points";
import type {SessionResources} from "../../shared/resources";

import {failed, failure} from "./common";
import type {SessionEditStores} from "./common";

type Mode = "hashline" | "replace";

/**
 * 引擎的本地路径分支（相对路径按 `cwd`、`~` 按 `homeDir`）不能碰到真实目录：目标都先按资源地址校验过，这两个只是兜底，
 * 写一个不存在的目录。
 */
const NO_LOCAL_PATHS = "/nonexistent/nbook-agent-edit";
/** 与 `read` 的单行上限对应：有行锚来源的长行引擎仍认，没有的拒绝。 */
const MAX_COLUMNS = 2_000;

const NOTE = "\n\n路径都是资源地址（例如 project://正文/第一章.md），不接受裸路径。只改已存在的文件，新建用 write；不删除、不移动文件。";

export const hashlineDeclaration: AgentToolDeclaration = {
    description: `${editDescription("hashline")}${NOTE}`,
    parameters: {type: "object", properties: {input: {type: "string"}}, required: ["input"]},
    customFormat: {syntax: "lark", definition: editGrammar("hashline") as string},
    version: "1",
    concurrency: "exclusive",
    effect: "write",
};

export const replaceDeclaration: AgentToolDeclaration = {
    description: `${editDescription("replace")}${NOTE}`,
    parameters: {
        type: "object",
        properties: {path: {type: "string"}, old_string: {type: "string"}, new_string: {type: "string"}, replace_all: {type: "boolean"}},
        required: ["path", "old_string", "new_string"],
    },
    version: "1",
    concurrency: "exclusive",
    effect: "write",
};

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

const schemeOf = (address: string): string => address.slice(0, address.indexOf("://"));

interface FileOutcome {
    readonly address: string;
    readonly status: "written" | "failed";
    readonly code?: string;
}

/** 部分失败时引擎的文字只剩失败消息，`details` 又不进模型请求：已写成的文件要写进文字，模型才知道（输出 13）。 */
function summary(files: readonly FileOutcome[]): string {
    return ["", "逐文件结果：", ...files.map((file) => `- ${file.address}：${file.status === "written" ? "已写入" : `失败（${file.code ?? ""}）`}`)].join("\n");
}

function editTool(mode: Mode, stores: SessionEditStores): AgentToolImplementation {
    return {
        create: (context, {resources}) => {
            const held = stores.acquire(context.sessionId);
            return {
                dispose: () => held.release(),
                execute: (args, call) => run(mode, args, resources, held.store, call),
            };
        },
    };
}

async function run(mode: Mode, args: Readonly<Record<string, unknown>>, resources: SessionResources, store: ConstructorParameters<typeof EditSession>[0], call: {readonly callId: string; readonly signal: AbortSignal}): Promise<ToolResult> {
    const inspection = editInspect(mode, JSON.stringify(args));
    if (inspection.fileOps.length > 0) return failed("unsupported-capability", `unsupported-capability: edit 不删除、不移动文件（${inspection.fileOps.map((op) => `${op.kind} ${op.path}`).join("，")}），什么都没有改`);

    const expanded = new Map<string, string>();
    for (const path of inspection.paths) {
        const address = resources.expand(path);
        if (!address.ok) return failed(address.code, `${address.code}: edit 的目标要是资源地址：${path}（${address.detail}），什么都没有改`);
        expanded.set(path, address.address);
    }

    const baselines = new Map<string, Baseline>();
    for (const address of new Set(expanded.values())) {
        const read = await resources.read(address, {signal: call.signal});
        if (!read.ok) return read.code === "not-found" ? failed("not-found", `not-found: ${address} 不存在，新建要用 write`) : failure(read);
        baselines.set(address, read.value.baseline);
    }

    // 引擎按真实路径登记快照、交写入请求；写回要换回地址。
    const addressOf = new Map<string, string>();
    const resolveUrl = async (error: Error | null, url: string): Promise<EditUrlResolution> => {
        if (error !== null) return {error: error.message, planWritable: false};
        const located = await resources.readPath(url, {signal: call.signal});
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

    const scoped = resources.call(call);
    const files: FileOutcome[] = [];
    let writeFailure: string | null = null;
    const writer = async (error: Error | null, request: EditWriteRequest): Promise<EditWriteResponse> => {
        if (error !== null) throw error;
        const address = addressOf.get(request.path);
        const baseline = address === undefined ? undefined : baselines.get(address);
        // 预检已挡住删除与移动，地址也都读过：走到这里说明预检与引擎对目标的理解不一致，不写。
        if (address === undefined || baseline === undefined || request.op !== "update" || request.content === undefined) throw new Error(`edit engine asked for an unexpected ${request.op} of ${request.displayPath}`);
        const saved = await scoped.write(address, request.content, {expect: baseline});
        if (!saved.ok) {
            writeFailure = saved.code;
            files.push({address, status: "failed", code: saved.code});
            throw new Error(`${saved.code}: ${saved.detail}`);
        }
        files.push({address, status: "written"});
        return {written: request.content};
    };

    const engine = new EditSession(store, policy, undefined, resolveUrl);
    try {
        engine.setArgsJson(JSON.stringify(globalArgs(mode, args, expanded)));
        engine.finish();
        const outcome = await engine.apply({lspFlush: false}, writer);
        if (!outcome.isError) return {text: outcome.text, details: {mode, files: files as unknown as never}};
        const code = writeFailure ?? `edit-${outcome.errorKind ?? "failed"}`;
        const partial = files.some((file) => file.status === "written");
        return {text: partial ? `${outcome.text}\n${summary(files)}` : outcome.text, status: "error", code, details: {mode, code, files: files as unknown as never}};
    } finally {
        engine.close();
    }
}

export const hashlineTool = (stores: SessionEditStores): AgentToolImplementation => editTool("hashline", stores);
export const replaceTool = (stores: SessionEditStores): AgentToolImplementation => editTool("replace", stores);
