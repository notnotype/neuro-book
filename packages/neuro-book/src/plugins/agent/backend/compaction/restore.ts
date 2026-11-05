/**
 * 压缩之后放回什么（docs/specs/agent/compaction.md 输出 7–11）：最近成功读过或改过的文件、计划、会话日志的地址。
 * 摘要换掉了对话，模型手里没有这些文件的内容了；放回的格式与 `read` 相同并登记同一份行锚快照，模型接着用行锚就能改。
 */

import {readFile, stat} from "node:fs/promises";

import {estimateTokens} from "@notnotype/nb-harness/kernel";
import type {CompactionRestoreArgs, CompactionRestored, JsonValue, LogEvent, ToolSessionContext} from "@notnotype/nb-harness/kernel/contracts";

import {decodeText} from "nbook/plugins/files/shared/contracts";
import type {WorkspaceFiles} from "nbook/plugins/files/shared/contracts";

import type {SessionEditStores} from "../builtin/common";
import {MAX_READ_LINES, renderSnapshot, SNAPSHOT_MAX_BYTES} from "../builtin/read";
import {sessionResources} from "../resources";
import type {SessionResources} from "../../shared/resources";

const MAX_FILES = 5;
const FILE_TOKENS = 8_000;
const TOTAL_TOKENS = 20_000;
/** 放回的合计不超过模型窗口的这个比例：小窗口的模型放不下两万。 */
const WINDOW_SHARE = 0.25;
/** 剩下的预算低于这个就不放了，截得太短没有用。 */
const MIN_FILE_TOKENS = 400;
/** 估算的口径是每 3 字节一个 token：预算换成字节给排版。 */
const BYTES_PER_TOKEN = 3;

const READ = "nbook.agent.read";
const WRITE = "nbook.agent.write";
const EDITS: readonly string[] = ["nbook.agent.edit", "nbook.agent.edit-replace"];
const PLAN = "session://plan.md";

export interface RestoreOptions {
    readonly files: WorkspaceFiles;
    readonly editStores: SessionEditStores;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

/** 压缩前的路径里，最近成功读过或改过的文件地址，最近的在前：调用与结果按 `callId` 配对，只收成功的。 */
export function recentFiles(path: readonly LogEvent[], resources: Pick<SessionResources, "expand">): string[] {
    const started = new Map<string, {readonly tool: string; readonly args: Readonly<Record<string, unknown>>}>();
    const found: string[] = [];
    for (const event of path) {
        if (event.type === "toolStarted") {
            const data = event.data as {callId: string; tool: string; args: Readonly<Record<string, unknown>>};
            started.set(data.callId, {tool: data.tool, args: data.args});
        } else if (event.type === "toolResult") {
            const data = event.data as {callId: string; status: string; details?: {files?: readonly {address?: string; status?: string}[]}};
            const call = started.get(data.callId);
            if (call === undefined) continue;
            const addresses: string[] = [];
            if ((call.tool === READ || call.tool === WRITE) && data.status === "ok" && typeof call.args.path === "string") addresses.push(call.args.path);
            // `edit` 可以一次改几个文件，部分失败时按文件看哪些写成了。
            else if (EDITS.includes(call.tool)) for (const file of data.details?.files ?? []) if (file.status === "written" && typeof file.address === "string") addresses.push(file.address);
            for (const address of addresses) {
                const expanded = resources.expand(address);
                if (expanded.ok) found.push(expanded.address);
            }
        }
    }
    // 同一个文件读过又改过，只算最近的一次；最近的排前面。
    return [...new Set(found.reverse())];
}

/**
 * 放回用的服务。行锚的快照在内存里，按会话共用：工具建过实现的会话已经有人持有，没有时（重启后第一次压缩就在读文件之前）
 * 这里自己持有到会话关闭，否则放回的行锚在 `edit` 看来是不存在的。
 */
export class CompactionRestore {
    readonly #pins = new Map<string, {release(): void}>();

    constructor(private readonly options: RestoreOptions) {}

