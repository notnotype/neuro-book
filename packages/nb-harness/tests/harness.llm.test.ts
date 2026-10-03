/**
 * 真实模型测试：只在显式设置 NBOOK_LLM_TESTS=1 且有凭据时运行（`bun run test:llm`），默认测试不调用模型。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {ProfilePrompt, System} from "@notnotype/nb-profile";
import {createJsonlSessionLog} from "@notnotype/nb-session";
import {llmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createHarness} from "../src";

const llm = llmTestConfig();
let root = "";

beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness-llm", "harness-real-model");
});

afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

describe.skipIf(llm === null)("真实模型", () => {
    test(
        "模型通过 read 工具读取文件并回答",
        async () => {
            const sessionId = "real-read";
            const file = join(root, "note.txt");
            await writeFile(file, "秘密内容：青鸟计划\n", "utf-8");
            const log = await createJsonlSessionLog({root, sessionId});
            const harness = await createHarness({
                model: llm!.model,
                cwd: root,
                sessionLog: log,
                node: ProfilePrompt({children: [System({children: ["你是严谨的助手，必须调用工具获取事实。"]})]}),
            });

            try {
                const result = await harness.turn("读取 note.txt（用 read 工具）并原样回答文件里的内容。");
                const entries = await log.read();

                expect(entries.some((entry) => entry.kind === "tool_call" && entry.toolName === "read")).toBe(true);
                expect(entries.some((entry) => entry.kind === "tool_result" && entry.isError === false)).toBe(true);
                expect(result.text.length).toBeGreaterThan(0);

                const replayed = await log.read();
                expect(replayed.map((entry) => entry.seq)).toEqual(entries.map((entry) => entry.seq));
            } finally {
                await harness.close();
            }
        },
        180_000,
    );

    test(
        "模型通过 edit 工具把 beta 改成 BETA",
        async () => {
            const sessionId = "real-edit";
            const file = join(root, "target.txt");
            await writeFile(file, "alpha\nbeta\ngamma\n", "utf-8");
            const log = await createJsonlSessionLog({root, sessionId});
            const harness = await createHarness({
                model: llm!.model,
                cwd: root,
                sessionLog: log,
                node: ProfilePrompt({children: [System({children: ["你是严谨的助手，必须先用 read 读取文件再用 edit 修改。"]})]}),
            });

            try {
                await harness.turn("用 read 读取 target.txt，然后用 edit 把第 2 行 beta 改成大写 BETA。");
                const disk = await readFile(file, "utf-8").catch(() => "<缺失>");

                expect(disk).toBe("alpha\nBETA\ngamma\n");
                const entries = await log.read();
                expect(entries.some((entry) => entry.kind === "tool_call" && entry.toolName === "edit")).toBe(true);
            } finally {
                await harness.close();
            }
        },
        180_000,
    );
});
