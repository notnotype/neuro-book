/**
 * 项目身份与登记表：真实临时目录上的登记、移动、副本、目录校验与坏掉的文件。
 * 行为合同见 docs/specs/runtime/projects.md 场景 1。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {chmod, cp, mkdir, readFile, rename, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {PROJECT_IDENTITY_FILE, readProjectIdentity} from "./identity";
import {createProjectRegistry, PROJECT_REGISTRY_FILE, shortNameBase} from "./registry";
import type {ProjectRegistry} from "./registry";

let tmp = "";
let counter = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-projects", "project-registry");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 每个用例一个独立的工作区：状态根与若干项目目录。 */
async function workspace(): Promise<{readonly root: string; readonly stateRoot: string; readonly registry: ProjectRegistry; dir(name: string): Promise<string>}> {
    counter += 1;
    const root = join(tmp, `case-${String(counter)}`);
    const stateRoot = join(root, "state");
    await mkdir(root, {recursive: true});
    return {
        root,
        stateRoot,
        registry: createProjectRegistry({stateRoot, cwd: root}),
        dir: async (name) => {
            const path = join(root, name);
            await mkdir(path, {recursive: true});
            return path;
        },
    };
}

function registered<T extends {readonly ok: boolean}>(result: T): Extract<T, {ok: true}> {
    if (!result.ok) throw new Error(`期望成功，得到 ${JSON.stringify(result)}`);
    return result as Extract<T, {ok: true}>;
}

describe("Spec projects 输出 1：登记", () => {
    it("登记生成身份文件与短名，登记表多一项；同一目录再登记返回同一项、不改动", async () => {
        const w = await workspace();
        const path = await w.dir("My Novel");

        const first = registered(await w.registry.register(path)).project;
        expect(first).toEqual({id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: "my-novel", path});
        expect(await readProjectIdentity(path)).toEqual({status: "found", id: first.id});
        expect(await w.registry.list()).toEqual({ok: true, value: [first]});

        const before = await readFile(join(w.stateRoot, PROJECT_REGISTRY_FILE), "utf8");
        expect(await w.registry.register(path)).toEqual({ok: true, project: first});
        expect(await readFile(join(w.stateRoot, PROJECT_REGISTRY_FILE), "utf8")).toBe(before);
    });

    it("相对路径按工作目录解析，符号链接登记为真实路径", async () => {
        const w = await workspace();
        const real = await w.dir("real-book");
        await symlink(real, join(w.root, "linked-book"));

        expect(registered(await w.registry.register("real-book")).project.path).toBe(real);
        expect(registered(await w.registry.register(join(w.root, "linked-book"))).project).toMatchObject({path: real, name: "real-book"});
    });

    it("短名：小写、非字母数字换成 -、为空用 project；重名依次加 -2、-3，登记后不变", async () => {
        expect(shortNameBase("/x/My Novel!!")).toBe("my-novel");
        expect(shortNameBase("/x/--A__b--")).toBe("a-b");
        expect(shortNameBase("/x/我的小说")).toBe("project");

        const w = await workspace();
        const names = [];
        for (const parent of ["a", "b", "c"]) {
            await mkdir(join(w.root, parent), {recursive: true});
            names.push(registered(await w.registry.register(await w.dir(join(parent, "Book")))).project.name);
        }
        expect(names).toEqual(["book", "book-2", "book-3"]);
    });

    it("并发登记按先后串行：同名目录得到不同短名，两项都写进登记表", async () => {
        const w = await workspace();
        const [left, right] = await Promise.all([w.dir(join("x", "Book")), w.dir(join("y", "Book"))]);
        const results = await Promise.all([w.registry.register(left), w.registry.register(right)]);

        expect(results.map((result) => registered(result).project.name).sort()).toEqual(["book", "book-2"]);
        const listed = await w.registry.list();
        expect(listed.ok && listed.value.map((project) => project.path).sort()).toEqual([left, right].sort());
    });

    it("目录移动后再登记：id 与短名不变，路径更新", async () => {
        const w = await workspace();
        const first = registered(await w.registry.register(await w.dir("draft"))).project;
        const moved = join(w.root, "renamed");
        await rename(first.path, moved);

        expect(await w.registry.register(moved)).toEqual({ok: true, project: {id: first.id, name: "draft", path: moved}});
        expect(await w.registry.list()).toEqual({ok: true, value: [{id: first.id, name: "draft", path: moved}]});
    });

    it("复制出来的目录（原路径下仍是同一个 id）：identity-conflict，登记表不变", async () => {
        const w = await workspace();
        const first = registered(await w.registry.register(await w.dir("original"))).project;
        const copy = join(w.root, "copy");
        await cp(first.path, copy, {recursive: true});

        expect(await w.registry.register(copy)).toMatchObject({ok: false, reason: "identity-conflict"});
        expect(await w.registry.list()).toEqual({ok: true, value: [first]});
    });

    it("已登记的目录丢了身份文件：按登记表里的 id 重建；身份文件被换成别的 id：identity-conflict", async () => {
        const w = await workspace();
        const first = registered(await w.registry.register(await w.dir("book"))).project;
        await rm(join(first.path, PROJECT_IDENTITY_FILE));

        expect(await w.registry.register(first.path)).toEqual({ok: true, project: first});
        expect(await readProjectIdentity(first.path)).toEqual({status: "found", id: first.id});

        await writeFile(join(first.path, PROJECT_IDENTITY_FILE), JSON.stringify({schema: 1, id: "00000000-0000-4000-8000-000000000000"}));
        expect(await w.registry.register(first.path)).toMatchObject({ok: false, reason: "identity-conflict"});
    });

    it("目录校验：不存在、不是目录、不可读写、在状态根之内各得对应原因，不创建身份文件", async () => {
        const w = await workspace();
        await writeFile(join(w.root, "file.txt"), "x");
        const locked = await w.dir("locked");
        await chmod(locked, 0o500);
        await mkdir(join(w.stateRoot, "inner"), {recursive: true});
        try {
            expect(await w.registry.register(join(w.root, "missing"))).toMatchObject({ok: false, reason: "invalid-path"});
            expect(await w.registry.register("")).toMatchObject({ok: false, reason: "invalid-path"});
            expect(await w.registry.register(join(w.root, "file.txt"))).toMatchObject({ok: false, reason: "not-directory"});
            expect(await w.registry.register(locked)).toMatchObject({ok: false, reason: "not-accessible"});
            expect(await w.registry.register(w.stateRoot)).toMatchObject({ok: false, reason: "inside-state-root"});
            expect(await w.registry.register(join(w.stateRoot, "inner"))).toMatchObject({ok: false, reason: "inside-state-root"});
        } finally {
            await chmod(locked, 0o700);
        }
        expect(await readProjectIdentity(join(w.stateRoot, "inner"))).toEqual({status: "missing"});
        expect(await w.registry.list()).toEqual({ok: true, value: []});
    });

    it("身份文件存在但无法解析或结构不符：identity-invalid，不改写它", async () => {
        const w = await workspace();
        for (const [name, content] of [["broken-json", "{"], ["wrong-shape", JSON.stringify({schema: 2, id: "x"})]] as const) {
            const path = await w.dir(name);
            await mkdir(join(path, ".nbook"));
            await writeFile(join(path, PROJECT_IDENTITY_FILE), content);

            expect(await w.registry.register(path)).toMatchObject({ok: false, reason: "identity-invalid"});
            expect(await readFile(join(path, PROJECT_IDENTITY_FILE), "utf8")).toBe(content);
        }
    });
});

