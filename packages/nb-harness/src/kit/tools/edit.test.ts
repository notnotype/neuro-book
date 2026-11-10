/**
 * `write` 与 `edit` 自身的行为（docs/specs/agent/builtin-tools.md 输出 9、10、12、13；测试名里的编号是它的输出条目）：引擎的规则、
 * 不接受的写法、部分失败。文件访问用本机参考实现（过了 `SessionFiles` 的合同）；写入记在谁名下、地址方案的授权留在宿主的测试里。
 */

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {ToolContext, ToolResult, ToolSessionContext} from "../../kernel/contracts.js";
import type {ArtifactStore, SessionFiles} from "../files/index.js";
import {localFiles} from "../files/local.js";
import {hashlineTool, replaceTool} from "./edit.js";
import {readTool} from "./read.js";
import {SessionEditStores} from "./snapshot.js";
import type {KitToolImplementation} from "./types.js";
import {writeTool} from "./write.js";

let root = "";
let home = "";
let files: SessionFiles;
let artifacts: ArtifactStore;
let stores: SessionEditStores;
const GLOBAL = "work://home";
const context = {sessionId: "s-1", profile: "p"} as ToolSessionContext;

beforeEach(async () => {
    root = await createTestTmpRoot("nb-harness-kit", "tools-edit");
    home = join(root, "work", "home");
    await mkdir(home, {recursive: true});
    await mkdir(join(root, "work", "readonly"));
    stores = new SessionEditStores();
    ({files, artifacts} = localFiles({
        roots: {work: join(root, "work")},
        aliases: {home: GLOBAL},
        layout: {working: "home://", scratch: [], localWrites: [], shellEnv: {}, searchExcludes: () => []},
        classify: (address) => (address.startsWith("work://readonly") ? "denied" : "allowed"),
        artifacts: "work://artifacts",
    }));
});
afterEach(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

/** 每次调用都按会话建一次实现，与内核一样；快照按会话共用，所以 read 给的行锚 edit 认得。 */
async function call(tool: KitToolImplementation, args: Readonly<Record<string, unknown>>, using: SessionFiles = files): Promise<ToolResult> {
    const result = await tool.create(context, {files: using, artifacts}).execute(args, {callId: "c-1", signal: new AbortController().signal} as unknown as ToolContext);
    return typeof result === "string" ? {text: result} : result;
}
const read = (args: Readonly<Record<string, unknown>>) => call(readTool(stores), args);
const edit = (args: Readonly<Record<string, unknown>>, using?: SessionFiles) => call(hashlineTool(stores), args, using);
const replace = (args: Readonly<Record<string, unknown>>) => call(replaceTool(stores), args);
const write = (args: Readonly<Record<string, unknown>>) => call(writeTool(stores), args);

const headerTag = (text: string): string => /#([0-9A-F]{4})\]/u.exec(text)?.[1] ?? "";
const hashline = (address: string, tag: string, body: string) => `[${address}#${tag}]\n${body}\n`;

describe("write", () => {
    test("输出 9：新建并建上级目录，结果带全局地址与行锚；覆盖不核对基线；上级是文件、不许写的位置各得失败码", async () => {
        const created = await write({path: "home://新/目录/a.md", content: "一\n二\n"});
        expect(created.status).toBeUndefined();
        expect(created.text).toContain(`[${GLOBAL}/新/目录/a.md#`);
        expect(created.text).toContain("2 行");
        expect(await readFile(join(home, "新/目录/a.md"), "utf8")).toBe("一\n二\n");
        await writeFile(join(home, "新/目录/a.md"), "别人改过");
        expect((await write({path: "home://新/目录/a.md", content: "覆盖"})).status).toBeUndefined();
        expect(await readFile(join(home, "新/目录/a.md"), "utf8")).toBe("覆盖");
        await writeFile(join(home, "文件"), "x");
        expect(await write({path: "home://文件/下面.md", content: "x"})).toMatchObject({status: "error", code: "not-a-directory"});
        expect(await write({path: "work://readonly/x.md", content: "x"})).toMatchObject({status: "error", code: "permission-denied"});
    });
});

describe("edit", () => {
    test("hashline 改一行：结果是全局地址，单数写法也一样；写完可以接着改", async () => {
        await writeFile(join(home, "a.md"), "一\n二\n三\n");
        const done = await edit({input: hashline("home://a.md", headerTag((await read({path: "home://a.md"})).text), "PUT 2.=2:\n+贰")});
        expect(done.status).toBeUndefined();
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n贰\n三\n");
        expect(done.text).toContain(`[${GLOBAL}/a.md#`);
        expect(done.text).not.toContain("[home://");
        expect((await edit({input: hashline(`${GLOBAL}/a.md`, headerTag(done.text), "PUT 3.=3:\n+叁")})).status).toBeUndefined();
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n贰\n叁\n");
    });

    test("输出 12：没看过的行、写完 write 后直接改：引擎的规则；失败码 edit-<errorKind>", async () => {
        await writeFile(join(home, "a.md"), "一\n二\n三\n");
        const page = await read({path: "home://a.md", limit: 1});
        const unseen = await edit({input: hashline("home://a.md", headerTag(page.text), "PUT 3.=3:\n+叁")});
        expect(unseen.status).toBe("error");
        expect(unseen.code).toMatch(/^edit-/u);
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n二\n三\n");
        const written = await write({path: "home://b.md", content: "甲\n乙\n"});
        expect((await edit({input: hashline("home://b.md", headerTag(written.text), "PUT 2.=2:\n+丙")})).status).toBeUndefined();
        expect(await readFile(join(home, "b.md"), "utf8")).toBe("甲\n丙\n");
    });

    test("输出 5、12：截断的长行不算看过，只读到它时行锚也不放行编辑", async () => {
        const long = "长".repeat(2_500);
        await writeFile(join(home, "a.md"), `${long}\n二\n`);
        const page = await read({path: "home://a.md", limit: 1});
        expect(page.text).toContain("已截断");
        const refused = await edit({input: hashline("home://a.md", headerTag(page.text), "PUT 1.=1:\n+短")});
        expect(refused.status).toBe("error");
        expect(refused.code).toMatch(/^edit-/u);
        expect(await readFile(join(home, "a.md"), "utf8")).toBe(`${long}\n二\n`);
    });

    test("输出 10：裸路径、相对路径整次拒绝且不露内容；删除、移动整次拒绝；目标不存在提示用 write", async () => {
        await writeFile(join(home, "a.md"), "一\n");
        const tag = headerTag((await read({path: "home://a.md"})).text);
        const secret = join(root, "secret.md");
        await writeFile(secret, "机密内容\n");
        for (const path of [secret, "a.md", "../a.md"]) {
            const refused = await edit({input: hashline(path, "ABCD", "PUT 1.=1:\n+x")});
            expect(refused).toMatchObject({status: "error", code: "invalid-address"});
            expect(refused.text).not.toContain("机密内容");
        }
        expect(await readFile(secret, "utf8")).toBe("机密内容\n");
        expect(await edit({input: hashline("home://a.md", tag, "REM")})).toMatchObject({code: "unsupported-capability"});
        expect(await edit({input: hashline("home://a.md", tag, "MV home://b.md")})).toMatchObject({code: "unsupported-capability"});
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n");
        const missing = await edit({input: hashline("home://没有.md", "ABCD", "PUT 1.=1:\n+x")});
        expect(missing).toMatchObject({code: "not-found"});
        expect(missing.text).toContain("write");
    });

    test("replace：改写、结果是全局地址，old_string 找不到得 edit- 码，裸路径被拒", async () => {
        await writeFile(join(home, "a.md"), "林舟走进雨里\n");
        const done = await replace({path: "home://a.md", old_string: "雨里", new_string: "雪里"});
        expect(done.status).toBeUndefined();
        expect(done.text).not.toContain("home://");
        expect(done.text).toContain(GLOBAL);
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("林舟走进雪里\n");
        const miss = await replace({path: "home://a.md", old_string: "没有这句", new_string: "x"});
        expect(miss.status).toBe("error");
        expect(miss.code).toMatch(/^edit-/u);
        expect(await replace({path: "a.md", old_string: "x", new_string: "y"})).toMatchObject({code: "invalid-address"});
    });

    test("输出 11、13：第二个文件写回时被别人改过：第一个已写入、第二个 conflict 不覆盖，逐文件结果写进文字", async () => {
        await writeFile(join(home, "甲.md"), "甲一\n");
        await writeFile(join(home, "乙.md"), "乙一\n");
        const tagA = headerTag((await read({path: "home://甲.md"})).text);
        const tagB = headerTag((await read({path: "home://乙.md"})).text);
        // 第一个文件写完、第二个写回之前改掉第二个：它的基线已经读过，引擎也算好了。
        const meddling: SessionFiles = {...files, call: (call, info) => {
            const bound = files.call(call, info);
            return {...bound, write: async (address, content, options) => {
                const saved = await bound.write(address, content, options);
                if (address.endsWith("甲.md")) await writeFile(join(home, "乙.md"), "别人改的\n");
                return saved;
            }};
        }};
        const result = await edit({input: `${hashline("home://甲.md", tagA, "PUT 1.=1:\n+甲改")}${hashline("home://乙.md", tagB, "PUT 1.=1:\n+乙改")}`}, meddling);
        expect(result).toMatchObject({status: "error", code: "conflict"});
        expect(await readFile(join(home, "甲.md"), "utf8")).toBe("甲改\n");
        expect(await readFile(join(home, "乙.md"), "utf8")).toBe("别人改的\n");
        expect(result.text).toContain(`${GLOBAL}/甲.md：已写入`);
        expect(result.text).toContain(`${GLOBAL}/乙.md：失败（conflict）`);
    });
});
