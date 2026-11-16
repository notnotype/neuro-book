/**
 * 欢迎页宿主取数期间的标记（docs/specs/workbench/bookshelf.md 输出 20）：作品信息与项目根的列出取完之前（成功或失败）欢迎页
 * 根上带 `aria-busy="true"`，取完撤掉。用真实的 WelcomePage，远程与文件服务由测试决定何时返回。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {ShelfItem} from "../shared/shelf";
import WelcomePage from "./components/WelcomePage.vue";
import {projectsCatalogs} from "./text";
import {createWelcomeHost} from "./welcome";
import type {WelcomeHostOptions} from "./welcome";

/** 窗口同款的翻译端口（严格模式）：宿主的失败文字与页面都经它。 */
const port = testTextPort("zh-CN", {"nbook.projects": projectsCatalogs});

type ShelfResult = Awaited<ReturnType<WelcomeHostOptions["remote"]["shelf"]>>;
type ListResult = Awaited<ReturnType<NonNullable<WelcomeHostOptions["files"]>["list"]>>;

/** 由测试决定何时返回的结果。 */
function deferred<T>(): {readonly promise: Promise<T>; resolve(value: T): void} {
    const settle: {resolve: (value: T) => void} = {resolve: () => undefined};
    const promise = new Promise<T>((resolve) => Object.assign(settle, {resolve}));
    return {promise, resolve: (value) => settle.resolve(value)};
}

const ITEM: ShelfItem = {
    id: "fog", name: "fog", title: "雾港", description: "雾港旧事", color: null, cover: null, path: "/books/fog", state: "running",
    stats: {freshness: "none", computedAt: null, words: 0, files: 0, unreadable: 0, today: null, last: null},
};

function mountHost(shelf: Promise<ShelfResult>, list: Promise<ListResult> | null) {
    const reports: string[] = [];
    const Host = createWelcomeHost({
        component: WelcomePage,
        project: {id: "fog", title: "雾港"},
        remote: {shelf: () => shelf},
        files: list === null ? null : {list: () => list, create: () => Promise.reject(new Error("这条测试不新建章节"))},
        commands: {execute: () => Promise.reject(new Error("这条测试不执行命令"))},
        text: port,
        now: () => Date.parse("2026-10-12T16:30:00+01:00"),
        shortcut: () => null,
        report: (message) => reports.push(message),
    });
    return {wrapper: mount(Host, {global: {provide: provideText(port)}, props: {context: {recent: []}}}), reports};
}

describe("欢迎页宿主的取数标记", () => {
    it("作品信息与项目根的列出都返回之前根上带 aria-busy；都返回后撤掉，显示取到的简介", async () => {
        const shelf = deferred<ShelfResult>();
        const list = deferred<ListResult>();
        const {wrapper} = mountHost(shelf.promise, list.promise);
        await flushPromises();
        expect(wrapper.attributes("aria-busy")).toBe("true");

        shelf.resolve({ok: true, value: [ITEM]});
        await flushPromises();
        expect(wrapper.attributes("aria-busy")).toBe("true");

        list.resolve({ok: true, value: {folder: "plain", contentRoot: null, entries: []}});
        await flushPromises();
        expect(wrapper.attributes("aria-busy")).toBeUndefined();
        expect(wrapper.get("[data-welcome-description]").text()).toBe("雾港旧事");
    });

    it("取数失败也撤掉 aria-busy，失败记下来", async () => {
        const shelf = deferred<ShelfResult>();
        const {wrapper, reports} = mountHost(shelf.promise, null);
        await flushPromises();
        expect(wrapper.attributes("aria-busy")).toBe("true");

        shelf.resolve({ok: false, code: "unavailable"});
        await flushPromises();
        expect(wrapper.attributes("aria-busy")).toBeUndefined();
        expect(reports).toEqual(["The welcome page could not read the project info: unavailable"]);
    });
});
