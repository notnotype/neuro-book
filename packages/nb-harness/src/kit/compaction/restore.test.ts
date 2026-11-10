/**
 * 压缩之后的放回（docs/specs/agent/compaction.md 输出 7–11；测试名里的编号是它的输出条目）：最近成功读过或改过的文件、计划、日志
 * 的地址；预算与跳过；放回的行锚 `edit` 认得。文件访问用本机参考实现；计划与日志的地址、工具 id 是测试给的宿主值。
 */

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {chmod, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {LogEvent, ToolContext, ToolSessionContext} from "../../kernel/contracts.js";
import type {ArtifactStore, SessionFiles} from "../files/index.js";
import {localFiles} from "../files/local.js";
import {builtinTools, SessionEditStores} from "../tools/index.js";
import {CompactionRestore} from "./index.js";
import type {BuiltinToolIds} from "./index.js";

const TOOLS: BuiltinToolIds = {read: "kit.read", write: "kit.write", edits: ["kit.edit", "kit.edit-replace"], search: ["kit.grep", "kit.glob"], shell: "kit.shell"};
const GLOBAL = "work://home";
const context = {sessionId: "s-1", profile: "p"} as ToolSessionContext;

let root = "";
let home = "";
let files: SessionFiles;
let artifacts: ArtifactStore;
let stores: SessionEditStores;
let reports: {code: string; data?: Readonly<Record<string, unknown>>}[];

beforeEach(async () => {
    root = await createTestTmpRoot("nb-harness-kit", "compaction-restore");
    home = join(root, "work", "home");
    await mkdir(home, {recursive: true});
    stores = new SessionEditStores();
    reports = [];
    ({files, artifacts} = localFiles({
        roots: {work: join(root, "work")},
        aliases: {home: GLOBAL},
        layout: {working: "home://", scratch: [], localWrites: [], shellEnv: {}, searchExcludes: () => []},
        classify: () => "allowed",
        artifacts: "work://artifacts",
    }));
});
afterEach(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

function restoreWith(options: {readonly plan?: string | null; readonly log?: string | null} = {}): CompactionRestore {
    return new CompactionRestore({
        files: () => files,
        editStores: stores,
        tools: TOOLS,
        planOf: () => (options.plan === undefined ? "home://plan.md" : options.plan),
        logOf: () => (options.log === undefined ? "work://log/session.jsonl" : options.log),
        report: (code, _message, data) => reports.push({code, ...(data === undefined ? {} : {data})}),
    });
}

/** 一次调用与它的结果在日志里的样子：放回只看这两种事件。 */
let seq = 0;
function called(tool: string, args: Readonly<Record<string, unknown>>, status: "ok" | "error", details?: unknown): LogEvent[] {
    seq += 1;
    const callId = `call-${String(seq)}`;
    return [
        {type: "toolStarted", data: {callId, tool, args}} as unknown as LogEvent,
        {type: "toolResult", data: {callId, status, ...(details === undefined ? {} : {details})}} as unknown as LogEvent,
    ];
}

const run = (restore: CompactionRestore, path: readonly LogEvent[], contextWindow = 200_000) => restore.run(context, {signal: new AbortController().signal, method: "summary", replacement: "摘要", path, contextWindow});
const targets = (restored: unknown) => (restored as {kind: string; target: string}[]).map((item) => `${item.kind}:${item.target}`);

describe("放回", () => {
    test("输出 7：没有换掉对话（shake）时不放回", async () => {
        await writeFile(join(home, "a.md"), "一\n");
        const result = await restoreWith().run(context, {signal: new AbortController().signal, method: "shake", replacement: null, path: called(TOOLS.read, {path: "home://a.md"}, "ok"), contextWindow: 200_000});
        expect(result).toEqual({notices: []});
    });

    test("输出 7、9：只认成功的读、写与写成了的 edit，最近的在前、同一个文件只算一次；计划单独放、不占名额；日志的地址在最后", async () => {
        for (const name of ["a.md", "b.md", "c.md", "plan.md"]) await writeFile(join(home, name), `${name} 的内容\n`);
        const path = [
            ...called(TOOLS.read, {path: "home://a.md"}, "ok"),
            ...called(TOOLS.read, {path: "home://失败.md"}, "error"),
            ...called(TOOLS.write, {path: `${GLOBAL}/b.md`}, "ok"),
            ...called(TOOLS.edits[0]!, {input: "…"}, "error", {files: [{address: `${GLOBAL}/c.md`, status: "written"}, {address: `${GLOBAL}/d.md`, status: "failed"}]}),
            ...called(TOOLS.read, {path: "home://plan.md"}, "ok"),
            ...called(TOOLS.read, {path: "home://a.md"}, "ok"),
            ...called(TOOLS.search[0]!, {path: "home://b.md"}, "ok"),
        ];
        const result = await run(restoreWith(), path);
        expect(targets(result.restored)).toEqual([`file:${GLOBAL}/a.md`, `file:${GLOBAL}/c.md`, `file:${GLOBAL}/b.md`, `plan:${GLOBAL}/plan.md`, "log:work://log/session.jsonl"]);
        expect(result.notices[0]).toContain("压缩之前你读过或改过这个文件");
        expect(result.notices[0]).toContain("a.md 的内容");
        expect(result.notices[3]).toContain("这是计划文件");
        expect(result.notices.at(-1)).toContain("work://log/session.jsonl");
    });

    test("输出 7、11：宿主没有计划或日志时不放、不发那条提示", async () => {
        await writeFile(join(home, "a.md"), "一\n");
        await writeFile(join(home, "plan.md"), "计划\n");
        const result = await run(restoreWith({plan: null, log: null}), called(TOOLS.read, {path: "home://a.md"}, "ok"));
        expect(targets(result.restored)).toEqual([`file:${GLOBAL}/a.md`]);
        expect(result.notices).toHaveLength(1);
    });

    test("输出 7：至多放 5 个文件", async () => {
        const path: LogEvent[] = [];
        for (let index = 0; index < 7; index += 1) {
            await writeFile(join(home, `${String(index)}.md`), "x\n");
            path.push(...called(TOOLS.read, {path: `home://${String(index)}.md`}, "ok"));
        }
        const result = await run(restoreWith({log: null}), path);
        expect(targets(result.restored).filter((item) => item.startsWith("file:"))).toHaveLength(5);
    });

    test("输出 8、10：合计不超过窗口的四分之一，超了的文件截断并标出；单行就超预算、读不到的整份跳过，记一条诊断", async () => {
        await writeFile(join(home, "long.md"), Array.from({length: 3_000}, (_, line) => `第 ${String(line)} 行`).join("\n"));
        const truncated = await run(restoreWith({plan: null, log: null}), called(TOOLS.read, {path: "home://long.md"}, "ok"), 8_000);
        const item = (truncated.restored as {truncated: boolean; tokens: number}[])[0]!;
        expect(item.truncated).toBe(true);
        expect(item.tokens).toBeLessThanOrEqual(2_000);

        reports = [];
        await writeFile(join(home, "ok.md"), "好文件\n");
        await writeFile(join(home, "wide.md"), "宽".repeat(6_000));
        // 定位之后读不了（没有权限）：只跳过它，别的文件照放。
        await writeFile(join(home, "locked.md"), "读得到的时候没问题\n");
        await chmod(join(home, "locked.md"), 0o000);
        try {
            const skipped = await run(restoreWith({plan: null, log: null}), [...called(TOOLS.read, {path: "home://ok.md"}, "ok"), ...called(TOOLS.read, {path: "home://locked.md"}, "ok"), ...called(TOOLS.read, {path: "home://wide.md"}, "ok"), ...called(TOOLS.read, {path: "home://gone.md"}, "ok")], 8_000);
            expect(targets(skipped.restored)).toEqual([`file:${GLOBAL}/ok.md`]);
            expect(reports.map((report) => [report.code, report.data?.reason]).sort()).toEqual([["restore-skipped", "not-found"], ["restore-skipped", "over-budget"], ["restore-skipped", "unreadable"]]);
        } finally {
            await chmod(join(home, "locked.md"), 0o644);
        }
    });

    test("输出 9：放回给的行锚 edit 直接认得，不用再 read", async () => {
        await writeFile(join(home, "a.md"), "一\n二\n三\n");
        const result = await run(restoreWith({log: null}), called(TOOLS.read, {path: "home://a.md"}, "ok"));
        const tag = /#([0-9A-F]{4})\]/u.exec(result.notices[0]!)?.[1] ?? "";
        const edit = builtinTools({stores, dialects: () => undefined}).edit.create(context, {files, artifacts});
        const done = await edit.execute({input: `[${GLOBAL}/a.md#${tag}]\nPUT 2.=2:\n+贰\n`}, {callId: "c-1", signal: new AbortController().signal} as unknown as ToolContext);
        expect(typeof done === "string" ? done : done.status).not.toBe("error");
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n贰\n三\n");
    });
});
