import {describe, expect, test} from "bun:test";
import Type from "typebox";
import {assertToolResultBudget, createStaticToolSource, defineTool, DEFAULT_TOOL_RESULT_BUDGET, elideMiddle, spillToolResult, toAgentTool} from "./tools";
import {cutBytes} from "./spill";
import type {AdapterHooks, ToolSource} from "./tools";
import {runScriptedAgent} from "./testing/scripted-agent";

const hooks = (source: ToolSource, extra: Partial<AdapterHooks> = {}): AdapterHooks => ({source, session: {id: "s1"}, approve: async () => ({approved: true}), ...extra});
const dump = (text: string) => defineTool({id: "dump", description: "吐一大段", parameters: Type.Object({}), risk: "read", execute: async () => ({ok: true, content: [{type: "text", text}, {type: "image", mimeType: "image/png", data: "AAAA"}], details: {kind: "dump"}})});

describe("工具结果的预算与溢出（输出 9）", () => {
    test("elideMiddle：头尾各按行与字节留，中间一行省略说明；多字节字符不被拆开；加起来不超预算时原样", () => {
        const lines = Array.from({length: 2000}, (_v, i) => `第${i + 1}行：${"汉".repeat(20)}`);
        const text = lines.join("\n");
        const elided = elideMiddle(text, {spillBytes: 1, headBytes: 1000, tailBytes: 1000, tailLines: 500});
        expect(elided.totalLines).toBe(2000);
        expect(elided.content.startsWith("第1行：")).toBe(true);
        expect(elided.content.endsWith("第2000行：" + "汉".repeat(20))).toBe(true);
        expect(elided.content).toMatch(/…（中间省略 \d+ 行，\d+ 字节）/u);
        expect(new TextEncoder().encode(elided.content).length).toBeLessThan(2200);
        for (const line of elided.content.split("\n")) expect(line.includes("�")).toBe(false);
        const whole = elideMiddle("a\nb\nc", {spillBytes: 1, headBytes: 100, tailBytes: 100, tailLines: 500});
        expect(whole.content).toBe("a\nb\nc");
        // 一行就超预算：按字节截到字符边界
        const oneLine = elideMiddle("汉".repeat(1000), {spillBytes: 1, headBytes: 10, tailBytes: 10, tailLines: 500});
        expect(oneLine.content.split("\n")[0]).toBe("汉".repeat(3));
    });

    test("缺省预算是合同值：50 KiB 才溢出、头尾各 20 KiB、各最多 500 行——按字面数字而不是导出的常量核对边界", async () => {
        expect(DEFAULT_TOOL_RESULT_BUDGET).toEqual({spillBytes: 51200, headBytes: 20480, tailBytes: 20480, tailLines: 500});
        const result = (text: string) => ({content: [{type: "text" as const, text}]});
        const kept = await spillToolResult(result("x".repeat(51200)), "t", DEFAULT_TOOL_RESULT_BUDGET, undefined);
        expect(kept.content[0]!.type === "text" && kept.content[0].text.length).toBe(51200);
        const spilled = await spillToolResult(result("x".repeat(51201)), "t", DEFAULT_TOOL_RESULT_BUDGET, undefined);
        expect(spilled.content[0]!.type === "text" && spilled.content[0].text).toContain("超过预算 51200 字节");
        // 行数边界：2000 行短行，头尾各停在 500 行
        const short = elideMiddle(Array.from({length: 2000}, (_v, i) => `l${String(i).padStart(4, "0")}`).join("\n"), DEFAULT_TOOL_RESULT_BUDGET);
        expect([short.keptHeadLines, short.keptTailLines]).toEqual([500, 500]);
        expect(short.content).toContain("…（中间省略 1000 行，");
        // 字节边界：每行 100 字节加换行，头尾各 20480 字节能放 203 行（203 × 101 = 20503 > 20480，202 行 20401 字节再加一行就超）
        const wide = elideMiddle(Array.from({length: 1000}, () => "w".repeat(100)).join("\n"), DEFAULT_TOOL_RESULT_BUDGET);
        expect([wide.keptHeadLines, wide.keptTailLines]).toEqual([202, 202]);
    });

    test("cutBytes 按码点一次走完：多字节不拆、代理对不拆、长单行也快；预算字段必须是非负整数；错误结果的 <code>: 前缀不进预算", async () => {
        expect(cutBytes("héllo", 2)).toBe("h");
        expect(cutBytes("héllo", 3)).toBe("hé");
        expect(cutBytes("😀x", 3)).toBe("");
        expect(cutBytes("😀x", 4)).toBe("😀");
        expect(cutBytes("😀x", 5)).toBe("😀x");
        expect(cutBytes("汉".repeat(1_000_000), 500_000)).toBe("汉".repeat(166_666));
        for (const bad of [{headBytes: -1}, {spillBytes: Number.NaN}, {tailLines: 1.5}, {tailBytes: Number.POSITIVE_INFINITY}]) {
            expect(() => assertToolResultBudget({...DEFAULT_TOOL_RESULT_BUDGET, ...bad})).toThrow(TypeError);
        }
        const failing = createStaticToolSource([defineTool({id: "boom", description: "总是失败", parameters: Type.Object({}), risk: "read", execute: async () => ({ok: false, code: "io-failed", message: "x".repeat(100)})})]);
        const tight = toAgentTool(failing.list()[0]!, hooks(failing, {budget: {spillBytes: 4, headBytes: 1, tailBytes: 1, tailLines: 1}}));
        const result = await tight.execute("c7", {}, new AbortController().signal);
        expect(result.isError).toBe(true);
        const text = result.content.find((block) => block.type === "text")!.text;
        expect(text.startsWith("io-failed: x")).toBe(true);
        expect(text).toContain("超过预算 4 字节");
    });

    test("场景 7：真实 OMP Agent 里 200 KiB 的结果——全文进溢出存储，模型看到头尾与 artifact://0 的回读提示，图片块与 details 保留；存失败照样截、没有链接；预算内的原样", async () => {
        const big = Array.from({length: 4000}, (_v, i) => `line-${i + 1} ${"x".repeat(45)}`).join("\n");
        expect(new TextEncoder().encode(big).length).toBeGreaterThan(200 * 1024);
        const saved: {toolName: string; text: string}[] = [];
        const source = createStaticToolSource([dump(big)]);
        const tools = source.list().map((descriptor) => toAgentTool(descriptor, hooks(source, {artifacts: {save: async (toolName, text) => {
            saved.push({toolName, text});
            return String(saved.length - 1);
        }}})));
        const run = await runScriptedAgent({tools, script: [{calls: [{id: "c1", name: "dump", args: {}}]}, {text: "看完了"}]});
        expect(saved).toEqual([{toolName: "dump", text: big}]);
        const [result] = run.toolResults;
        expect(result?.isError).toBe(false);
        expect(new TextEncoder().encode(result!.text).length).toBeLessThan(DEFAULT_TOOL_RESULT_BUDGET.headBytes + DEFAULT_TOOL_RESULT_BUDGET.tailBytes + 512);
        // 脚本化 Agent 把图片块写成 [image]：图片保留在前，文字从第一行起
        expect(result!.text.startsWith("[image]line-1 ")).toBe(true);
        expect(result!.text).toContain("line-4000 ");
        expect(result!.text).toContain("read artifact://0");
        expect(result!.text).toMatch(/中间省略 \d+ 行/u);

        // 直接调用看完整结果：图片块在前、details 带 truncated
        const direct = await tools[0]!.execute("c2", {}, new AbortController().signal);
        expect(direct.content.map((block) => block.type)).toEqual(["image", "text"]);
        expect(direct.details).toMatchObject({kind: "dump", truncated: {bytes: expect.any(Number), lines: 4000, artifactId: "1"}});

        // 存失败（抛出）与没有存储：照样截断，提示里说全文未能保存
        const failing = source.list().map((descriptor) => toAgentTool(descriptor, hooks(source, {artifacts: {save: async () => {
            throw new Error("磁盘满");
        }}})));
        const unsaved = await failing[0]!.execute("c3", {}, new AbortController().signal);
        const unsavedText = unsaved.content.find((block) => block.type === "text")!.text;
        expect(unsavedText).toContain("全文未能保存");
        expect(unsavedText).not.toContain("artifact://");
        const bare = source.list().map((descriptor) => toAgentTool(descriptor, hooks(source)));
        const bareResult = await bare[0]!.execute("c4", {}, new AbortController().signal);
        expect(bareResult.content.find((block) => block.type === "text")!.text).toContain("全文未能保存");

        // 预算内原样；预算可调
        const small = createStaticToolSource([dump("短")]);
        const kept = await toAgentTool(small.list()[0]!, hooks(small)).execute("c5", {}, new AbortController().signal);
        expect(kept.content.find((block) => block.type === "text")!.text).toBe("短");
        const tight = await toAgentTool(small.list()[0]!, hooks(small, {budget: {spillBytes: 1, headBytes: 1, tailBytes: 1, tailLines: 1}})).execute("c6", {}, new AbortController().signal);
        expect(tight.content.find((block) => block.type === "text")!.text).toContain("超过预算 1 字节");
    });
});
