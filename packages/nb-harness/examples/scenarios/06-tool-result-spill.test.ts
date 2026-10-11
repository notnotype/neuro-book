/**
 * 场景 6：工具结果超预算——全文溢出到 artifact，模型按 `artifact://N` 回读。
 *
 * 要说明的事：
 * - 预算在适配层统一做（照 OMP 的缺省：文本超过 50 KiB 就溢出，上下文里留头 20 KiB、尾 20 KiB、各最多 500 行），
 *   与工具无关：插件工具返回多大都不会撑爆窗口。日志里的工具结果就是模型看到的那份（回放等于上下文），全文在溢出存储。
 * - 溢出存储由装配方给：这里是 JSONL 存储旁的目录 `<state>/sessions/<会话 id>.artifacts/<序号>.<工具名>.log`；
 *   不给就是内存实现。`artifact://` 是只读的虚拟方案，`read artifact://0` 可带 `offset`、`limit` 翻页。
 * - 提示文字里就有回读方法，模型不需要额外训练。
 *
 * 行为合同：docs/specs/harness/tools.md 输出 9；docs/specs/harness/session.md 输出 24；docs/specs/harness/builtin-tools.md 输出 9。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {createStaticToolSource} from "@notnotype/nb-harness/tools";
import {defineProfile} from "@notnotype/nb-harness/profile";
import {assemble} from "../assemble";
import type {Assembled} from "../assemble";
import {scriptedModel} from "../testing/scripted-model";
import {createStage, exampleConfig, loadWriterProfile, toolResults} from "../testing/stage";
import type {Stage} from "../testing/stage";
import {DUMP_LINES, dumpText, dumpTool} from "../tools/dump";

let stage: Stage | null = null;
let assembled: Assembled | null = null;
afterAll(async () => {
    assembled?.close();
    await stage?.cleanup();
});

describe("示例场景 6：工具结果溢出", () => {
    test("220 KiB 的结果在日志里只剩头尾与回读提示，全文在 artifacts 目录；模型按 artifact://0 翻到指定行", async () => {
        stage = await createStage("06-tool-result-spill");
        const writer = await loadWriterProfile();
        // 示例 Profile 只列了 read、edit：派生一个多列 dump 的
        const profile = defineProfile({...writer, id: "dumper", fields: {...writer.fields, "harness/tools": ["read", "edit", "dump"]}});
        const model = scriptedModel([
            {calls: [{id: "c1", name: "dump", args: {}}]},
            {calls: [{id: "c2", name: "read", args: {path: "artifact://0", offset: 2500, limit: 2}}]},
            {text: "第 2500 行看到了。"},
        ]);
        assembled = await assemble({
            workspace: stage.workspace, state: stage.state, config: exampleConfig(), profiles: [profile],
            apiKeys: {scripted: "example-key"}, model: {stream: model.stream}, tools: [createStaticToolSource([dumpTool()])],
        });
        const created = await assembled.runtime.createSession({profileId: "dumper", id: "s6"});
        if (!created.ok) throw new Error(`${created.code}: ${created.detail}`);
        const session = created.value;
        const started = await session.prompt({content: "把全部输出吐出来，然后看第 2500 行。"});
        if (!started.ok) throw new Error(`${started.code}: ${started.detail}`);
        const result = await started.value.done;
        expect(result.status).toBe("completed");

        const [dumped, page] = toolResults(result.entries);
        // 日志里的 dump 结果：头尾各不到 20 KiB，中间一行省略，末尾一行回读提示
        expect(dumped?.isError).toBe(false);
        expect(new TextEncoder().encode(dumped!.text).length).toBeLessThan(41 * 1024);
        expect(dumped!.text.startsWith("1: ")).toBe(true);
        expect(dumped!.text).toContain(`\n${DUMP_LINES}: `);
        expect(dumped!.text).toMatch(/…（中间省略 \d+ 行，\d+ 字节）/u);
        expect(dumped!.text).toContain("read artifact://0");
        // 全文在 JSONL 存储旁的目录里，文件名带序号与工具名
        expect(await readFile(join(stage.state, "sessions", "s6.artifacts", "0.dump.log"), "utf8")).toBe(dumpText());
        // 回读：虚拟方案，没有标签头，按 offset/limit 给行（read 的行号在前，dump 自己的编号在后）
        expect(page?.isError).toBe(false);
        expect(page!.text).toBe(`2500: 2500: ${"x".repeat(50)}\n2501: 2501: ${"x".repeat(50)}`);
        // 模型第二次请求里看到的就是截断后的结果，不是全文
        const seen = model.contexts[1]!.messages.at(-1)!;
        expect(JSON.stringify(seen).length).toBeLessThan(45 * 1024);
        await session.close();
    });
});
