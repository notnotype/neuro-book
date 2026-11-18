/**
 * 属性声明的取得（docs/specs/workbench/markdown-editing.md 输出 59、61）：按名字查、同名冲突取 id 最小的并记诊断。声明表是一个对
 * `ContributionDeclarations` 的最小实现（按 id 码元顺序给出）；经真实的插件运行时的流程在 `plugin.dom.test.ts`。
 */

import {describe, expect, it} from "bun:test";

import type {ContributionDeclarations, ContributionDescriptor} from "@notnotype/nb-runtime/plugins";

import type {DisplayText} from "nbook/shared/localized-text";

import type {PropertyDeclaration} from "../shared/properties";
import {createPropertyDescriptions} from "./properties-catalog";

function declarations(entries: ReadonlyArray<{readonly id: string; readonly declaration: PropertyDeclaration}>): ContributionDeclarations & {replace(next: typeof entries): void} {
    let current = entries;
    const descriptors = (): Array<ContributionDescriptor<PropertyDeclaration>> => [...current].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((entry) => ({capability: "markdown.properties", id: entry.id, plugin: entry.id.split(".")[0] as string, location: "browser", declaration: entry.declaration}) as unknown as ContributionDescriptor<PropertyDeclaration>);
    return {
        get: (_capability, id) => (descriptors().find((descriptor) => descriptor.id === id) ?? null) as never,
        list: () => descriptors() as never,
        replace: (next) => {
            current = next;
        },
    };
}

function setup(entries: ReadonlyArray<{readonly id: string; readonly declaration: PropertyDeclaration}>) {
    const source = declarations(entries);
    const conflicts: Array<[string, string, string]> = [];
    // 窗口的翻译端口的替身：按当前语言取语言映射，字符串原样。
    let locale = "zh-CN";
    const text = (display: DisplayText): string => (typeof display === "string" ? display : String((display as Record<string, string>)[locale] ?? ""));
    const describe = createPropertyDescriptions({declarations: source, text, conflict: (name, kept, ignored) => conflicts.push([name, kept, ignored])});
    return {source, describe, conflicts, setLocale: (next: string) => {
        locale = next;
    }};
}

describe("createPropertyDescriptions", () => {
    it("按属性名精确查；没有声明的名字（含大小写不同的）为 null；只给的字段才出现", () => {
        const {describe: find} = setup([
            {id: "nbook.canon.pov", declaration: {name: "视角", icon: "i-lucide-eye", label: "叙述视角", kind: "text"}},
            {id: "nbook.canon.when", declaration: {name: "时间", kind: "date"}},
            {id: "nbook.canon.tag", declaration: {name: "Tag", label: "标签"}},
        ]);
        expect(find("视角")).toEqual({icon: "i-lucide-eye", label: "叙述视角", kind: "text"});
        expect(find("时间")).toEqual({kind: "date"});
        expect(find("Tag")).toEqual({label: "标签"});
        expect(find("tag")).toBeNull();
        expect(find("地点")).toBeNull();
    });

    it("空的显示名（空串、没有当前语言的语言表、只有空白）等于没给：不出现 label，图标与类型照给", () => {
        const {describe: find, setLocale} = setup([
            {id: "a.blank", declaration: {name: "甲", label: "", icon: "i-lucide-eye"}},
            {id: "a.spaces", declaration: {name: "乙", label: "  ", kind: "date"}},
            {id: "a.table", declaration: {name: "丙", label: {"zh-CN": "丙的名字"}, kind: "number"}},
        ]);
        expect(find("甲")).toEqual({icon: "i-lucide-eye"});
        expect(find("乙")).toEqual({kind: "date"});
        expect(find("丙")).toEqual({label: "丙的名字", kind: "number"});
        setLocale("en-US");
        expect(find("丙")).toEqual({kind: "number"});
    });

    it("label 按当前界面语言取：语言切换后下一次查就是新的", () => {
        const {describe: find, setLocale} = setup([{id: "nbook.canon.pov", declaration: {name: "视角", label: {"zh-CN": "叙述视角", "en-US": "Point of view"}}}]);
        expect(find("视角")?.label).toBe("叙述视角");
        setLocale("en-US");
        expect(find("视角")?.label).toBe("Point of view");
    });

    it("同名冲突：id 码元顺序最小的整条生效（不逐字段合并），每个被忽略的各记一条，同一对不重复记", () => {
        const {describe: find, conflicts} = setup([
            {id: "b.second", declaration: {name: "视角", label: "视点", kind: "list"}},
            {id: "a.first", declaration: {name: "视角", icon: "i-lucide-eye"}},
            {id: "c.third", declaration: {name: "视角", icon: "i-lucide-user"}},
        ]);
        expect(find("视角")).toEqual({icon: "i-lucide-eye"});
        expect(find("视角")).toEqual({icon: "i-lucide-eye"});
        expect(conflicts).toEqual([["视角", "a.first", "b.second"], ["视角", "a.first", "c.third"]]);
    });

    it("声明表变了（插件装卸）：下一次查就是新的；冲突解除后换了赢家，新的一对照常记", () => {
        const {describe: find, source, conflicts} = setup([{id: "b.second", declaration: {name: "视角", label: "视点"}}]);
        expect(find("视角")?.label).toBe("视点");
        source.replace([{id: "a.first", declaration: {name: "视角", label: "叙述视角"}}, {id: "b.second", declaration: {name: "视角", label: "视点"}}]);
        expect(find("视角")?.label).toBe("叙述视角");
        expect(conflicts).toEqual([["视角", "a.first", "b.second"]]);
        source.replace([]);
        expect(find("视角")).toBeNull();
    });
});
