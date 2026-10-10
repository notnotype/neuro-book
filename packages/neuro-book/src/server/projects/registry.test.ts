/**
 * 项目身份与登记表：真实临时目录上的登记、移动、副本、目录校验与坏掉的文件；新建作品与移出书架。新建时身份文件写不进去
 * 的情形由真实子进程在受限的 umask 下制造（`testing/identity-child.ts`）。
 * 行为合同见 docs/specs/runtime/projects.md 场景 1、14、15。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {chmod, cp, mkdir, readdir, readFile, rename, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {FALLBACK_DIRECTORY_NAME, PROJECT_IDENTITY_FILE, projectDirectoryName, readProjectIdentity} from "./identity";
import {createProjectRegistry, PROJECT_REGISTRY_FILE, shortNameBase} from "./registry";
import type {ProjectRegistry} from "./registry";

const CHILD = join(import.meta.dir, "testing", "identity-child.ts");

let tmp = "";
let counter = 0;

/** 登记时新建的身份文件只有 schema 与 id：作品信息三项都没有。 */
const NO_METADATA = {metadata: {title: null, description: null, color: null}, problems: []};

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
        expect(await readProjectIdentity(path)).toEqual({status: "found", id: first.id, ...NO_METADATA});
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
        expect(await readProjectIdentity(first.path)).toEqual({status: "found", id: first.id, ...NO_METADATA});

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
        // 三个字段都是字符串、只有 id 不是 UUID：同样整表无效，不带出一个永远打不开的项目。
        await writeFile(file, JSON.stringify({schema: 1, projects: [{id: "not-a-uuid", name: "book", path}]}));
        expect(await w.registry.resolve("book")).toMatchObject({ok: false, reason: "registry-invalid"});

        await rm(file);
        expect(registered(await w.registry.register(path)).project.name).toBe("book");
    });
});

