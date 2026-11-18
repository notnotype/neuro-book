/**
 * 本机参考实现跑一遍 `SessionFiles` 的合同（docs/specs/harness/host-kit.md）：kit 自己的测试把它当真实依赖用，所以它先要过合同。
 */

import {describe, expect, test} from "bun:test";
import {mkdir, rm, truncate, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {sessionFilesContract} from "../testing/index.js";
import {localFiles} from "./local.js";

sessionFilesContract("本机参考实现", async () => {
    const root = await createTestTmpRoot("nb-harness-kit", "local-files");
    const work = join(root, "work");
    await mkdir(join(work, "home", "contract"), {recursive: true});
    await mkdir(join(work, "readonly"), {recursive: true});
    const {files, artifacts} = localFiles({
        roots: {work},
        aliases: {home: "work://home"},
        layout: {working: "home://", scratch: ["home://"], localWrites: ["home://"], shellEnv: {}, searchExcludes: () => []},
        classify: (address) => (address.startsWith("work://readonly") ? "denied" : "allowed"),
        artifacts: "work://artifacts",
    });
    return {
        files,
        artifacts,
        writable: "work://home/contract",
        singular: "home://contract",
        writablePath: join(work, "home", "contract"),
        denied: "work://readonly/a.md",
        close: () => rm(root, {recursive: true, force: true}),
    };
});

describe("本机参考实现自己的上限", () => {
    test("输出 5：超过 32 MiB 的文件读为 too-large，不整份读进内存", async () => {
        const root = await createTestTmpRoot("nb-harness-kit", "local-files-limit");
        try {
            const work = join(root, "work");
            await mkdir(work, {recursive: true});
            // 延长成稀疏文件：不真的写 32 MiB。
            await writeFile(join(work, "big.bin"), "");
            await truncate(join(work, "big.bin"), 32 * 1024 * 1024 + 1);
            const {files} = localFiles({
                roots: {work},
                aliases: {},
                layout: {working: "work://", scratch: [], localWrites: [], shellEnv: {}, searchExcludes: () => []},
                classify: () => "allowed",
                artifacts: "work://artifacts",
            });
            expect(await files.read("work://big.bin")).toMatchObject({ok: false, code: "too-large"});
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });
});
