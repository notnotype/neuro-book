/**
 * 假接口的数据与合同对过（t10 计划 3.10“假接口的数据”）：`e2e/fixtures/` 的每一份过一遍合同 schema 的 `Value.Check`。
 * 类型（`satisfies`）只管形状，用户名、时间这类 pattern 要在这里查；不合格的假数据会让浏览器场景测的是合同里不存在的回答。
 */

import {describe, expect, it} from "bun:test";

import {Value} from "typebox/value";

import * as identityFixtures from "../e2e/fixtures/identity";

const {IDENTITY_FIXTURES, ...exported} = identityFixtures;

describe("假接口的数据", () => {
    it("账号模块的每一份都在检查清单里", () => {
        expect(IDENTITY_FIXTURES.map((fixture) => fixture.name).sort()).toEqual(Object.keys(exported).sort());
    });

    it("账号模块的每一份都符合合同的 schema", () => {
        const failing = IDENTITY_FIXTURES.filter((fixture) => !Value.Check(fixture.schema, fixture.value)).map((fixture) => fixture.name);
        expect(failing).toEqual([]);
    });

    it("反例：形状对、pattern 不对的数据被拦下", () => {
        const fixture = IDENTITY_FIXTURES.find((candidate) => candidate.name === "userMe")!;
        expect(Value.Check(fixture.schema, {...(fixture.value as object), createdAt: "2026-11-01"})).toBe(false);
    });
});