describe("Spec projects 输出 14：新建作品", () => {
    it("目录名由书名生成：不安全的字符换成 -，去掉首尾空白与句点，至多 80 个字符；生成不出时用“作品”", () => {
        expect(projectDirectoryName('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
        expect(projectDirectoryName("第一卷\t\u0007终")).toBe("第一卷--终");
        expect(projectDirectoryName("  ..长夜.  ")).toBe("长夜");
        expect(projectDirectoryName(`${"书".repeat(79)} 尾巴`)).toBe("书".repeat(79));
        expect(Array.from(projectDirectoryName("📚".repeat(90))).length).toBe(80);
        for (const title of ["...", " . ", "CON", "con.txt", "Nul", "COM1", "lpt9.md"]) expect(projectDirectoryName(title)).toBe(FALLBACK_DIRECTORY_NAME);
        expect(projectDirectoryName("CONsole")).toBe("CONsole");
    });

    it("建目录、写身份文件（书名与简介）并登记；同名目录已存在为 exists，不碰它", async () => {
        const w = await workspace();
        const parent = await w.dir("library");

        const created = await w.registry.create({title: " My Novel ", description: "简介", parent});
        expect(created).toEqual({ok: true, project: {id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: "my-novel", path: join(parent, "My Novel")}});
        const project = registered(created).project;
        expect(await readProjectIdentity(project.path)).toEqual({status: "found", id: project.id, metadata: {title: "My Novel", description: "简介", color: null}, problems: []});
        expect(await w.registry.list()).toEqual({ok: true, value: [project]});

        await writeFile(join(project.path, "chapter.md"), "正文");
        expect(await w.registry.create({title: "My Novel", parent})).toEqual({ok: false, reason: "exists", path: project.path, detail: expect.any(String)});
        expect(await readdir(project.path)).toEqual(expect.arrayContaining(["chapter.md", ".nbook"]));
        expect(await w.registry.list()).toEqual({ok: true, value: [project]});
    });

    it("书名不合规为 invalid-metadata；父目录不过目录校验为 invalid-parent（带原因）；都不建目录", async () => {
        const w = await workspace();
        const parent = await w.dir("library");
        expect(await w.registry.create({title: "  ", parent})).toMatchObject({ok: false, reason: "invalid-metadata", field: "title"});
        expect(await w.registry.create({title: "书", description: "字".repeat(501), parent})).toMatchObject({ok: false, reason: "invalid-metadata", field: "description"});
        expect(await w.registry.create({title: "书", parent: join(w.root, "missing")})).toMatchObject({ok: false, reason: "invalid-parent", cause: "invalid-path"});
        await mkdir(w.stateRoot, {recursive: true});
        expect(await w.registry.create({title: "书", parent: w.stateRoot})).toMatchObject({ok: false, reason: "invalid-parent", cause: "inside-state-root"});
        expect(await readdir(parent)).toEqual([]);
        expect(await w.registry.list()).toEqual({ok: true, value: []});
    });

    it("身份文件写不进去（子进程的 umask 277 让新建的目录不可写）：write-failed，新建的目录被删掉，登记表不变", async () => {
        const w = await workspace();
        const parent = await w.dir("library");
        const child = Bun.spawn([process.execPath, CHILD, "create", w.stateRoot, w.root, JSON.stringify({title: "写不进", parent}), "277"], {stdout: "pipe", stderr: "inherit", cwd: join(import.meta.dir, "..", "..", "..")});
        const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
        expect(code).toBe(0);

        expect(JSON.parse(output)).toMatchObject({ok: false, reason: "write-failed", detail: expect.stringContaining("已删掉新建的目录")});
        expect(await readdir(parent)).toEqual([]);
        expect(await w.registry.list()).toEqual({ok: true, value: []});
    });

    it("登记失败：目录与身份文件保留，register-failed 带路径；修好登记表后再登记该目录按幂等规则完成", async () => {
        const w = await workspace();
        const parent = await w.dir("library");
        await mkdir(w.stateRoot, {recursive: true});
        await writeFile(join(w.stateRoot, PROJECT_REGISTRY_FILE), "{broken");

        const failed = await w.registry.create({title: "半成品", parent});
        const path = join(parent, "半成品");
        expect(failed).toEqual({ok: false, reason: "register-failed", cause: "registry-invalid", path, detail: expect.any(String)});
        const identity = await readProjectIdentity(path);
        expect(identity).toMatchObject({status: "found", metadata: {title: "半成品"}});

        await rm(join(w.stateRoot, PROJECT_REGISTRY_FILE));
        expect(await w.registry.register(path)).toEqual({ok: true, project: {id: identity.status === "found" ? identity.id : "", name: "project", path}});
    });
});

describe("Spec projects 输出 15：移出书架（登记表）", () => {
    it("只去掉登记项，目录与身份文件不动；再登记该目录得到同一 id 与新的短名登记", async () => {
        const w = await workspace();
        const book = registered(await w.registry.register(await w.dir("Book"))).project;
        const other = registered(await w.registry.register(await w.dir("Other"))).project;

        expect(await w.registry.unregister(book.id)).toEqual({ok: true, project: book});
        expect(await w.registry.list()).toEqual({ok: true, value: [other]});
        expect(await readProjectIdentity(book.path)).toMatchObject({status: "found", id: book.id});

        expect(await w.registry.register(book.path)).toEqual({ok: true, project: {id: book.id, name: "book", path: book.path}});
        expect(await w.registry.list()).toEqual({ok: true, value: [other, book]});
    });

    it("没有这个 id：unknown-project；登记表坏了：registry-invalid，不覆盖它", async () => {
        const w = await workspace();
        registered(await w.registry.register(await w.dir("Book")));
        expect(await w.registry.unregister("00000000-0000-4000-8000-000000000000")).toMatchObject({ok: false, reason: "unknown-project"});

        await writeFile(join(w.stateRoot, PROJECT_REGISTRY_FILE), "{broken");
        expect(await w.registry.unregister("00000000-0000-4000-8000-000000000000")).toMatchObject({ok: false, reason: "registry-invalid"});
        expect(await readFile(join(w.stateRoot, PROJECT_REGISTRY_FILE), "utf8")).toBe("{broken");
    });
});