describe("Spec projects 输出 2 与失败：解析与坏掉的登记表", () => {
    it("按 id 或短名解析，先比 id；没有为 null", async () => {
        const w = await workspace();
        const book = registered(await w.registry.register(await w.dir("book"))).project;

        expect(await w.registry.resolve(book.id)).toEqual({ok: true, value: book});
        expect(await w.registry.resolve("book")).toEqual({ok: true, value: book});
        expect(await w.registry.resolve("nope")).toEqual({ok: true, value: null});
    });

    it("登记表无法解析：列出、解析、登记都是 registry-invalid，不覆盖它、不碰项目目录；修好后恢复", async () => {
        const w = await workspace();
        const path = await w.dir("book");
        await mkdir(w.stateRoot, {recursive: true});
        const file = join(w.stateRoot, PROJECT_REGISTRY_FILE);
        await writeFile(file, "{not json");

        expect(await w.registry.list()).toMatchObject({ok: false, reason: "registry-invalid"});
        expect(await w.registry.resolve("book")).toMatchObject({ok: false, reason: "registry-invalid"});
        expect(await w.registry.register(path)).toMatchObject({ok: false, reason: "registry-invalid"});
        expect(await readFile(file, "utf8")).toBe("{not json");
        expect(await readProjectIdentity(path)).toEqual({status: "missing"});

        await writeFile(file, JSON.stringify({schema: 1, projects: [{id: "x"}]}));
        expect(await w.registry.list()).toMatchObject({ok: false, reason: "registry-invalid"});

        await rm(file);
        expect(registered(await w.registry.register(path)).project.name).toBe("book");
    });
});
