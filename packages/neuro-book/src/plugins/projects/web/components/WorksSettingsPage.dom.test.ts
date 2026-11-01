/**
 * 设置窗口“作品”分区（同名 .md，docs/specs/workbench/bookshelf.md 输出 21）：插件交给设置窗口的页面（`works-section.ts` 的包装
 * 加 `WorksSettingsPage`）。配置来自设置场景的局部宿主（产品里同一个配置实例，用户层的拥有者在内存里，同设置窗口的组件测试），
 * 页面拿到的是 `nbook.projects` 自己的配置服务；目录选择器列一棵固定的目录树；有效的作品目录照服务端的算法
 * （`backend/library.ts`）从同一份配置算出。看没设时的缺省目录（取不到时的说明）、选定目录后写进用户层、写入失败发通知并
 * 回到实际值、层不可写时停用。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {readonly, ref} from "vue";
import type {Ref} from "vue";

import {createSettingsHost} from "nbook/plugins/lab/web/fixtures/settings-scene/settings-host";
import type {HostLayer} from "nbook/plugins/lab/web/fixtures/settings-scene/settings-host";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import {settingsCatalogs} from "nbook/plugins/settings/web/text";
import type {NotificationInput} from "nbook/plugins/workbench/shared/contracts";
import type {SettingLayer} from "nbook/shared/settings";
import {provideText} from "nbook/shared/testing/text-port";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import type {BrowseEntry} from "../../shared/contracts";
import {librarySetting} from "../../shared/contracts";
import type {LibraryInfo} from "../shelf-page";
import {projectsCatalogs} from "../text";
import {createWorksPage} from "../works-section";
import WorksSettingsPage from "./WorksSettingsPage.vue";

/**
 * 窗口同款的翻译引擎（严格模式），每次打开一个：页面经 `useText()` 取文字，通知交出的文字引用也按它翻；页面里的设置行
 * （`SettingsRow`）用 `nbook.settings` 的文字。
 */
function textEngine() {
    const engine = createHostTextEngine({locale: "zh-CN", strict: true});
    engine.register("nbook.projects", projectsCatalogs.catalogs, projectsCatalogs.source);
    engine.register("nbook.settings", settingsCatalogs.catalogs, settingsCatalogs.source);
    return engine;
}

const cleanup: Array<() => void> = [];
afterEach(() => {
    for (const dispose of cleanup.splice(0)) dispose();
    document.body.innerHTML = "";
});

const HOME = "/home/writer";
const LIBRARY = `${HOME}/Documents/NeuroBook`;
const TREE: Record<string, {parent: string | null; entries: BrowseEntry[]}> = {
    [LIBRARY]: {parent: `${HOME}/Documents`, entries: [{name: "drafts", path: `${LIBRARY}/drafts`, kind: "directory", title: null}]},
    [`${LIBRARY}/drafts`]: {parent: LIBRARY, entries: []},
    [`${HOME}/books`]: {parent: HOME, entries: [{name: "2026", path: `${HOME}/books/2026`, kind: "directory", title: null}]},
    [`${HOME}/books/2026`]: {parent: `${HOME}/books`, entries: []},
};

/** `library`：false 时取不到有效的作品目录（产品里远程调用失败）。 */
function open(user: HostLayer, library = true) {
    const text = textEngine();
    const port = text.port;
    const notices: NotificationInput[] = [];
    const listed: Array<string | null> = [];
    const host = createSettingsHost({settings: [{plugin: "nbook.projects", definition: librarySetting}], sections: [], user, notify: () => undefined, report: () => undefined});
    cleanup.push(() => host.dispose());
    const settings = host.service("nbook.projects");
    const page = createWorksPage({
        component: WorksSettingsPage,
        settings,
        library: async (): Promise<LibraryInfo | null> => {
            if (!library) return null;
            const configured = settings.get(librarySetting).trim();
            return configured === "" ? {path: LIBRARY, source: "default"} : {path: configured, source: "setting"};
        },
        source: {list: async (path) => {
            listed.push(path);
            const key = path ?? LIBRARY;
            const node = TREE[key];
            return node === undefined ? {ok: false, message: `列不出目录：${key}`} : {ok: true, value: {path: key, ...node}};
        }},
        notifications: {notify: (input) => {
            notices.push(input);
            return {id: String(notices.length), update: () => undefined, dismiss: () => undefined};
        }},
        report: () => undefined,
    });
    const context: SettingsPageContext = {id: "nbook.works", layer: readonly(ref<SettingLayer>("user")) as Readonly<Ref<SettingLayer>>, projectTitle: readonly(ref(null)), writable: readonly(ref(true)), options: {}, dirty: () => undefined, reportWriteFailure: () => undefined};
    const wrapper = mount(page, {global: {provide: provideText(port)}, props: {context}, attachTo: document.body});
    cleanup.push(() => wrapper.unmount());
    return {host, notices, listed, wrapper, text};
}

