/**
 * 身份文件里的作品信息：读取时坏字段降级，修改经加锁替换只改给出的字段。真实临时目录；两个写者是两个真实 Bun 子进程
 * （`testing/identity-child.ts`），按行放行，不按时间等待。
 * 行为合同见 docs/specs/runtime/projects.md 输出第 13 条与场景 13。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {chmod, lstat, mkdir, readFile, readlink, rm, stat, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {PROJECT_IDENTITY_FILE, readProjectIdentity, updateProjectMetadata} from "./identity";

const CHILD = join(import.meta.dir, "testing", "identity-child.ts");
const ID = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const OTHER_ID = "00000000-0000-4000-8000-000000000000";

let tmp = "";
let counter = 0;
const children: Array<ReturnType<typeof Bun.spawn>> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-projects", "project-identity");
});

afterEach(() => {
    for (const child of children.splice(0)) child.kill("SIGKILL");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 一个带身份文件的项目目录；`record` 是身份文件的全部内容。 */
async function project(record: Record<string, unknown> = {schema: 1, id: ID}): Promise<string> {
    counter += 1;
    const path = join(tmp, `case-${String(counter)}`);
    await mkdir(join(path, ".nbook"), {recursive: true});
    await writeFile(join(path, PROJECT_IDENTITY_FILE), JSON.stringify(record));
    return path;
}

async function fileRecord(path: string): Promise<unknown> {
    return JSON.parse(await readFile(join(path, PROJECT_IDENTITY_FILE), "utf8"));
}

const reports: Array<{event: string; error: unknown}> = [];
const options = {report: (event: string, error: unknown) => void reports.push({event, error})};

/** 起一个改身份文件的子进程：等它加载完（`ready`），返回放行函数与结果。 */
function spawnUpdater(path: string, patch: Record<string, unknown>): {readonly ready: Promise<void>; go(): void; readonly result: Promise<unknown>} {
    const child = Bun.spawn([process.execPath, CHILD, "update", path, ID, JSON.stringify(patch)], {stdin: "pipe", stdout: "pipe", stderr: "inherit", cwd: join(import.meta.dir, "..", "..", "..")});
    children.push(child);
    const lines = (async function* () {
        const decoder = new TextDecoder();
        let buffer = "";
        for await (const chunk of child.stdout) {
            buffer += decoder.decode(chunk, {stream: true});
            for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
                yield buffer.slice(0, index);
                buffer = buffer.slice(index + 1);
            }
        }
    })();
    const next = async (): Promise<string> => {
        const line = await lines.next();
        if (line.done === true) throw new Error(`子进程没有更多输出，退出码 ${String(await child.exited)}`);
        return line.value;
    };
    const ready = next().then((line) => expect(line).toBe("ready"));
    return {
        ready,
        go: () => {
            void child.stdin.write("go\n");
            void child.stdin.end();
        },
        result: ready.then(next).then((line) => JSON.parse(line)),
    };
}

describe("Spec projects 输出 13：读作品信息", () => {
    it("合规的书名、简介与主题色读出来（书名去掉首尾空白）；没有的字段为 null", async () => {
        const path = await project({schema: 1, id: ID, title: "  长夜  ", color: "#a1b2c3"});
        expect(await readProjectIdentity(path)).toEqual({status: "found", id: ID, metadata: {title: "长夜", description: null, color: "#a1b2c3"}, problems: []});
    });

    it("不合规的字段当作没有并列出原因，身份照常可用", async () => {
        const path = await project({schema: 1, id: ID, title: "   ", description: 42, color: "#ABCDEF"});
        expect(await readProjectIdentity(path)).toEqual({
            status: "found",
            id: ID,
            metadata: {title: null, description: null, color: null},
            problems: [{field: "title", detail: expect.any(String)}, {field: "description", detail: expect.any(String)}, {field: "color", detail: expect.any(String)}],
        });
        const long = await project({schema: 1, id: ID, title: "书".repeat(81), description: "字".repeat(501)});
        expect(await readProjectIdentity(long)).toMatchObject({status: "found", metadata: {title: null, description: null}, problems: [{field: "title"}, {field: "description"}]});
        // 上限按字符数而不是 UTF-16 码元：80 个表情的书名合规。
        const emoji = await project({schema: 1, id: ID, title: "📚".repeat(80)});
        expect(await readProjectIdentity(emoji)).toMatchObject({metadata: {title: "📚".repeat(80)}, problems: []});
    });
});

