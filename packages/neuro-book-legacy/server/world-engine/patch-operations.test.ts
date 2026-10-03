/**
 * Phase 2: Patch Operations 测试
 */

import { describe, test, expect } from "vitest";
import { applyPatch } from "./patch-operations";
import type { PatchInput, JsonValue } from "./types";

describe("Patch Operations", () => {
    describe("replace 操作", () => {
        test("替换顶层属性", () => {
            const state = { hp: 100, level: 1 };
            const patch: PatchInput = {
                subjectId: "test",
                op: "replace",
                path: "/hp",
                value: 80,
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).toBeNull();
            expect(state.hp).toBe(80);
        });

        test("替换嵌套属性", () => {
            const state = { equipment: { head: null, chest: null } };
            const patch: PatchInput = {
                subjectId: "test",
                op: "replace",
                path: "/equipment/head",
                value: "subject://helmet-01",
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).toBeNull();
            expect((state.equipment as any).head).toBe("subject://helmet-01");
        });

        test("替换数组元素", () => {
            const state = { items: ["a", "b", "c"] };
            const patch: PatchInput = {
                subjectId: "test",
                op: "replace",
                path: "/items/1",
                value: "x",
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).toBeNull();
            expect(state.items).toEqual(["a", "x", "c"]);
        });
    });

    describe("increment 操作", () => {
        test("数值累加", () => {
            const state = { hp: 100 };
            const patch: PatchInput = {
                subjectId: "test",
                op: "increment",
                path: "/hp",
                value: -30,
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).toBeNull();
            expect(state.hp).toBe(70);
        });

        test("缺少基准时报错", () => {
            const state = {};
            const patch: PatchInput = {
                subjectId: "test",
                op: "increment",
                path: "/hp",
                value: 10,
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).not.toBeNull();
            expect(issue?.code).toBe("broken-relative");
            expect(issue?.message).toContain("缺少已存在的数值基准");
        });

        test("基准不是数值时报错", () => {
            const state = { hp: "100" as any };
            const patch: PatchInput = {
                subjectId: "test",
                op: "increment",
                path: "/hp",
                value: 10,
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).not.toBeNull();
            expect(issue?.code).toBe("broken-relative");
            expect(issue?.message).toContain("基准不是有限数值");
        });
    });

    describe("remove 操作", () => {
        test("删除顶层属性", () => {
            const state = { hp: 100, level: 1 };
            const patch: PatchInput = {
                subjectId: "test",
                op: "remove",
                path: "/hp",
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).toBeNull();
            expect("hp" in state).toBe(false);
            expect(state.level).toBe(1);
        });

        test("删除嵌套属性", () => {
            const state = { equipment: { head: "helmet", chest: "armor" } };
            const patch: PatchInput = {
                subjectId: "test",
                op: "remove",
                path: "/equipment/head",
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).toBeNull();
            expect("head" in (state.equipment as any)).toBe(false);
            expect((state.equipment as any).chest).toBe("armor");
        });

        test("删除数组元素", () => {
            const state = { items: ["a", "b", "c"] };
            const patch: PatchInput = {
                subjectId: "test",
                op: "remove",
                path: "/items/1",
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).toBeNull();
            expect(state.items).toEqual(["a", "c"]);
        });

        test("删除不存在的路径是幂等的", () => {
            const state = { hp: 100 };
            const patch: PatchInput = {
                subjectId: "test",
                op: "remove",
                path: "/nonexistent",
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).toBeNull();
            expect(state).toEqual({ hp: 100 });
        });

        test("collection 按值删除已有元素，找不到时保持幂等", () => {
            const state = { inventory: ["subject://old-sword", "subject://key"] };
            const patch: PatchInput = {
                subjectId: "test",
                op: "remove",
                path: "/inventory",
                value: "subject://old-sword",
            };

            const issue = applyPatch(state, patch, null, new Set(["inventory"]));

            expect(issue).toBeNull();
            expect(state.inventory).toEqual(["subject://key"]);

            const secondIssue = applyPatch(state, patch, null, new Set(["inventory"]));
            expect(secondIssue).toBeNull();
            expect(state.inventory).toEqual(["subject://key"]);
        });

        test("collection 按 stable JSON 深相等删除对象元素", () => {
            const state = {
                badges: [
                    { phase: "active", flag: "urgent" },
                    { flag: "done", phase: "closed" },
                ] as JsonValue[],
            };
            const patch: PatchInput = {
                subjectId: "test",
                op: "remove",
                path: "/badges",
                value: { flag: "urgent", phase: "active" },
            };

            const issue = applyPatch(state, patch, null, new Set(["badges"]));

            expect(issue).toBeNull();
            expect(state.badges).toEqual([{ flag: "done", phase: "closed" }]);
        });

        test("list 不支持按值删除", () => {
            const state = { events: ["抵达王都", "拿到旧剑"] };
            const patch: PatchInput = {
                subjectId: "test",
                op: "remove",
                path: "/events",
                value: "拿到旧剑",
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).not.toBeNull();
            expect(issue?.code).toBe("invalid-path");
            expect(issue?.message).toContain("list 不支持按值删");
            expect(state.events).toEqual(["抵达王都", "拿到旧剑"]);
        });
    });

    describe("append 操作", () => {
        test("追加到普通数组", () => {
            const state = { items: ["a", "b"] };
            const patch: PatchInput = {
                subjectId: "test",
                op: "append",
                path: "/items",
                value: "c",
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).toBeNull();
            expect(state.items).toEqual(["a", "b", "c"]);
        });

        test("追加到 unique 数组时自动去重", () => {
            const state = { skills: ["fireball", "heal"] };
            const patch: PatchInput = {
                subjectId: "test",
                op: "append",
                path: "/skills",
                value: "fireball",
            };

            const uniqueArrays = new Set(["skills"]);
            const issue = applyPatch(state, patch, null, uniqueArrays);

            expect(issue).toBeNull();
            expect(state.skills).toEqual(["fireball", "heal"]); // 未追加重复值
        });

        test("追加到 unique 数组时新值正常追加", () => {
            const state = { skills: ["fireball", "heal"] };
            const patch: PatchInput = {
                subjectId: "test",
                op: "append",
                path: "/skills",
                value: "shield",
            };

            const uniqueArrays = new Set(["skills"]);
            const issue = applyPatch(state, patch, null, uniqueArrays);

            expect(issue).toBeNull();
            expect(state.skills).toEqual(["fireball", "heal", "shield"]);
        });

        test("缺少数组基准时报错", () => {
            const state = {};
            const patch: PatchInput = {
                subjectId: "test",
                op: "append",
                path: "/items",
                value: "a",
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).not.toBeNull();
            expect(issue?.code).toBe("broken-relative");
            expect(issue?.message).toContain("缺少已存在的数组基准");
        });
    });

    describe("跨引用操作检测", () => {
        test("禁止跨引用操作", () => {
            const state = {
                equipment: {
                    armor: {
                        chest: "subject://mythril-plate",
                    },
                },
            };

            const patch: PatchInput = {
                subjectId: "test",
                op: "replace",
                path: "/equipment/armor/chest/durability",
                value: 50,
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).not.toBeNull();
            expect(issue?.code).toBe("cross-ref");
            expect(issue?.message).toContain("禁止跨引用操作");
            expect(issue?.message).toContain("subject://mythril-plate");
        });

        test("允许替换引用本身", () => {
            const state = {
                equipment: {
                    armor: {
                        chest: "subject://iron-plate",
                    },
                },
            };

            const patch: PatchInput = {
                subjectId: "test",
                op: "replace",
                path: "/equipment/armor/chest",
                value: "subject://mythril-plate",
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).toBeNull();
            expect((state.equipment.armor as any).chest).toBe("subject://mythril-plate");
        });

        test("禁止跨数组元素引用", () => {
            const state = {
                inventory: ["subject://sword-01", "subject://shield-01"],
            };

            const patch: PatchInput = {
                subjectId: "test",
                op: "replace",
                path: "/inventory/0/durability",
                value: 80,
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).not.toBeNull();
            expect(issue?.code).toBe("cross-ref");
        });
    });

    describe("JSON Pointer 路径解析", () => {
        test("根路径", () => {
            const state = { hp: 100 };
            const patch: PatchInput = {
                subjectId: "test",
                op: "replace",
                path: "/",
                value: { hp: 80, level: 2 },
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).toBeNull();
            expect(state).toEqual({ hp: 80, level: 2 });
        });

        test("路径必须以 / 开头", () => {
            const state = { hp: 100 };
            const patch: PatchInput = {
                subjectId: "test",
                op: "replace",
                path: "hp",
                value: 80,
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).not.toBeNull();
            expect(issue?.code).toBe("invalid-path");
            expect(issue?.message).toContain("必须以 / 开头");
        });

        test("JSON Pointer 转义", () => {
            // JSON Pointer 中 ~ 编码为 ~0，/ 编码为 ~1
            const state = { "a/b": { "c~d": 123 } };
            const patch: PatchInput = {
                subjectId: "test",
                op: "replace",
                path: "/a~1b/c~0d",
                value: 456,
            };

            const issue = applyPatch(state, patch, null, new Set());

            expect(issue).toBeNull();
            expect((state as any)["a/b"]["c~d"]).toBe(456);
        });
    });

});

