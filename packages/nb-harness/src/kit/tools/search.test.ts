/**
 * `grep` 与 `glob` 自身的行为（docs/specs/agent/builtin-tools.md 输出 14、16、17；测试名里的编号是它的输出条目）：结果的地址、配额与
 * 截断、期限与取消、搜索根是链接。文件访问用本机参考实现；哪些文件不露出、虚拟根是什么由宿主定，这里用包一层的文件访问模拟。
 */

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {ToolContext, ToolResult, ToolSessionContext} from "../../kernel/contracts.js";
import type {ArtifactStore, SessionFiles} from "../files/index.js";
import {localFiles} from "../files/local.js";
import {globTool, grepTool, runGlob, runGrep} from "./search.js";
import type {KitToolImplementation} from "./types.js";

let root = "";
let home = "";
let files: SessionFiles;
let artifacts: ArtifactStore;
const GLOBAL = "work://home";
const context = {sessionId: "s-1", profile: "p"} as ToolSessionContext;

beforeEach(async () => {
    root = await createTestTmpRoot("nb-harness-kit", "tools-search");
    home = join(root, "work", "home");
    await mkdir(home, {recursive: true});
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

type Result = ToolResult & {readonly details?: {readonly more?: boolean; readonly matches?: number; readonly filesChecked?: number}};

async function call(tool: KitToolImplementation, args: Readonly<Record<string, unknown>>, using: SessionFiles = files): Promise<Result> {
    const result = await tool.create(context, {files: using, artifacts}).execute(args, {callId: "c-1", signal: new AbortController().signal} as unknown as ToolContext);
    return (typeof result === "string" ? {text: result} : result) as Result;
}

describe("grep 与 glob", () => {
    test("输出 14：结果是全局地址，带行号与上下文，隐藏文件也搜；没有匹配；glob 列文件；缺省根是布局的工作目录", async () => {
        await mkdir(join(home, "子"));
        await writeFile(join(home, "子/a.md"), "前\n林舟走进雨里\n后\n");
        await writeFile(join(home, ".隐藏.md"), "林舟\n");
        const found = await call(grepTool, {pattern: "林舟", context: 1});
        expect(found.status).toBeUndefined();
        expect(found.text).toContain(`${GLOBAL}/子/a.md`);
        expect(found.text).toContain("2:林舟走进雨里");
        expect(found.text).toContain("1-前");
        expect(found.text).toContain(`${GLOBAL}/.隐藏.md`);
        expect((await call(grepTool, {pattern: "没有这个词"})).text).toBe("没有匹配");
        expect((await call(globTool, {pattern: "**/*.md"})).text).toContain(`${GLOBAL}/子/a.md`);
    });

    test("输出 14：搜索根可以是链接；根下面的目录链接不进", async () => {
        const library = join(root, "work", "资料库");
        await mkdir(library);
        await writeFile(join(library, "人物.md"), "林舟的设定\n");
        await symlink(library, join(home, "资料"));
        expect((await call(grepTool, {pattern: "林舟的设定", path: "home://资料"})).text).toContain(`${GLOBAL}/资料/人物.md`);
        await mkdir(join(home, "书"));
        await symlink(library, join(home, "书", "链接"));
        expect((await call(grepTool, {pattern: "林舟的设定", path: "home://书"})).text).toBe("没有匹配");
    });

    test("输出 14：取不到本机路径的根（虚拟根）报错；宿主不露出的文件不出现、也占不掉配额", async () => {
        await mkdir(join(home, "hidden"));
        await mkdir(join(home, "real"));
        await Promise.all(Array.from({length: 50}, (_, index) => writeFile(join(home, "hidden", `${String(index)}.md`), "hidden-word\n")));
        await writeFile(join(home, "real/a.md"), "hidden-word\n");
        const guarded: SessionFiles = {...files, readPath: async (address, options) => {
            if (address === "things://") return {ok: false, code: "unsupported-capability", detail: "虚拟根"};
            if (address.includes("/hidden/")) return {ok: false, code: "protected-path", detail: "不露出"};
            return files.readPath(address, options);
        }};
        expect(await call(grepTool, {pattern: "x", path: "things://"}, guarded)).toMatchObject({code: "unsupported-capability"});
        const filtered = await call(grepTool, {pattern: "hidden-word", glob: "*.md", limit: 1}, guarded);
        expect(filtered.text).toContain("real/a.md");
        expect(filtered.text).not.toContain("/hidden/");
        expect(filtered.text).not.toContain("还有更多");
        expect((await call(globTool, {pattern: "**/*.md"}, guarded)).text).not.toContain("/hidden/");
    });

    test("输出 14、17：够了配额就停下；limit + 1 判截断；长行与总字节有上限；不合法的模式不报错；glob 的 limit", async () => {
        await mkdir(join(home, "many"));
        await Promise.all(Array.from({length: 1500}, (_, index) => writeFile(join(home, "many", `${String(index)}.md`), "needle\n")));
        const few = await call(grepTool, {pattern: "needle", path: `${GLOBAL}/many`, limit: 3});
        expect(few.details).toMatchObject({matches: 3, more: true});
        expect(few.details!.filesChecked).toBeLessThan(1500);
        expect(few.text).toContain("还有更多");

        await writeFile(join(home, "long.md"), `start${"长".repeat(3000)}\n`);
        const clipped = await call(grepTool, {pattern: "start", path: "home://long.md"});
        expect(clipped.text).toContain("已截断");
        expect(clipped.text.length).toBeLessThan(1_000);
        await Promise.all(Array.from({length: 300}, (_, index) => writeFile(join(home, "many", `w${String(index)}.md`), `wide${"宽".repeat(400)}\n`)));
        const wide = await call(grepTool, {pattern: "wide", path: `${GLOBAL}/many`, limit: 500});
        expect(Buffer.byteLength(wide.text, "utf8")).toBeLessThan(55 * 1024);
        expect(wide.text).toContain("超过 50 KB");

        await writeFile(join(home, "括号.md"), "一个 [ 括号\n");
        expect((await call(grepTool, {pattern: "[", path: "home://括号.md"})).status).toBeUndefined();

        const globbed = await call(globTool, {pattern: "*.md", path: `${GLOBAL}/many`, limit: 5});
        expect(globbed.text).toContain("还有更多");
        expect(globbed.text.split("\n").filter((line) => line.startsWith("work://"))).toHaveLength(5);
    });

    test("输出 17：到期限时 grep 标“不完整”、glob 报 timeout，与“没有匹配”分开；工具取消是 cancelled；期限管整次调用", async () => {
        await mkdir(join(home, "many"));
        await Promise.all(Array.from({length: 2000}, (_, index) => writeFile(join(home, "many", `${String(index)}.md`), "needle\n")));
        const live = new AbortController();
        const grepped = await runGrep(files, {pattern: "needle", path: `${GLOBAL}/many`, limit: 500}, live.signal, 0);
        expect(grepped.text).toContain("不完整");
        expect(grepped.text).not.toBe("没有匹配");
        expect(await runGlob(files, {pattern: "**/*", path: `${GLOBAL}/many`}, live.signal, 0)).toMatchObject({code: "timeout"});
        live.abort();
        expect(await runGrep(files, {pattern: "needle", path: `${GLOBAL}/many`}, live.signal)).toMatchObject({code: "cancelled"});
        expect(await runGlob(files, {pattern: "**/*", path: `${GLOBAL}/many`}, live.signal)).toMatchObject({code: "cancelled"});

        // 原生搜索已经把匹配交出来、核对还没做完时到期，也不再继续核对。
        const checked: string[] = [];
        const slow: SessionFiles = {...files, readPath: async (address, options) => {
            if (address.includes("/many/")) {
                checked.push(address);
                // 核对一直不完成，直到期限信号触发：到期之后还继续核对的话，`checked` 会一路涨。
                await new Promise<void>((resolve) => {
                    options?.signal?.addEventListener("abort", () => resolve(), {once: true});
                });
            }
            return files.readPath(address, options);
        }};
        const started = Date.now();
        const clippedByDeadline = await runGrep(slow, {pattern: "needle", path: `${GLOBAL}/many`, limit: 500}, new AbortController().signal, 150);
        expect(clippedByDeadline.text).toContain("不完整");
        expect(checked.length).toBeLessThan(5);
        expect(Date.now() - started).toBeLessThan(5_000);
    });
});
