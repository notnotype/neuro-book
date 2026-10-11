/**
 * 真实模型场景：同一套装配，只是不传 `model.stream`，模型请求走 OMP 的真实网络传输。
 *
 * 只在 `bun run test:llm`（`NBOOK_LLM_TESTS=1`）下运行，服务由 `.env` 里专属的 `NBOOK_LLM_*` 键描述
 * （docs/testing/README.md 的“真实模型测试”）；真实模型调用要花钱，运行前取得开发者授权。
 * 断言只看结构（调用完成、模型读了文件、文件没被改），不看措辞。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {LLM_TEST_PROVIDER_ID, llmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {assemble} from "../assemble";
import type {Assembled} from "../assemble";
import {CHAPTER_1, createStage, loadWriterProfile, toolResults} from "../testing/stage";
import type {Stage} from "../testing/stage";

const llm = llmTestConfig();
let stage: Stage | null = null;
let assembled: Assembled | null = null;
afterAll(async () => {
    assembled?.close();
    await stage?.cleanup();
});

describe.skipIf(llm === null)("示例：真实模型", () => {
    test("写作助手读第一章并回答；只读，文件不变", async () => {
        stage = await createStage("live");
        assembled = await assemble({
            workspace: stage.workspace, state: stage.state, profiles: [await loadWriterProfile()],
            config: {
                // 自建提供方没有目录数据，contextWindow 要显式给（压缩阈值按它算）；数值不代表服务的真实上限
                providers: [{id: LLM_TEST_PROVIDER_ID, api: llm!.api, baseUrl: llm!.baseUrl, models: [{id: llm!.model, contextWindow: 128_000}]}],
                models: {defaultModel: `${LLM_TEST_PROVIDER_ID}/${llm!.model}`},
                approval: {mode: "write"},
            },
            apiKeys: {[LLM_TEST_PROVIDER_ID]: llm!.apiKey},
            maxTurns: 6,
        });
        const created = await assembled.runtime.createSession({profileId: "writer"});
        if (!created.ok) throw new Error(`${created.code}: ${created.detail}`);
        const started = await created.value.prompt({content: "读一下 project://chapter-1.md，用一句话说第一章发生了什么。只读，不要修改任何文件。"});
        if (!started.ok) throw new Error(`${started.code}: ${started.detail}`);
        const result = await started.value.done;
        if (result.status !== "completed") throw new Error(`调用 ${result.status}：${JSON.stringify(result.error)}`);
        const results = toolResults(result.entries);
        expect(results.length).toBeGreaterThan(0);
        expect(results.some((item) => !item.isError && item.text.startsWith("[project://chapter-1.md#"))).toBe(true);
        expect(await readFile(join(stage.workspace, "chapter-1.md"), "utf8")).toBe(CHAPTER_1);
        await created.value.close();
    }, 120_000);

    test("先读后改：模型按 hashline 协议把第二行改掉，其它行不动", async () => {
        if (stage === null || assembled === null) throw new Error("上一条场景先装配");
        const created = await assembled.runtime.createSession({profileId: "writer"});
        if (!created.ok) throw new Error(`${created.code}: ${created.detail}`);
        const started = await created.value.prompt({content: "把 project://chapter-1.md 的第二行改成“林岚站在远航号的甲板上。”，只改这一行，改完告诉我。"});
        if (!started.ok) throw new Error(`${started.code}: ${started.detail}`);
        const result = await started.value.done;
        if (result.status !== "completed") throw new Error(`调用 ${result.status}：${JSON.stringify(result.error)}`);
        const results = toolResults(result.entries);
        expect(results.some((item) => !item.isError && item.text.startsWith("[project://chapter-1.md#"))).toBe(true);
        expect(await readFile(join(stage.workspace, "chapter-1.md"), "utf8")).toBe("第一章 出航\n林岚站在远航号的甲板上。\n远处是 1987 年的青岛。\n");
        await created.value.close();
    }, 180_000);
});