describe("embedding 字段保护 (Decision #16)", () => {
    test("允许对 embedding record（memory）空对象 replace 作为初始化基准", () => {
        const state = {};
        const patch: PatchInput = { subjectId: "erina", op: "replace", path: "/memory", value: {} };
        const issue = applyPatch(state, patch, { kind: "object", itemType: "object", embedding: "record" }, new Set());
        expect(issue).toBeNull();
        expect(state).toEqual({ memory: {} });
    });

    test("禁止对 embedding record（memory）非空整块 replace", () => {
        const state = { memory: { s1: { text: "旧" } } };
        const patch: PatchInput = { subjectId: "erina", op: "replace", path: "/memory", value: { s2: { text: "新" } } };
        const issue = applyPatch(state, patch, { kind: "object", itemType: "object", embedding: "record" }, new Set());
        expect(issue?.code).toBe("embedding-whole-replace");
        expect(issue?.message).toContain("replace /memory/<key>");
        expect(issue?.message).toContain("空容器 replace");
        expect(issue?.message).toContain("vector 由系统维护");
        // state 未被修改
        expect(state.memory).toEqual({ s1: { text: "旧" } });
    });

    test("允许对 embedding array（events）空数组 replace 作为初始化基准", () => {
        const state = {};
        const patch: PatchInput = { subjectId: "erina", op: "replace", path: "/events", value: [] };
        const issue = applyPatch(state, patch, { kind: "list", itemType: "object", embedding: "array" }, new Set());
        expect(issue).toBeNull();
        expect(state).toEqual({ events: [] });
    });

    test("禁止对 embedding array（events）非空整块 replace", () => {
        const state = { events: [{ text: "e1" }] };
        const patch: PatchInput = { subjectId: "erina", op: "replace", path: "/events", value: [{ text: "e2" }] };
        const issue = applyPatch(state, patch, { kind: "list", itemType: "object", embedding: "array" }, new Set());
        expect(issue?.code).toBe("embedding-whole-replace");
        expect(issue?.message).toContain("append /events");
        expect(issue?.message).toContain("空容器 replace");
        expect(issue?.message).toContain("vector 由系统维护");
    });

    test("允许按 key 写入 memory 单条（非整块）", () => {
        const state = { memory: { s1: { text: "旧" } } };
        // 单条 key 的 attrSchema 是 EmbeddingText 本身（无 embedding 容器标记）
        const patch: PatchInput = { subjectId: "erina", op: "replace", path: "/memory/s2", value: { text: "新" } };
        const issue = applyPatch(state, patch, { kind: "object" }, new Set());
        expect(issue).toBeNull();
        expect((state.memory as any).s2).toEqual({ text: "新" });
    });

    test("允许 append events 单条", () => {
        const state = { events: [{ text: "e1" }] };
        const patch: PatchInput = { subjectId: "erina", op: "append", path: "/events", value: { text: "e2" } };
        const issue = applyPatch(state, patch, { kind: "list", itemType: "object", embedding: "array" }, new Set());
        expect(issue).toBeNull();
        expect((state.events as any).length).toBe(2);
    });
});