const one = <T extends Element = HTMLElement>(selector: string): T => {
    const found = document.body.querySelector<T>(selector);
    if (found === null) throw new Error(`没有 ${selector}`);
    return found;
};

/** 点“更改…”，在选择器里双击进入 `entry`（给了的话），再点“选定”。 */
async function choose(entry: string | null): Promise<void> {
    one<HTMLButtonElement>("[data-works-library-change]").click();
    await flushPromises();
    if (entry !== null) {
        one(`[data-file-browser-entry='${entry}']`).dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
        await flushPromises();
    }
    one<HTMLButtonElement>("[data-path-picker-confirm]").click();
    await flushPromises();
}

describe("WorksSettingsPage", () => {
    it("没设：显示缺省的作品目录并标“缺省”，没有已修改标记；“更改…”从缺省的作品目录开始", async () => {
        const {listed} = open({});
        await flushPromises();
        expect(one("[data-works-library]").textContent).toBe(`${LIBRARY}（缺省）`);
        expect(document.body.querySelector("[data-works-library-default]")).not.toBeNull();
        expect(document.body.querySelector("[data-settings-row-modified]")).toBeNull();
        one<HTMLButtonElement>("[data-works-library-change]").click();
        await flushPromises();
        expect(document.body.querySelector("[data-path-picker]")).not.toBeNull();
        expect(listed).toEqual([null]);
    });

    it("选定一个目录：写进用户层，显示这个路径并带已修改标记；再点“更改…”从它开始；恢复默认删掉这个键", async () => {
        const {host, listed, notices} = open({});
        await choose(`${LIBRARY}/drafts`);
        expect(document.body.querySelector("[data-path-picker]")).toBeNull();
        expect(host.user.values()).toEqual({[librarySetting.key]: `${LIBRARY}/drafts`});
        expect(one("[data-works-library]").textContent).toBe(`${LIBRARY}/drafts`);
        expect(document.body.querySelector("[data-settings-row-modified]")).not.toBeNull();
        expect(notices).toEqual([]);

        one<HTMLButtonElement>("[data-works-library-change]").click();
        await flushPromises();
        expect(listed.at(-1)).toBe(`${LIBRARY}/drafts`);
        one<HTMLButtonElement>("[data-path-picker-confirm]").click();
        await flushPromises();

        one<HTMLButtonElement>("[data-settings-row-reset]").click();
        await flushPromises();
        expect(host.user.values()).toEqual({});
        expect(one("[data-works-library]").textContent).toBe(`${LIBRARY}（缺省）`);
    });

    it("没设又取不到缺省目录：写一句“取不到缺省目录”，“更改…”照常可用", async () => {
        open({}, false);
        await flushPromises();
        expect(one("[data-works-library]").textContent).toBe("取不到缺省目录");
        expect(document.body.querySelector("[data-works-library-default-unknown]")).not.toBeNull();
        const change = one<HTMLButtonElement>("[data-works-library-change]");
        expect(change.disabled).toBe(false);
        change.click();
        await flushPromises();
        expect(document.body.querySelector("[data-path-picker]")).not.toBeNull();
    });

    it("写不进去：发通知“作品目录没有记住”，路径回到层里的实际值", async () => {
        const {host, notices, text} = open({values: {[librarySetting.key]: `${HOME}/books`}});
        host.user.failWrites("write-failed");
        await choose(`${HOME}/books/2026`);
        expect(host.user.values()).toEqual({[librarySetting.key]: `${HOME}/books`});
        expect(one("[data-works-library]").textContent).toBe(`${HOME}/books`);
        expect(notices).toHaveLength(1);
        expect(notices[0]?.tone).toBe("warning");
        // 通知交文字引用，视口显示时才翻：同一条通知切换语言后换成英文。
        const shown = () => ({title: text.port.t(notices[0]?.title ?? ""), message: text.port.t(notices[0]?.message ?? "")});
        expect(shown().title).toBe("作品目录没有记住");
        expect(shown().message).toContain("作品目录没有写进设置：write-failed");
        text.setLocale("en-US");
        expect(shown().title).toBe("Library folder not saved");
        expect(shown().message).toContain("The library folder was not written to settings: write-failed");
    });

    it("设置文件有错误：“更改…”停用", () => {
        open({values: {[librarySetting.key]: `${HOME}/books`}, invalid: "第 3 行：缺少逗号"});
        expect(one<HTMLButtonElement>("[data-works-library-change]").disabled).toBe(true);
    });
});
