/**
 * 宿主页（runtime.browser-host 的失败页）：按窗口状态给出能恢复的动作。连接失败与无法打开项目可以原地重试，
 * 版本不一致、启动失败、服务端已重启与项目已关闭只能刷新，与项目有关的两页另给“不打开项目”；启动中没有动作，
 * 读屏按状态播报而不是告警。
 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import {TEXT_PORT_KEY} from "@notnotype/nb-ui/text-port";
import type {TextPort} from "@notnotype/nb-ui/text-port";

import {editorText} from "nbook/plugins/editor/shared/text";
import {editorCatalogs} from "nbook/plugins/editor/web/text";

import FailurePage from "./FailurePage.vue";
import {createHostTextEngine} from "./host/text-engine";

type PageProps = InstanceType<typeof FailurePage>["$props"];

/** 页面在宿主翻译端口下挂载（端口由宿主注入，docs/specs/ui/i18n.md）；缺省中文。 */
function mountPage(props: PageProps, port: TextPort = createHostTextEngine({locale: "zh-CN", strict: true}).port) {
    return mount(FailurePage, {props, global: {provide: {[TEXT_PORT_KEY as symbol]: port}}});
}

describe("宿主页", () => {
    it("连接失败：显示原因，只给重试", async () => {
        const page = mountPage({state: {status: "connection-failed", reason: "HTTP 503 stopping"}});
        expect(page.get("[data-browser-host-status]").attributes()).toMatchObject({"data-browser-host-status": "connection-failed", "role": "alert"});
        expect(page.text()).toContain("HTTP 503 stopping");
        expect(page.findAll("button").map((button) => button.text())).toEqual(["重试"]);
        await page.get("button").trigger("click");
        expect(page.emitted()).toHaveProperty("retry");
        expect(page.emitted()).not.toHaveProperty("reload");
    });

    it("版本不一致、启动失败与服务端已重启：只给刷新页面", async () => {
        for (const status of ["incompatible", "startup-failed", "server-restarted"] as const) {
            const page = mountPage({state: {status, reason: "原因"}});
            expect(page.findAll("button").map((button) => button.text())).toEqual(["刷新页面"]);
            await page.get("button").trigger("click");
            expect(page.emitted()).toHaveProperty("reload");
        }
    });

    it("服务端已重启：标题说明原因，不自动刷新", () => {
        const page = mountPage({state: {status: "server-restarted", reason: "服务端已换进程"}});
        expect(page.get("h1").text()).toBe("服务端已重启");
        expect(page.get("[data-browser-host-status]").attributes("role")).toBe("alert");
        expect(page.emitted()).not.toHaveProperty("reload");
    });

    it("无法打开项目：显示原因，给重试与“不打开项目”（链接到 /，不经事件）", async () => {
        const page = mountPage({state: {status: "project-unavailable", reason: "没有登记的项目：nope"}});
        expect(page.get("h1").text()).toBe("无法打开项目");
        expect(page.text()).toContain("没有登记的项目：nope");
        expect(page.findAll("button").map((button) => button.text())).toEqual(["重试"]);
        expect(page.get("a.nb-host-home").attributes("href")).toBe("/");
        await page.get("button").trigger("click");
        expect(page.emitted()).toHaveProperty("retry");
    });

    it("项目已关闭：只给刷新页面与“不打开项目”，不自动刷新", async () => {
        const page = mountPage({state: {status: "project-gone", reason: "绑定的项目代次已结束"}});
        expect(page.get("h1").text()).toBe("项目已关闭");
        expect(page.get("[data-browser-host-status]").attributes()).toMatchObject({"data-browser-host-status": "project-gone", "role": "alert"});
        expect(page.findAll("button").map((button) => button.text())).toEqual(["刷新页面"]);
        expect(page.get("a.nb-host-home").attributes("href")).toBe("/");
        expect(page.emitted()).not.toHaveProperty("reload");
        await page.get("button").trigger("click");
        expect(page.emitted()).toHaveProperty("reload");
    });

    it("终态带未保存的正文：逐项列出地址与只读正文，可复制，提供者有说明时显示说明；没有时不出现这一节", async () => {
        const rescued = [{path: "project://a.md", text: "第一章\n未保存"}, {path: "user://u.md", text: "U", note: "有一块只留下了文字"}];
        const page = mountPage({state: {status: "server-restarted", reason: "boot changed", rescued}});
        const items = page.findAll("[data-host-rescued-item]");
        expect(items.map((item) => item.get("code").text())).toEqual(["project://a.md", "user://u.md"]);
        expect(items.map((item) => (item.get("textarea").element as HTMLTextAreaElement).value)).toEqual(["第一章\n未保存", "U"]);
        expect(items[0]?.get("textarea").attributes("readonly")).toBeDefined();
        expect(items.map((item) => item.find("[data-host-rescued-note]").exists() ? item.get("[data-host-rescued-note]").text() : null)).toEqual([null, "有一块只留下了文字"]);
        expect(page.findAll("button").map((button) => button.text())).toEqual(["刷新页面", "复制正文", "复制正文"]);
        const plain = mountPage({state: {status: "server-restarted", reason: "boot changed"}});
        expect(plain.find("[data-host-rescued]").exists()).toBe(false);
    });

    it("未保存正文的说明是文字值时经端口翻译：编辑器的“格式丢了”说明按当前语言显示，切换语言后原地换成英文", async () => {
        // 编辑器的目录在窗口引擎里登记后不撤销，所以终态的页面照样翻得出编辑器给的说明。
        const engine = createHostTextEngine({locale: "zh-CN", strict: true});
        engine.register("nbook.editor", editorCatalogs.catalogs, editorCatalogs.source);
        const rescued = [{path: "project://a.md", text: "正文", note: editorText("rescue.lostFormat")}];
        const page = mountPage({state: {status: "server-restarted", reason: "boot changed", rescued}}, engine.port);
        expect(page.get("[data-host-rescued-note]").text()).toBe("这个视图有写不回 Markdown 的块，那些块只留下了文字（格式丢了）");
        engine.setLocale("en-US");
        await page.vm.$nextTick();
        expect(page.get("[data-host-rescued-note]").text()).toBe("This view has blocks that cannot be written back as Markdown; only their text was kept (the formatting is lost)");
    });

    it("启动中：与静态加载页同一个样子，没有动作，按状态播报；引导给出书名后显示书名与“正在打开”", async () => {
        const page = mountPage({state: {status: "starting", projectTitle: null}});
        expect(page.get("[data-browser-host-status]").attributes("role")).toBe("status");
        expect(page.get("[data-browser-host-status]").classes()).toContain("nb-host-loading");
        expect(page.findAll("button")).toEqual([]);
        // 形状来自 nb-host-indicator，定位来自 nb-host-loading__bar：两个类缺一，加载页没有进度指示。
        expect(page.get(".nb-host-loading__bar").classes()).toContain("nb-host-indicator");
        expect(page.get(".nb-host-loading__title").text()).toBe("");
        expect(page.get(".nb-host-loading__hint").text()).toBe("正在连接服务端");

        await page.setProps({state: {status: "starting", projectTitle: "雾港"}});
        expect(page.get(".nb-host-loading__title").text()).toBe("雾港");
        expect(page.get(".nb-host-loading__hint").text()).toBe("正在打开");
    });

    it("界面语言：en-US 显示英文标题、提示、按钮与读屏名；切换语言不重新挂载就换文字", async () => {
        const engine = createHostTextEngine({locale: "en-US", strict: true});
        const rescued = [{path: "project://a.md", text: "正文"}];
        const page = mountPage({state: {status: "connection-failed", reason: "HTTP 503", rescued}}, engine.port);
        const root = page.get("[data-browser-host-status]").element;
        expect(page.get("h1").text()).toBe("Can't Connect to the Server");
        expect(page.findAll("button").map((button) => button.text())).toEqual(["Retry", "Copy Text"]);
        expect(page.get("textarea").attributes("aria-label")).toBe("Unsaved text of project://a.md");

        engine.setLocale("zh-CN");
        await page.vm.$nextTick();
        expect(page.get("h1").text()).toBe("无法连接服务端");
        expect(page.findAll("button").map((button) => button.text())).toEqual(["重试", "复制正文"]);
        expect(page.get("textarea").attributes("aria-label")).toBe("project://a.md 未保存的正文");
        expect(page.get("[data-browser-host-status]").element).toBe(root);
    });
});
