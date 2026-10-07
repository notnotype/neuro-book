/**
 * 记录定义：加载时校验、缺省值、描述的指纹与资源 id 规则（docs/specs/storage/persistence.md 场景 6）。
 */

import {describe, expect, it} from "bun:test";

import {Type} from "typebox";

import {defineRecord, descriptorProblem, recordFingerprint, resourceProblem} from "./storage";

const Sizes = Type.Object({sidebar: Type.Number(), panel: Type.Number()}, {additionalProperties: false});

describe("Spec storage.persistence 场景 6：记录定义", () => {
    it("缺省为 local、不按资源寻址、上限 64 KiB；结果冻结，带描述与指纹", () => {
        const sizes = defineRecord({key: "layout-sizes", scope: "project", version: 1, schema: Sizes});

        expect(sizes.descriptor).toEqual({key: "layout-sizes", scope: "project", locality: "local", version: 1, keyed: false, maxBytes: 65536, schema: Sizes});
        expect(Object.isFrozen(sizes)).toBe(true);
        expect(sizes.fingerprint).toBe(recordFingerprint(sizes.descriptor));
    });

    it("不合规则的定义在加载时抛 TypeError", () => {
        const base = {key: "ok", scope: "user" as const, version: 1, schema: Sizes};
        const bad: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
            ["键含大写", {key: "Layout"}],
            ["键以 - 开头", {key: "-x"}],
            ["键超过 64 个字符", {key: "a".repeat(65)}],
            ["scope 不认识", {scope: "session"}],
            ["locality 不认识", {locality: "global"}],
            ["版本为 0", {version: 0}],
            ["版本不是整数", {version: 1.5}],
            ["schema 允许额外属性", {schema: Type.Object({a: Type.Number()})}],
            ["schema 不是对象", {schema: Type.Array(Type.Number())}],
            ["上限超过 1 MiB", {maxBytes: 1024 * 1024 + 1}],
            ["上限为 0", {maxBytes: 0}],
        ];
        for (const [label, override] of bad) {
            expect(() => defineRecord({...base, ...override} as Parameters<typeof defineRecord>[0]), label).toThrow(TypeError);
        }
        expect(defineRecord({...base, maxBytes: 1024 * 1024}).maxBytes).toBe(1024 * 1024);
    });

    it("指纹按每一层排序：只差 schema 的两份定义不同；键的书写顺序与 JSON 往返都不改变指纹", () => {
        const a = defineRecord({key: "k", scope: "user", version: 1, schema: Type.Object({a: Type.Number()}, {additionalProperties: false})});
        const b = defineRecord({key: "k", scope: "user", version: 1, schema: Type.Object({a: Type.String()}, {additionalProperties: false})});
        expect(a.fingerprint).not.toBe(b.fingerprint);

        const reordered = JSON.parse(JSON.stringify({schema: a.descriptor.schema, maxBytes: a.maxBytes, keyed: a.keyed, version: a.version, locality: a.locality, scope: a.scope, key: a.key})) as typeof a.descriptor;
        expect(recordFingerprint(reordered)).toBe(a.fingerprint);
    });

    it("远程带来的描述按同一规则核对：多出字段或结构不对给出原因", () => {
        const record = defineRecord({key: "k", scope: "user", version: 1, schema: Sizes});
        expect(descriptorProblem(JSON.parse(JSON.stringify(record.descriptor)))).toBeNull();
        expect(descriptorProblem({...record.descriptor, owner: "someone-else"})).toContain("owner");
        expect(descriptorProblem({...record.descriptor, schema: {type: "string"}})).toContain("schema");
        expect(descriptorProblem(null)).not.toBeNull();
    });

    it("资源 id：按资源寻址时必填且合规，不按资源寻址时不能给", () => {
        expect(resourceProblem({keyed: false}, undefined)).toBeNull();
        expect(resourceProblem({keyed: false}, "x")).not.toBeNull();
        expect(resourceProblem({keyed: true}, undefined)).not.toBeNull();
        expect(resourceProblem({keyed: true}, "task-1.a_b")).toBeNull();
        expect(resourceProblem({keyed: true}, "Task")).not.toBeNull();
        expect(resourceProblem({keyed: true}, "a/b")).not.toBeNull();
        expect(resourceProblem({keyed: true}, "a".repeat(129))).not.toBeNull();
    });
});
