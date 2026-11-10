/**
 * 内核资源接口的适配（docs/specs/agent/resources.md 输出 9）：`resolve` 交回全局地址、改写不了的原样交回；`read` 只在不存在时
 * 为空，别的失败带码抛出，不当作不存在。用本机参考实现作真实依赖（它过了 `SessionFiles` 的合同）。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {kernelResources, ResourceReadError} from "./index.js";
import {localFiles} from "./local.js";

let root = "";
let kernel: ReturnType<typeof kernelResources>;

beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness-kit", "kernel-resources");
    await mkdir(join(root, "home", "dir"), {recursive: true});
    await writeFile(join(root, "home", "note.md"), "笔记");
    await writeFile(join(root, "home", "binary.bin"), new Uint8Array([0x66, 0x00, 0x67]));
    const {files} = localFiles({
        roots: {work: root},
        aliases: {home: "work://home"},
        layout: {working: "home://", scratch: [], localWrites: [], shellEnv: {}, searchExcludes: () => []},
        classify: () => "allowed",
        artifacts: "work://artifacts",
    });
    kernel = kernelResources(files);
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

describe("内核的资源接口", () => {
    it("resolve 交回全局地址，改写不了的原样交回", () => {
        expect(kernel.resolve("home://note.md")).toBe("work://home/note.md");
        expect(kernel.resolve("work://home/note.md")).toBe("work://home/note.md");
        expect(kernel.resolve("home://../x")).toBe("home://../x");
    });

    it("read 读到文字；不存在为空", async () => {
        expect(await kernel.read("home://note.md")).toBe("笔记");
        expect(await kernel.read("home://missing.md")).toBeUndefined();
    });

    it("read 的别的失败带码抛出：不是文字为 not-text，目录为 not-a-file，方案没登记为 unknown-scheme", async () => {
        const codeOf = (error: unknown): string | null => (error instanceof ResourceReadError ? error.code : null);
        expect(codeOf(await kernel.read("home://binary.bin").catch((error: unknown) => error))).toBe("not-text");
        expect(codeOf(await kernel.read("home://dir").catch((error: unknown) => error))).toBe("not-a-file");
        expect(codeOf(await kernel.read("nope://x").catch((error: unknown) => error))).toBe("unknown-scheme");
    });
});
