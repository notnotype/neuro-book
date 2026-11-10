/**
 * 本机参考实现跑一遍 `SessionFiles` 的合同（docs/specs/harness/host-kit.md）：kit 自己的测试把它当真实依赖用，所以它先要过合同。
 */

import {mkdir, rm} from "node:fs/promises";
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
