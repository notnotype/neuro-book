/**
 * JSONL 存储（docs/specs/harness/session.md 输出 5–8、17 与“副作用与数据”）：`<root>/<会话 id>.jsonl`，
 * 第一行会话头，之后每行一个条目，每行以换行结束。只追加；只有 `repair` 截掉末尾的中断尾。
 *
 * 中断尾与行号都按字节算，不按字符：截断发生在字节边界，用 Buffer 找最后一个换行才能和文件里的内容对上。
 */

import {open, readdir, readFile, truncate, unlink} from "node:fs/promises";
import {join} from "node:path";
import {isValidSessionId, storedEntryProblem, headerProblem} from "../entries";
import {summaryOf} from "../summary";
import type {Result, SessionEntry, SessionFailure, SessionHeader, SessionStore} from "../types";

const NEWLINE = 0x0a;

type Opened = {header: SessionHeader; entries: SessionEntry[]; damagedTail: {bytes: number} | null};

function fail<T>(code: SessionFailure, detail: string, extra: {line?: number} = {}): Result<T> {
    return {ok: false, code, detail, ...extra};
}

function errorCode(error: unknown): string | undefined {
    return typeof error === "object" && error !== null && "code" in error ? String((error as {code: unknown}).code) : undefined;
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 把文件内容切成完整的行与中断尾。 */
function splitLines(bytes: Buffer): {lines: string[]; tailBytes: number} {
    const lastNewline = bytes.lastIndexOf(NEWLINE);
    const complete = lastNewline === -1 ? "" : bytes.subarray(0, lastNewline + 1).toString("utf8");
    const lines = complete === "" ? [] : complete.slice(0, -1).split("\n");
    return {lines, tailBytes: bytes.length - (lastNewline + 1)};
}

function parseSession(bytes: Buffer, expectedId: string): Result<Opened> {
    const {lines, tailBytes} = splitLines(bytes);
    if (lines.length === 0) return fail("corrupt-session", "会话头缺失", {line: 1});
    let rawHeader: unknown;
    try {
        rawHeader = JSON.parse(lines[0]!);
    } catch (error) {
        return fail("corrupt-session", `会话头不是合法 JSON：${describe(error)}`, {line: 1});
    }
    if (typeof rawHeader === "object" && rawHeader !== null && (rawHeader as {type?: unknown}).type === "session" && (rawHeader as {version?: unknown}).version !== 1) {
        return fail("unsupported-version", `会话头版本 ${String((rawHeader as {version?: unknown}).version)} 不支持，只支持 1`, {line: 1});
    }
    const headerIssue = headerProblem(rawHeader);
    if (headerIssue !== null) return fail("corrupt-session", `会话头无效：${headerIssue}`, {line: 1});
    // 文件名与会话头的 id 各自都是身份：误复制、改名的文件不能以另一个 id 打开，否则游标、追加的存储 key 与句柄身份会对不上。
    const headerId = (rawHeader as SessionHeader).id;
    if (headerId !== expectedId) return fail("corrupt-session", `会话头的 id 是 ${headerId}，与文件名 ${expectedId} 不一致`, {line: 1});
    const entries: SessionEntry[] = [];
    for (let index = 1; index < lines.length; index += 1) {
        const line = index + 1;
        let raw: unknown;
        try {
            raw = JSON.parse(lines[index]!);
        } catch (error) {
            return fail("corrupt-session", `第 ${line} 行不是合法 JSON：${describe(error)}`, {line});
        }
        const problem = storedEntryProblem(raw);
        if (problem !== null) return fail("corrupt-session", `第 ${line} 行不符合条目规则：${problem}`, {line});
        entries.push(raw as SessionEntry);
    }
    return {ok: true, value: {header: rawHeader as SessionHeader, entries, damagedTail: tailBytes === 0 ? null : {bytes: tailBytes}}};
}

export function createJsonlSessionStore(options: {root: string}): SessionStore {
    const pathOf = (id: string): string => join(options.root, `${id}.jsonl`);

    const readSession = async (id: string): Promise<Result<Opened>> => {
        let bytes: Buffer;
        try {
            bytes = await readFile(pathOf(id));
        } catch (error) {
            return errorCode(error) === "ENOENT" ? fail("session-not-found", `会话不存在：${id}`) : fail("store-failed", `读取会话文件失败：${describe(error)}`);
        }
        return parseSession(bytes, id);
    };

    return {
        async create(header) {
            if (!isValidSessionId(header.id)) return fail("invalid-session-id", `会话 id 不合规则：${header.id}`);
            const path = pathOf(header.id);
            let handle: Awaited<ReturnType<typeof open>> | null = null;
            try {
                handle = await open(path, "wx");
            } catch (error) {
                if (errorCode(error) === "EEXIST") return fail("session-exists", `会话已存在：${header.id}`);
                return fail("store-failed", `创建会话文件失败：${describe(error)}`);
            }
            try {
                await handle.writeFile(`${JSON.stringify(header)}\n`, "utf8");
                return {ok: true, value: undefined};
            } catch (error) {
                // 会话头没写成就把文件删掉，否则这个 id 会永远 session-exists、打开又是 corrupt-session；删不掉时写进 detail。
                await handle.close();
                handle = null;
                const cleanup = await unlink(path).then(() => "", (unlinkError: unknown) => `；清理失败：${describe(unlinkError)}`);
                return fail("store-failed", `写入会话头失败：${describe(error)}${cleanup}`);
            } finally {
                await handle?.close();
            }
        },
        async open(id) {
            if (!isValidSessionId(id)) return fail("invalid-session-id", `会话 id 不合规则：${id}`);
            return readSession(id);
        },
        async append(id, entries) {
            // 用 r+ 在文件末尾写而不用 a：会话文件被删除时报错，而不是悄悄造出一个没有会话头的文件。
            const text = entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
            let handle: Awaited<ReturnType<typeof open>> | null = null;
            try {
                handle = await open(pathOf(id), "r+");
                const {size} = await handle.stat();
                await handle.write(text, size, "utf8");
                return {ok: true, value: undefined};
            } catch (error) {
                return fail("store-failed", `追加会话文件失败：${describe(error)}`);
            } finally {
                await handle?.close();
            }
        },
        async repair(id) {
            try {
                const bytes = await readFile(pathOf(id));
                const keep = bytes.lastIndexOf(NEWLINE) + 1;
                if (keep === bytes.length) return {ok: true, value: {droppedBytes: 0}};
                await truncate(pathOf(id), keep);
                return {ok: true, value: {droppedBytes: bytes.length - keep}};
            } catch (error) {
                return fail("store-failed", `修复会话文件失败：${describe(error)}`);
            }
        },
        async list() {
            let names: string[];
            try {
                names = await readdir(options.root);
            } catch (error) {
                return fail("store-failed", `读取会话目录失败：${describe(error)}`);
            }
            // v1 的代价：每个会话整读并完整校验，list 一次读的字节数是全部会话文件之和（Spec 不承诺列表的检索与分页）。
            const summaries = [];
            for (const name of names) {
                if (!name.endsWith(".jsonl")) continue;
                const id = name.slice(0, -".jsonl".length);
                if (!isValidSessionId(id)) continue;
                const opened = await readSession(id);
                if (opened.ok) {
                    summaries.push(summaryOf(opened.value.header, opened.value.entries));
                    continue;
                }
                // 读不出来的文件（权限、I/O）是存储故障，要报出去让调用方重试；文件内容坏了或版本不支持才是“损坏的会话不列出”。
                if (opened.code === "store-failed") return opened as Result<never>;
            }
            return {ok: true, value: summaries};
        },
    };
}
