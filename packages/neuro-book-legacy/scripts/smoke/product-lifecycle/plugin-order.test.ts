import {describe, expect, it} from "vitest";
import {assessPluginOrder} from "./plugin-order";

type Diagnostic = {
    sequence: number;
    plugin: string;
    entry: string;
    generation: number;
    stage: "publish" | "close";
    reason: string;
    capability: null;
    contribution: null;
    error: null;
};

interface OrderFixture {
    entries: Array<{plugin: string; entry: string; dependencies: string[]; provides: string[]}>;
    diagnostics: Diagnostic[];
}

function fixture(): OrderFixture {
    const plugins = ["nbook.app-state", "nbook.session-store", "nbook.project", "nbook.agent"];
    const entries = plugins.map((plugin, index) => ({
        plugin, entry: "server", dependencies: index === 0 ? [] : [`${plugins[index - 1]}/ready`], provides: [`${plugin}/ready`],
    }));
    const diagnostics: Diagnostic[] = [];
    for (const plugin of plugins) diagnostics.push({sequence: diagnostics.length + 1, plugin, entry: "server", generation: 1, stage: "publish", reason: "published", capability: null, contribution: null, error: null});
    for (const plugin of plugins) diagnostics.push({sequence: diagnostics.length + 1, plugin, entry: "server", generation: 1, stage: "close", reason: "close-started", capability: null, contribution: null, error: null});
    for (const plugin of plugins.toReversed()) diagnostics.push({sequence: diagnostics.length + 1, plugin, entry: "server", generation: 1, stage: "close", reason: "closed", capability: null, contribution: null, error: null});
    return {entries, diagnostics};
}
function jsonl(data: OrderFixture): string {
    return [JSON.stringify({event: "runtime.plugins.catalog", data: {entries: data.entries}}), ...data.diagnostics.map((diagnostic) => JSON.stringify({event: "runtime.plugins.diagnostic", data: diagnostic}))].join("\n");
}

describe("产品插件顺序判定", () => {
    it("从乱序 JSONL 的 sequence 与目录服务键推导激活和逆序关闭", () => {
        const data = fixture();
        data.diagnostics.reverse();
        const logs = jsonl(data);
        expect(assessPluginOrder(logs, "activation-order")).toMatchObject({result: "pass", evidence: expect.stringContaining("1:nbook.app-state/server#1 -> 2:nbook.session-store/server#1")});
        expect(assessPluginOrder(logs, "close-order")).toMatchObject({result: "pass", evidence: expect.stringContaining("closed=9:nbook.agent/server#1 -> 10:nbook.project/server#1 -> 11:nbook.session-store/server#1 -> 12:nbook.app-state/server#1")});
    });

    it("空图不能因为没有顺序冲突而通过", () => {
        const data = fixture();
        data.entries.forEach((entry) => {entry.dependencies = [];});
        expect(assessPluginOrder(jsonl(data), "activation-order").result).toBe("fail");
        expect(assessPluginOrder(jsonl(data), "close-order").result).toBe("fail");
    });

    it("存在其它边但缺必需 Project 到 Agent 链仍失败", () => {
        const data = fixture();
        data.entries[3]!.dependencies = ["nbook.app-state/ready"];
        expect(assessPluginOrder(jsonl(data), "activation-order").result).toBe("fail");
    });

    it("依赖者先于提供方发布时失败", () => {
        const data = fixture();
        data.diagnostics[0]!.sequence = 2;
        data.diagnostics[1]!.sequence = 1;
        expect(assessPluginOrder(jsonl(data), "activation-order").result).toBe("fail");
    });

    it("目录中的必需入口未发布不能误判通过", () => {
        const data = fixture();
        data.diagnostics = data.diagnostics.filter((diagnostic) => diagnostic.plugin !== "nbook.agent");
        expect(assessPluginOrder(jsonl(data), "activation-order").result).toBe("fail");
    });

    it("提供方先于依赖者关闭时失败", () => {
        const data = fixture();
        data.diagnostics[10]!.sequence = 12;
        data.diagnostics[11]!.sequence = 11;
        expect(assessPluginOrder(jsonl(data), "close-order").result).toBe("fail");
    });

    it.each(["close-started", "closed"])("已发布代次缺少 %s 诊断时失败", (reason) => {
        const data = fixture();
        data.diagnostics = data.diagnostics.filter((diagnostic) => diagnostic.plugin !== "nbook.project" || diagnostic.reason !== reason);
        expect(assessPluginOrder(jsonl(data), "close-order").result).toBe("fail");
    });

    it.each(["close-started", "closed"])("同一代次重复 %s 诊断时失败", (reason) => {
        const data = fixture();
        const duplicate = data.diagnostics.find((diagnostic) => diagnostic.plugin === "nbook.agent" && diagnostic.reason === reason)!;
        data.diagnostics.push({...duplicate, sequence: 13});
        expect(assessPluginOrder(jsonl(data), "close-order").result).toBe("fail");
    });

    it("另一代次的关闭不能替代已发布代次的关闭", () => {
        const data = fixture();
        data.diagnostics.find((diagnostic) => diagnostic.plugin === "nbook.project" && diagnostic.reason === "closed")!.generation = 2;
        expect(assessPluginOrder(jsonl(data), "close-order").result).toBe("fail");
    });

    it("额外插件的依赖也必须遵循目录而不是硬编码链", () => {
        const data = fixture();
        data.entries.push({plugin: "extra", entry: "server", dependencies: ["nbook.agent/ready"], provides: ["extra/ready"]});
        data.diagnostics.push({...data.diagnostics[0]!, sequence: 13, plugin: "extra"});
        data.diagnostics.push({...data.diagnostics[4]!, sequence: 14, plugin: "extra"});
        data.diagnostics.push({...data.diagnostics[8]!, sequence: 15, plugin: "extra"});
        expect(assessPluginOrder(jsonl(data), "close-order").result).toBe("fail");
    });

    it("损坏日志与缺目录均为 fail，不降为 pending", () => {
        expect(assessPluginOrder("{invalid", "activation-order").result).toBe("fail");
        expect(assessPluginOrder("", "close-order").result).toBe("fail");
    });
});
