/**
 * 视图声明的登记校验里 `replaces` 的规则（docs/specs/workbench/views.md 输出 20）：只能点名声明方自己插件的视图，前缀按插件 id，不按保留发布者；
 * `confinedTo` 的规则（输出 22）：限定的区域就是声明的区域，不写容器。
 * 布局里怎样摘掉被取代的视图在 `web/state/default-tree.test.ts`，位置限制怎样判在 `web/state/placement.test.ts`。
 */

import {describe, expect, it} from "bun:test";

import {validateViewContribution, WORKBENCH_VIEWS_POINT} from "./views";

const descriptor = (plugin: string, id: string, replaces?: readonly string[], extra: Readonly<Record<string, unknown>> = {}) => ({
    capability: WORKBENCH_VIEWS_POINT,
    id,
    plugin,
    entry: "browser",
    location: "browser" as const,
    declaration: {title: "消息", icon: "i-lucide-messages-square", location: "auxiliarybar", layout: "fill", ...(replaces === undefined ? {} : {replaces}), ...extra},
});

describe("视图声明的 replaces", () => {
    it("点名自己插件别的视图：接受", () => {
        expect(validateViewContribution(descriptor("nbook.agent", "nbook.agent.conversation", ["nbook.agent.sessions"]))).toBeNull();
    });

    it("点名同一发布者的另一个内置插件、第三方插件的视图、自己：都拒", () => {
        expect(validateViewContribution(descriptor("nbook.agent", "nbook.agent.conversation", ["nbook.files.explorer"]))).toContain("nbook.files.explorer");
        expect(validateViewContribution(descriptor("acme.notes", "acme.notes.list", ["nbook.agent.sessions"]))).toContain("nbook.agent.sessions");
        expect(validateViewContribution(descriptor("nbook.agent", "nbook.agent.conversation", ["nbook.agent.conversation"]))).toContain("nbook.agent.conversation");
    });
});

describe("视图声明的 confinedTo", () => {
    it("限定的区域就是声明的区域、不写容器：接受；区域对不上或写了容器：拒", () => {
        expect(validateViewContribution(descriptor("nbook.agent", "nbook.agent.messages", undefined, {confinedTo: "auxiliarybar"}))).toBeNull();
        expect(validateViewContribution(descriptor("nbook.agent", "nbook.agent.messages", undefined, {confinedTo: "auxiliarybar", location: "sidebar"}))).toContain("confinedTo");
        expect(validateViewContribution(descriptor("nbook.agent", "nbook.agent.messages", undefined, {confinedTo: "auxiliarybar", container: "nbook.agent.box"}))).toContain("confinedTo");
        expect(validateViewContribution(descriptor("nbook.agent", "nbook.agent.messages", undefined, {confinedTo: "panel"}))).toContain("不合格");
    });
});