    /** 会话关了：放掉自己持有的快照。 */
    forget(sessionId: string): void {
        this.#pins.get(sessionId)?.release();
        this.#pins.delete(sessionId);
    }

    readonly run = async (context: ToolSessionContext, args: CompactionRestoreArgs): Promise<CompactionRestored> => {
        // 没有换掉对话（shake）：放回会把省下的又加回去。
        if (args.replacement === null) return {notices: []};
        const resources = sessionResources(this.options.files, context, null);
        const held = this.#pin(context.sessionId);
        const budget = Math.min(TOTAL_TOKENS, args.contextWindow > 0 ? Math.floor(args.contextWindow * WINDOW_SHARE) : TOTAL_TOKENS);
        let left = budget;
        const notices: string[] = [];
        const restored: JsonValue[] = [];
        const take = async (address: string, kind: "file" | "plan"): Promise<void> => {
            const perFile = Math.min(FILE_TOKENS, left);
            if (perFile < MIN_FILE_TOKENS) return;
            const shown = await this.#render(resources, held, address, perFile, args.signal);
            if (shown === null) return;
            const tokens = estimateTokens(shown.text);
            left -= tokens;
            notices.push(`${kind === "plan" ? "这是计划文件，压缩前就在用。下面是它现在的内容：" : "压缩之前你读过或改过这个文件，下面是它现在的内容："}\n${shown.text}`);
            restored.push({kind, target: address, tokens, truncated: shown.more});
        };
        const plan = resources.expand(PLAN);
        const planAddress = plan.ok ? plan.address : null;
        for (const address of recentFiles(args.path, resources)) {
            if (notices.length >= MAX_FILES || args.signal.aborted) break;
            // 计划单独放，别算进最近的文件里占名额。
            if (address !== planAddress) await take(address, "file");
        }
        if (planAddress !== null && !args.signal.aborted) await take(planAddress, "plan");
        const log = `sessions://${context.sessionId}/session.jsonl`;
        notices.push(`完整的对话记录在 ${log}（JSONL，每行一个事件）：压缩掉的细节需要时用 read 取回。`);
        restored.push({kind: "log", target: log, tokens: 0, truncated: false});
        return {notices, restored};
    };

    #pin(sessionId: string): {readonly store: ReturnType<SessionEditStores["acquire"]>["store"]} {
        let hold = this.#pins.get(sessionId);
        if (hold === undefined) {
            hold = this.options.editStores.acquire(sessionId);
            this.#pins.set(sessionId, hold);
        }
        return hold as ReturnType<SessionEditStores["acquire"]>;
    }

    /** 读一个文件、排版成 `read` 的样子；读不到、不是文本、太大都跳过并记一条诊断（放回不让压缩失败）。 */
    async #render(resources: SessionResources, held: {readonly store: ReturnType<SessionEditStores["acquire"]>["store"]}, address: string, tokens: number, signal: AbortSignal): Promise<{readonly text: string; readonly more: boolean} | null> {
        const skip = (reason: string): null => {
            this.options.report("restore-skipped", `${address} was not restored: ${reason}`, {address, reason});
            return null;
        };
        const located = await resources.readPath(address, {signal});
        if (!located.ok) return skip(located.code);
        if (located.value.kind !== "file") return skip("not-a-file");
        const {size} = await stat(located.value.path).catch(() => ({size: -1}));
        if (size < 0) return skip("gone");
        if (size > SNAPSHOT_MAX_BYTES) return skip("too-large");
        const text = decodeText(await readFile(located.value.path));
        if (text === null) return skip("not-text");
        // 字节预算只数正文的行，排版加的行号与行锚不算：按排完的估算再收一收，直到放得进预算。
        let bytes = tokens * BYTES_PER_TOKEN;
        for (let attempt = 0; ; attempt += 1) {
            const shown = await renderSnapshot(held.store, located.value.path, address, text, 1, MAX_READ_LINES, bytes);
            const used = estimateTokens(shown.text);
            if (used <= tokens || attempt >= 4 || bytes <= 1_000) return shown;
            bytes = Math.floor(bytes * (tokens / used) * 0.95);
        }
    }
}
