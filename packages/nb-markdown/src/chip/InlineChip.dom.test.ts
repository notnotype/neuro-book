/**
 * InlineChip（同名 .md）：小块的图标、色调、悬停提示与键盘交互。
 */

import {mount} from "@vue/test-utils";
import {nextTick, ref} from "vue";
import {describe, expect, it} from "vitest";

import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";
import {TEXT_PORT_KEY} from "@notnotype/nb-ui/text-port";
import type {TextPort} from "@notnotype/nb-ui/text-port";

import {NB_MARKDOWN_CATALOGS, NB_MARKDOWN_NAMESPACE} from "../locales";
import {classifyScheme} from "../targets";
import type {ChipEnv} from "./chip";
import InlineChip from "./InlineChip.vue";

type ChipProps = InstanceType<typeof InlineChip>["$props"];
const chip = (props: ChipProps) => mount(InlineChip, {props});

describe("InlineChip", () => {
    it("引用按宿主的目标分类取图标（方言 Spec 输出 27）：文件用宿主画的文件图标、色调按细分，附件、外部、其它各有图标", () => {
        // 测试宿主：以 `/` 开头的、或给了所在文件的相对地址算文件（细分 work），图标是带文件名的元素。
        const env: ChipEnv = {
            targets: {
                classify: (target, base) => (target.startsWith("/") || (base !== null && !/^[a-z]+:/u.test(target)) ? {kind: "file", variant: "work", name: target.split("/").at(-1) ?? ""} : classifyScheme(target)),
                encodeFile: (target) => target,
            },
            fileIcon: (name) => ({render: (document) => Object.assign(document.createElement("i"), {className: "test-file-icon", title: name})}),
        };
        const work = chip({kind: "reference", label: "林雪", target: "/设定/林雪.md", env});
        expect(work.find("i.test-file-icon.nb-chip__icon").attributes("title")).toBe("林雪.md");
        expect(work.attributes("title")).toBe("引用：林雪 · /设定/林雪.md");
        expect(work.classes()).toContain("nb-chip--work");
        expect(chip({kind: "reference", label: "截图", target: "session://attachments/截图.png"}).find(".i-lucide-link").exists()).toBe(true);
        expect(chip({kind: "reference", label: "官网", target: "https://example.com", env}).find(".i-lucide-globe").exists()).toBe(true);
        expect(chip({kind: "reference", label: "旧章", target: "chapter://c1", env}).classes()).toContain("nb-chip--other");
        expect(chip({kind: "reference", label: "图", target: "a.png", base: "project://正文/第一章.md", env}).find("i.test-file-icon").exists()).toBe(true);
    });

    it("不给宿主的分类时只认外部链接：别的方案（nb-story 的出处）是不带文件图标的引用小块", () => {
        const source = chip({kind: "reference", label: "41.20", target: "paragraph://41.20"});
        expect(source.classes()).toContain("nb-chip--other");
        expect(source.find(".i-lucide-link").exists()).toBe(true);
    });

    it("附件只显示编号；上传中转圈，失败用危险色并在提示里写原因", () => {
        expect(chip({kind: "image", number: 2}).text()).toBe("#2");
        const uploading = chip({kind: "file", label: "a.txt", number: 3, state: "uploading"});
        expect(uploading.find(".nb-chip__spinner").exists()).toBe(true);
        expect(uploading.attributes("title")).toBe("文件 #3：a.txt，正在上传");
        const failed = chip({kind: "image", number: 1, state: "failed", error: "太大"});
        expect(failed.classes()).toContain("nb-chip--failed");
        expect(failed.attributes("title")).toBe("图片 #1，上传失败：太大");
    });

    it("提示按注入的翻译端口取；端口换了语言，提示跟着换", async () => {
        const translator = createMinimalTranslator({catalogs: {[NB_MARKDOWN_NAMESPACE]: NB_MARKDOWN_CATALOGS}, strict: true});
        const locale = ref("zh-CN");
        const port: TextPort = {locale, t: (text) => translator.translate(text, locale.value), variants: (text) => translator.variants(text)};
        const wrapper = mount(InlineChip, {props: {kind: "skill", label: "reviewer"}, global: {provide: {[TEXT_PORT_KEY as symbol]: port}}});
        expect(wrapper.attributes("title")).toBe("技能：reviewer");
        locale.value = "en-US";
        await nextTick();
        expect(wrapper.attributes("title")).toBe("Skill: reviewer");
    });

    it("interactive 时是可聚焦的按钮，回车与空格发出 activate；不 interactive 时不可聚焦", async () => {
        const wrapper = chip({kind: "command", label: "plan", interactive: true});
        expect([wrapper.attributes("role"), wrapper.attributes("tabindex")]).toEqual(["button", "0"]);
        await wrapper.trigger("keydown", {key: "Enter"});
        await wrapper.trigger("keydown", {key: " "});
        await wrapper.trigger("click");
        expect(wrapper.emitted("activate")).toHaveLength(3);
        const plain = chip({kind: "command", label: "plan"});
        expect(plain.attributes("tabindex")).toBeUndefined();
        await plain.trigger("keydown", {key: "Enter"});
        expect(plain.emitted("activate")).toBeUndefined();
    });
});
