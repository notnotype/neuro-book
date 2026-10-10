import {afterAll, describe, expect, test} from "bun:test";
import {mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createLocalFileAccess} from "./local";

const roots: string[] = [];
afterAll(async () => {
    for (const root of roots) await rm(root, {recursive: true, force: true});
});

async function newRoot(): Promise<{base: string; root: string}> {
    const base = await createTestTmpRoot("nb-harness-builtin", "local");
    roots.push(base);
    const root = join(base, "root");
    await mkdir(root, {recursive: true});
    return {base, root};
}

const code = (result: {ok: boolean; code?: string}): string | null => (result.ok ? null : (result.code as string));

describe("本地文件访问（输出 1）", () => {
    test("场景 1：根内读写列删；../、绝对路径、指向根外的符号链接都是 outside-root；不存在为 not-found；目录当文件读为 not-a-file", async () => {
        const {base, root} = await newRoot();
        await writeFile(join(base, "secret.txt"), "外面的", "utf8");
        await mkdir(join(root, "sub"));
        await writeFile(join(root, "sub", "b.txt"), "b", "utf8");
        await symlink(join(base, "secret.txt"), join(root, "leak.txt"));
        await symlink(base, join(root, "leakdir"));
        const access = createLocalFileAccess({root});
        expect(access.root).toBe(root);

        expect(await access.write("a.txt", "你好")).toEqual({ok: true, value: undefined});
        expect(await access.write("deep/er/c.txt", "c")).toEqual({ok: true, value: undefined});
        const read = await access.readBytes("a.txt");
        expect(read.ok && new TextDecoder().decode(read.value)).toBe("你好");
        expect(await access.stat("a.txt")).toEqual({ok: true, value: {kind: "file", bytes: 6}});
        expect(await access.stat("sub")).toMatchObject({ok: true, value: {kind: "directory"}});
        const listed = await access.list(".");
        expect(listed.ok && listed.value).toEqual([
            {name: "a.txt", kind: "file"}, {name: "deep", kind: "directory"}, {name: "leak.txt", kind: "file"}, {name: "leakdir", kind: "directory"}, {name: "sub", kind: "directory"},
        ]);
        expect(await access.remove("a.txt")).toEqual({ok: true, value: undefined});
        expect(code(await access.stat("a.txt"))).toBe("not-found");

        for (const bad of ["../secret.txt", join(base, "secret.txt"), "sub/../../secret.txt", "", "a\0b"]) expect(code(access.resolve(bad))).toBe("outside-root");
        expect(code(await access.readBytes("leak.txt"))).toBe("outside-root");
        expect(code(await access.list("leakdir"))).toBe("outside-root");
        expect(code(await access.write("leakdir/new.txt", "x"))).toBe("outside-root");
        expect(code(await access.readBytes("nope.txt"))).toBe("not-found");
        expect(code(await access.readBytes("sub"))).toBe("not-a-file");
        expect(code(await access.list("sub/b.txt"))).toBe("not-a-directory");
        expect(code(await access.remove("sub"))).toBe("not-a-file");
        expect(() => createLocalFileAccess({root: "relative"})).toThrow(TypeError);
    });
});
