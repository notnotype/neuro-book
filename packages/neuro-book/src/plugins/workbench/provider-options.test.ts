/**
 * 场景提供者下拉的选项（docs/specs/theme/editor.md 输出 20、验收 19）：已发布的可选；声明里已有的提供者没发布时保留为不可选的“未发布”项，
 * 发布后变回普通项，撤回后又变回不可选项。
 */

import {describe, expect, it} from "bun:test";

import {NO_PROVIDER, providerOptions} from "./web/components/theme-editor/provider-options";

const labels = {none: "无", unpublished: "未发布"};

describe("场景提供者下拉的选项", () => {
    it("“无”加已发布的提供者；没有当前值时就这些", () => {
        expect(providerOptions(["acme.sky.clock"], undefined, labels)).toEqual([{value: NO_PROVIDER, label: "无"}, {value: "acme.sky.clock", label: "acme.sky.clock"}]);
    });

    it("当前值是已发布的：不重复追加", () => {
        expect(providerOptions(["acme.sky.clock"], "acme.sky.clock", labels)).toHaveLength(2);
    });

    it("当前值没发布：保留为不可选的“未发布”项，不丢；发布后变回普通项，撤回后又变回不可选项", () => {
        const missing = providerOptions([], "acme.sky.clock", labels);
        expect(missing.at(-1)).toEqual({value: "acme.sky.clock", label: "acme.sky.clock", description: "未发布", disabled: true});
        const published = providerOptions(["acme.sky.clock"], "acme.sky.clock", labels);
        expect(published.find((option) => option.value === "acme.sky.clock")).toEqual({value: "acme.sky.clock", label: "acme.sky.clock"});
        expect(providerOptions([], "acme.sky.clock", labels).at(-1)?.disabled).toBe(true);
    });
});
