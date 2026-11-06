/**
 * 场景提供者下拉的选项（docs/specs/theme/editor.md 输出 20、验收 19）：已发布的可选，有显示名的显示显示名、右侧是贡献 id；声明里已有的
 * 提供者没发布时保留为不可选的“未发布”项，发布后变回普通项，撤回后又变回不可选项。
 */

import {describe, expect, it} from "bun:test";

import {NO_PROVIDER, providerOptions} from "./web/components/theme-editor/provider-options";

const labels = {none: "无", unpublished: "未发布"};
/** 按当前语言解文字：字符串原样，语言映射取 zh-CN。与 `useText().t` 对字符串与语言映射的行为一致。 */
const resolve = (title: string | Readonly<Record<string, string>>): string => (typeof title === "string" ? title : title["zh-CN"] ?? "");
const clock = {id: "acme.sky.clock"};

describe("场景提供者下拉的选项", () => {
    it("“无”加已发布的提供者；没有当前值时就这些", () => {
        expect(providerOptions([clock], undefined, labels, resolve)).toEqual([{value: NO_PROVIDER, label: "无"}, {value: "acme.sky.clock", label: "acme.sky.clock"}]);
    });

    it("有显示名的提供者显示显示名，贡献 id 放在右侧的次要文字里；字符串与语言映射都收", () => {
        const options = providerOptions([{id: "acme.sky.aurora", title: {"zh-CN": "极光", "en-US": "Aurora"}}, {id: "acme.sky.plain", title: "晴空"}, clock], undefined, labels, resolve);
        expect(options.slice(1)).toEqual([
            {value: "acme.sky.aurora", label: "极光", description: "acme.sky.aurora"},
            {value: "acme.sky.plain", label: "晴空", description: "acme.sky.plain"},
            {value: "acme.sky.clock", label: "acme.sky.clock"},
        ]);
    });

    it("当前值是已发布的：不重复追加", () => {
        expect(providerOptions([clock], "acme.sky.clock", labels, resolve)).toHaveLength(2);
    });

    it("当前值没发布：保留为不可选的“未发布”项，不丢；发布后变回普通项，撤回后又变回不可选项", () => {
        const missing = providerOptions([], "acme.sky.clock", labels, resolve);
        expect(missing.at(-1)).toEqual({value: "acme.sky.clock", label: "acme.sky.clock", description: "未发布", disabled: true});
        const published = providerOptions([clock], "acme.sky.clock", labels, resolve);
        expect(published.find((option) => option.value === "acme.sky.clock")).toEqual({value: "acme.sky.clock", label: "acme.sky.clock"});
        expect(providerOptions([], "acme.sky.clock", labels, resolve).at(-1)?.disabled).toBe(true);
    });

    it("有显示名的提供者撤回后：仍保留为不可选的“未发布”项，显示的是 id（没有句柄就没有显示名）", () => {
        expect(providerOptions([], "acme.sky.aurora", labels, resolve).at(-1)).toEqual({value: "acme.sky.aurora", label: "acme.sky.aurora", description: "未发布", disabled: true});
    });
});