describe("Spec projects 输出 13：修改作品信息", () => {
    it("改书名、简介与主题色后读回；null 清除、省略不动；id、schema 与不认识的字段保留", async () => {
        const path = await project({schema: 1, id: ID, title: "旧名", extra: {keep: [1, 2]}, note: "用户自己写的"});

        expect(await updateProjectMetadata(path, ID, {title: " 新名 ", description: "一段简介", color: "#336699"}, options)).toEqual({ok: true, metadata: {title: "新名", description: "一段简介", color: "#336699"}});
        expect(await readProjectIdentity(path)).toMatchObject({status: "found", id: ID, metadata: {title: "新名", description: "一段简介", color: "#336699"}});

        expect(await updateProjectMetadata(path, ID, {description: null}, options)).toEqual({ok: true, metadata: {title: "新名", description: null, color: "#336699"}});
        expect(await fileRecord(path)).toEqual({schema: 1, id: ID, title: "新名", extra: {keep: [1, 2]}, note: "用户自己写的", color: "#336699"});
    });

    it("不合规的修改为 invalid-metadata 并带字段名，文件不变", async () => {
        const path = await project({schema: 1, id: ID, title: "原名"});
        const before = await readFile(join(path, PROJECT_IDENTITY_FILE), "utf8");

        expect(await updateProjectMetadata(path, ID, {title: " \t "}, options)).toMatchObject({ok: false, reason: "invalid-metadata", field: "title"});
        expect(await updateProjectMetadata(path, ID, {title: "好", description: "字".repeat(501)}, options)).toMatchObject({ok: false, reason: "invalid-metadata", field: "description"});
        expect(await updateProjectMetadata(path, ID, {color: "#ABCDEF"}, options)).toMatchObject({ok: false, reason: "invalid-metadata", field: "color"});
        expect(await readFile(join(path, PROJECT_IDENTITY_FILE), "utf8")).toBe(before);
    });

    it("文件里的 id 与登记表不一致：identity-conflict；身份文件坏了或不在：identity-invalid；都不改写", async () => {
        const path = await project({schema: 1, id: OTHER_ID});
        expect(await updateProjectMetadata(path, ID, {title: "名"}, options)).toMatchObject({ok: false, reason: "identity-conflict"});
        expect(await fileRecord(path)).toEqual({schema: 1, id: OTHER_ID});

        await writeFile(join(path, PROJECT_IDENTITY_FILE), "{");
        expect(await updateProjectMetadata(path, ID, {title: "名"}, options)).toMatchObject({ok: false, reason: "identity-invalid"});
        expect(await readFile(join(path, PROJECT_IDENTITY_FILE), "utf8")).toBe("{");

        await rm(join(path, PROJECT_IDENTITY_FILE));
        expect(await updateProjectMetadata(path, ID, {title: "名"}, options)).toMatchObject({ok: false, reason: "identity-invalid"});
    });

    it("身份文件只读：read-only，不改；权限位随替换保留", async () => {
        const path = await project();
        const file = join(path, PROJECT_IDENTITY_FILE);
        await chmod(file, 0o444);
        try {
            expect(await updateProjectMetadata(path, ID, {title: "名"}, options)).toMatchObject({ok: false, reason: "read-only"});
            expect(await fileRecord(path)).toEqual({schema: 1, id: ID});
        } finally {
            await chmod(file, 0o640);
        }
        expect(await updateProjectMetadata(path, ID, {title: "名"}, options)).toMatchObject({ok: true});
        expect((await stat(file)).mode & 0o777).toBe(0o640);
    });

    it("身份文件是符号链接：改的是最终目标，链接仍在；悬空链接为 identity-invalid", async () => {
        const path = await project();
        const target = join(path, "real-identity.json");
        await writeFile(target, JSON.stringify({schema: 1, id: ID}));
        await rm(join(path, PROJECT_IDENTITY_FILE));
        await symlink(target, join(path, PROJECT_IDENTITY_FILE));

        expect(await updateProjectMetadata(path, ID, {title: "经链接"}, options)).toMatchObject({ok: true, metadata: {title: "经链接"}});
        expect((await lstat(join(path, PROJECT_IDENTITY_FILE))).isSymbolicLink()).toBe(true);
        expect(await readlink(join(path, PROJECT_IDENTITY_FILE))).toBe(target);
        expect(JSON.parse(await readFile(target, "utf8"))).toEqual({schema: 1, id: ID, title: "经链接"});

        await rm(target);
        expect(await updateProjectMetadata(path, ID, {title: "名"}, options)).toMatchObject({ok: false, reason: "identity-invalid"});
        expect((await lstat(join(path, PROJECT_IDENTITY_FILE))).isSymbolicLink()).toBe(true);
    });

    it("两个真实子进程同时改不同字段：两个字段都在", async () => {
        const path = await project({schema: 1, id: ID, note: "保留"});
        const titleWriter = spawnUpdater(path, {title: "甲改的书名"});
        const colorWriter = spawnUpdater(path, {color: "#123456"});
        await Promise.all([titleWriter.ready, colorWriter.ready]);
        titleWriter.go();
        colorWriter.go();

        expect(await Promise.all([titleWriter.result, colorWriter.result])).toEqual([{ok: true, metadata: expect.objectContaining({title: "甲改的书名"})}, {ok: true, metadata: expect.objectContaining({color: "#123456"})}]);
        expect(await fileRecord(path)).toEqual({schema: 1, id: ID, note: "保留", title: "甲改的书名", color: "#123456"});
    });
});
