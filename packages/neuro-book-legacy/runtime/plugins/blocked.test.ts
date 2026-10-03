import {describe, expect, it} from "vitest";

import {defineServiceKey} from "../services/services";
import {deriveBlocked} from "./blocked";
import type {EntrySnapshot} from "./blocked";

const a = defineServiceKey("a/service");
const b = defineServiceKey("b/service");
const c = defineServiceKey("c/service");
const missing = defineServiceKey("missing/service");

function entry(plugin: string, provides: EntrySnapshot["provides"], dependencies: EntrySnapshot["dependencies"] = [], status: EntrySnapshot["status"] = "registered"): EntrySnapshot {
    return {plugin, entry: "main", location: "server", provides, dependencies, status};
}

describe("入口受阻纯推导", () => {
    it("只检查本位置必需依赖，并报告声明顺序中第一个缺失键", () => {
        const entries = [entry("a", [a], [{key: b, required: false}, {key: missing}, {key: c}]), {...entry("b", [b], [{key: missing}]), location: "browser" as const}];
        expect([...deriveBlocked(entries, "server", new Set())]).toEqual([
            ["a/main", {reason: "missing-service", key: missing.name, path: ["a/main"]}], ["b/main", null],
        ]);
        expect(deriveBlocked(entries, "server", new Set([missing.name, c.name])).get("a/main")).toBeNull();
    });

    it("跨位置提供方为位置不匹配，提供方失败独立于其缺失依赖", () => {
        const entries = [entry("a", [a], [{key: b}]), {...entry("b", [b]), location: "browser" as const}];
        expect(deriveBlocked(entries, "server", new Set()).get("a/main")).toEqual({reason: "location-mismatch", key: b.name, path: ["a/main"]});
        entries[1] = entry("b", [b], [{key: missing}], "failed");
        expect(deriveBlocked(entries, "server", new Set()).get("a/main")).toEqual({reason: "provider-failed", key: b.name, path: ["a/main", "b/main"]});
    });

    it("传递受阻路径连接全部入口，重复推导和三种登记顺序得到同样结果", () => {
        const entries = [entry("a", [a], [{key: b}]), entry("b", [b], [{key: c}]), entry("c", [c], [{key: missing}])];
        const expected = {reason: "provider-blocked", key: b.name, path: ["a/main", "b/main", "c/main"]};
        for (const order of [entries, [...entries].reverse(), [entries[1]!, entries[0]!, entries[2]!]]) {
            expect(deriveBlocked(order, "server", new Set()).get("a/main")).toEqual(expected);
            expect(deriveBlocked(order, "server", new Set()).get("a/main")).toEqual(expected);
        }
    });

    it("依赖环只标记环成员，环外依赖方受提供方受阻，无关入口不受影响", () => {
        const entries = [entry("a", [a], [{key: b}]), entry("b", [b], [{key: a}]), entry("c", [c], [{key: a}]), entry("other", [])];
        const blocked = deriveBlocked(entries, "server", new Set());
        expect(blocked.get("a/main")).toEqual({reason: "dependency-cycle", key: b.name, path: ["a/main", "b/main", "a/main"]});
        expect(blocked.get("b/main")).toEqual({reason: "dependency-cycle", key: a.name, path: ["b/main", "a/main", "b/main"]});
        expect(blocked.get("c/main")).toEqual({reason: "provider-blocked", key: a.name, path: ["c/main", "a/main", "b/main", "a/main"]});
        expect(blocked.get("other/main")).toBeNull();
    });
});
