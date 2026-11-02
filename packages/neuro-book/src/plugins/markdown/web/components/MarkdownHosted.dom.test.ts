/**
 * nbook 交出的 nb-markdown 组件（`MarkdownHosted.vue`，服务 `markdownKey` 的五个组件都经它挂上）拿到 nbook 的宿主：链接目标按
 * 作品文件分类（docs/specs/workspace/markdown-dialect.md 输出 27），展示器、已发送文字与小块三处一致。不提供宿主时 nb-markdown
 * 只认外部链接，这里断言的文件图标与 work、user 细分都会消失。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {markdownReportKey} from "../parts/report";
import {SyntaxCatalog, syntaxCatalogKey} from "../syntax-catalog";
import {markdownCatalogs} from "../text";
import MarkdownHosted from "./MarkdownHosted.vue";
import type {HostedComponent} from "./MarkdownHosted.vue";

const catalog = new SyntaxCatalog({get: () => null, list: () => []}, () => undefined);
const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
});

/** 与插件的 `withHost` 一样，祖先给方言目录与诊断出口；窗口给翻译端口（登记了内置插件的目录）。 */
async function hosted(component: HostedComponent, attrs: Record<string, unknown>) {
    const reports: string[] = [];
    const wrapper = mount(MarkdownHosted, {
        props: {component},
        attrs,
        attachTo: document.body,
        global: {provide: {[syntaxCatalogKey as symbol]: catalog, [markdownReportKey as symbol]: (event: string) => reports.push(event), ...provideText(testTextPort("zh-CN", {"nbook.markdown": markdownCatalogs}))}},
    });
    cleanups.push(() => wrapper.unmount());
    await flushPromises();
    return wrapper;
}

const LINKS = "[林雪](/设定/林雪.md) [头像](user://头像.png) [截图](session://attachments/截图.png) [旧章](chapter://c1) [官网](https://example.com)";

describe("nbook 的宿主到达 nb-markdown 的组件", () => {
    it("展示器：作品里的文件与用户资产是文件小块（细分 work、user，带文件图标），session://attachments/ 是附件，别的方案是其它，外部链接是普通链接", async () => {
        const wrapper = await hosted("MarkdownDisplay", {text: `${LINKS}\n`});
        await waitUntil("展示器画完", () => (wrapper.findAll("[data-reference-link]").length === 4 ? true : null));
        expect(wrapper.findAll("[data-reference-link]").map((chip) => chip.attributes("data-reference-link"))).toEqual(["work", "user", "attachment", "other"]);
        expect(wrapper.findAll(".nb-chip-link__icon svg[data-file-icon]").map((icon) => icon.attributes("data-icon"))).toEqual(["markdown", "image"]);
        expect(wrapper.find("a[href='https://example.com'] [data-reference-link]").exists()).toBe(false);
    });

    it("已发送文字与单独的小块：同样按作品文件分类、取文件图标", async () => {
        const view = await hosted("PromptTextView", {text: "看 [林雪](/设定/林雪.md) 与 [官网](https://example.com)"});
        await waitUntil("小块", () => (view.find("[data-inline-chip='reference']").exists() ? true : null));
        const chips = view.findAll("[data-inline-chip='reference']");
        expect(chips[0]?.classes()).toContain("nb-chip--work");
        expect(chips[0]?.find("svg[data-file-icon]").attributes("data-icon")).toBe("markdown");
        expect(chips[1]?.find(".i-lucide-globe").exists()).toBe(true);

        const chip = await hosted("InlineChip", {kind: "reference", label: "头像", target: "user://头像.png"});
        await waitUntil("小块", () => (chip.find("[data-inline-chip]").exists() ? true : null));
        expect(chip.find("[data-inline-chip]").classes()).toContain("nb-chip--user");
        expect(chip.find("svg[data-file-icon]").attributes("data-icon")).toBe("image");
    });
});
