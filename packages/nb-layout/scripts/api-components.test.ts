import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {afterEach, describe, expect, it} from "bun:test";
import type {ComponentMeta} from "vue-component-meta";

import {componentSurface} from "./api-components";

/**
 * vue-component-meta 的结果用手写的数据代替：这里测的是本包对它的筛选，以及读源码宏与模板的那两段。它对真实组件的输出由
 * `api:check` 对 7 个组件跑、并与发布声明的 `$props` 交叉核对。
 */
const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true});
});

function sfc(source: string): string {
    const dir = mkdtempSync(join(tmpdir(), "nb-layout-api-components-"));
    dirs.push(dir);
    const file = join(dir, "Sample.vue");
    writeFileSync(file, source);
    return file;
}

const OWN = "/pkg/src/Sample.vue";
const prop = (name: string, extra: Partial<ComponentMeta["props"][number]> = {}) => ({name, type: "string", required: true, global: false, default: undefined, declarations: [{file: OWN, range: [0, 0] as [number, number]}], ...extra});
const meta = (overrides: Partial<Pick<ComponentMeta, "props" | "events" | "slots" | "exposed">>) => ({props: [], events: [], slots: [], exposed: [], ...overrides}) as unknown as ComponentMeta;
const own = (file: string) => file.startsWith("/pkg/src/");

describe("组件的五段", () => {
    it("props 只留声明在本包里的、按名字排；缺省值与可选写进行里", () => {
        const surface = componentSurface(
            meta({props: [prop("zeta", {required: false, type: "number | undefined", default: "0"}), prop("alpha"), prop("id", {declarations: [{file: "/repo/node_modules/@vue/runtime-dom/dist/runtime-dom.d.ts", range: [0, 0]}]}), prop("class", {global: true})] as never}),
            sfc(`<script setup lang="ts">\ndefineProps<{alpha: string; zeta?: number}>();\n</script>\n<template><div /></template>\n`),
            own,
        );
        expect(surface.props).toEqual(["alpha: string", "zeta?: number | undefined = 0"]);
        expect(surface.propNames).toEqual(["alpha", "zeta"]);
    });

    it("透传：与包外类型的交叉按打印的类型写，`/* @vue-ignore */` 与注释去掉；缺省落在根元素", () => {
        const surface = componentSurface(
            meta({}),
            sfc(`<script setup lang="ts">\nimport type {HTMLAttributes} from "vue";\nimport type {Local} from "./local";\nwithDefaults(defineProps<{\n    /** 说明 */\n    a?: string;\n} & /* @vue-ignore */ Pick<HTMLAttributes, "id"> & Local>(), {a: ""});\n</script>\n<template><div /></template>\n`),
            own,
        );
        expect(surface.attrs).toEqual([`& Pick<HTMLAttributes, "id">`, "→ 根元素"]);
    });

    it("`inheritAttrs: false`：落在 `v-bind=\"$attrs\"` 所在的元素，属性值里有 `>` 也认得出", () => {
        const surface = componentSurface(
            meta({}),
            sfc(`<script setup lang="ts">\ndefineOptions({inheritAttrs: false});\ndefineProps<{n: number}>();\n</script>\n<template><section><div v-if="n > 0" class="x" v-bind="$attrs" /></section></template>\n`),
            own,
        );
        expect(surface.attrs).toEqual(["→ <div>（inheritAttrs: false）"]);
    });

    it("`inheritAttrs: false` 加 `useAttrs()` 的变量；哪里都没绑时写不落", () => {
        const bound = componentSurface(
            meta({}),
            sfc(`<script setup lang="ts">\nimport {useAttrs} from "vue";\ndefineOptions({inheritAttrs: false});\nconst attrs = useAttrs();\n</script>\n<template><Teleport to="body"><span v-bind="attrs" /></Teleport></template>\n`),
            own,
        );
        expect(bound.attrs).toEqual(["→ <span>（inheritAttrs: false）"]);
        const none = componentSurface(meta({}), sfc(`<script setup lang="ts">\ndefineOptions({inheritAttrs: false});\n</script>\n<template><div /></template>\n`), own);
        expect(none.attrs).toEqual(["→ 不落（inheritAttrs: false）"]);
    });

    it("插槽：有 `defineSlots` 时打印它（模板字面量名字也在），没有时用 vue-component-meta 从模板推出的", () => {
        const declared = componentSurface(
            meta({slots: [{name: "default", type: "any"}] as never}),
            sfc("<script setup lang=\"ts\">\ndefineSlots<Record<`panel-${string}`, (props: {index: number}) => unknown> & {default(): unknown}>();\n</script>\n<template><slot /></template>\n"),
            own,
        );
        expect(declared.slots).toEqual(["Record<`panel-${string}`, (props: { index: number; }) => unknown> & { default(): unknown; }"]);
        const literal = componentSurface(meta({}), sfc(`<script setup lang="ts">\ndefineSlots<{\n    /** 图标 */\n    icon?(): unknown;\n    default(props: {a: number}): unknown;\n}>();\n</script>\n<template><slot /></template>\n`), own);
        expect(literal.slots).toEqual(["default(props: { a: number; }): unknown", "icon?(): unknown"]);
        const inferred = componentSurface(meta({slots: [{name: "icon", type: "{}"}] as never}), sfc(`<script setup lang="ts">\ndefineProps<{label: string}>();\n</script>\n<template><slot name="icon" /></template>\n`), own);
        expect(inferred.slots).toEqual(["icon: {}"]);
    });

    it("事件用连字符名、去掉参数元组的方括号；expose 按名字排", () => {
        const surface = componentSurface(
            meta({events: [{name: "gesture-start", type: "[info: Start]"}, {name: "change", type: "[]"}] as never, exposed: [{name: "zoom", type: "() => void"}, {name: "at", type: "number"}] as never}),
            sfc(`<script setup lang="ts">\n</script>\n<template><div /></template>\n`),
            own,
        );
        expect(surface.events).toEqual(["change()", "gesture-start(info: Start)"]);
        expect(surface.exposed).toEqual(["at: number", "zoom: () => void"]);
    });
});
