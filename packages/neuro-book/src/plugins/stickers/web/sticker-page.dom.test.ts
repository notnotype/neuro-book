/**
 * 设置里的“表情包”页（docs/specs/agent/stickers.md 输出 25 到 34）：页面状态、左栏与头部、网格分组与键盘、属性栏的保存规则、
 * 删除确认与焦点、新建与改包名对话框、导入同名的选择、拖放兜底与只读的包。组件用写死的数据与记录调用的回调摆出来，取数写入的逻辑
 * 在 `packs-page.test.ts` 里测。网格上下方向键要布局，happy-dom 没有，在 e2e 里测。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {provideText} from "nbook/shared/testing/text-port";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import type {StickerPackDetail, StickerPackSummary} from "../shared/contracts";
import StickerPacksPage from "./components/StickerPacksPage.vue";
import {stickersCatalogs} from "./text";

const cleanup: Array<() => void> = [];
afterEach(() => {
    for (const dispose of cleanup.splice(0)) dispose();
    document.body.innerHTML = "";
});

const summary = (id: string, extra: Partial<StickerPackSummary> = {}): StickerPackSummary => ({
    id, folder: id.slice(id.lastIndexOf(".") + 1), source: "user", title: id.slice(id.lastIndexOf(".") + 1), status: "ok", count: 3, thumbnail: `/img/${id}.png`, unrecognized: 0, unlisted: 0, ...extra,
});
const PLUGIN = summary("acme.cute.mochi", {source: "plugin", plugin: {id: "acme.cute", title: "可爱表情包"}, title: "麻薯"});
const LYRA = summary("user.lyra", {title: "星璃", description: "星璃的表情", count: 4, unrecognized: 1, unlisted: 1});
const CAT = summary("user.cat", {count: 0, thumbnail: null});

/** 清单里写了名字的表情（`raw` 是写的原样）；`raw: undefined` 是清单里省略名字的。 */
const sticker = (name: string, common: boolean, extra: Record<string, unknown> = {}) => ({name, raw: name, file: `${name}.png`, common, width: 8, height: 8, bytes: 1024, url: `/img/${name}.png`, ...extra});
const extra = (file: string, reason: "name" | "unlisted", raw: string | null = null) => ({file, reason, raw, width: 8, height: 8, bytes: 1024, url: `/img/${file}`});
const lyraDetail = (): StickerPackDetail => ({
    summary: LYRA, listed: true, token: "tok",
    stickers: [sticker("开心", true, {description: "被夸的时候"}), sticker("害羞", true, {raw: undefined}), sticker("困", false)],
    extras: [extra("1.png", "name"), extra("新.png", "unlisted")],
});
const pluginDetail = (): StickerPackDetail => ({summary: PLUGIN, listed: true, token: null, stickers: [sticker("好耶", true)], extras: []});
const catDetail = (): StickerPackDetail => ({summary: CAT, listed: false, token: "tok", stickers: [], extras: []});

interface Calls {
    readonly list: string[];
}

function show(props: Record<string, unknown> = {}) {
    const text = createHostTextEngine({locale: "zh-CN", strict: true});
    text.register("nbook.stickers", stickersCatalogs.catalogs, stickersCatalogs.source);
    const calls: Calls & Record<string, unknown[][]> = {list: [], create: [], rename: [], copy: [], importZip: [], updatePack: [], updateSticker: [], deletePack: [], deleteSticker: [], deleteFile: [], listFiles: []} as never;
    const record = (name: string, result: unknown) => async (...args: unknown[]) => {
        calls[name]!.push(args);
        return typeof result === "function" ? (result as (...inner: unknown[]) => unknown)(...args) : result;
    };
    const wrapper = mount(StickerPacksPage, {
        props: {
            state: "ready",
            packs: [CAT, LYRA, PLUGIN],
            selected: "user.lyra",
            detail: lyraDetail(),
            createPack: record("create", {id: "user.new"}),
            renamePack: record("rename", {id: "user.renamed"}),
            copyPack: record("copy", {id: "user.mochi"}),
            importZip: record("importZip", {id: "user.cat"}),
            updatePack: record("updatePack", null),
            updateSticker: record("updateSticker", null),
            deletePack: record("deletePack", null),
            deleteSticker: record("deleteSticker", null),
            deleteFile: record("deleteFile", null),
            listFiles: record("listFiles", null),
            allowlistUsage: async () => ["剧情问答"],
            ...props,
        } as never,
        attachTo: document.body,
        global: {provide: provideText(text.port)},
    });
    cleanup.push(() => wrapper.unmount());
    const root = wrapper.element as HTMLElement;
    return {wrapper, root, calls};
}

const tile = (root: ParentNode, name: string): HTMLElement => [...root.querySelectorAll<HTMLElement>("[data-grid-key]")].find((element) => element.title === name)!;
const buttonIn = (root: Element, label: string): HTMLButtonElement => [...root.querySelectorAll("button")].find((button) => button.textContent?.trim() === label) as HTMLButtonElement;
const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
    input.value = value;
    input.dispatchEvent(new Event("input"));
    await flushPromises();
};

describe("页面状态与左栏", () => {
    it("读取中与读失败（带重试）；没有任何表情包时是空页，能新建与导入", async () => {
        const loading = show({state: "loading", packs: [], selected: null, detail: null});
        expect(loading.root.querySelector("[data-sticker-loading]")).not.toBeNull();
        const failed = show({state: {failed: "unavailable"}, packs: [], selected: null, detail: null});
        expect(failed.root.querySelector("[data-sticker-load-failed]")?.textContent).toContain("unavailable");
        await failed.wrapper.get("[data-sticker-retry]").trigger("click");
        expect(failed.wrapper.emitted("retry")).toHaveLength(1);
        const empty = show({packs: [], selected: null, detail: null});
        expect(empty.root.querySelector("[data-sticker-empty-page]")?.textContent).toContain("还没有表情包");
        expect(empty.root.querySelector("[data-sticker-create]")).not.toBeNull();
        expect(empty.root.querySelector("[data-sticker-import]")).not.toBeNull();
    });

    it("“我的”在前、插件各一组；一行是缩略图（没有时是图标）、名字、表情数，有认不出的图与无效的有图标；点一行发出选中", async () => {
        const {wrapper, root} = show({packs: [PLUGIN, LYRA, CAT, summary("user.bad", {status: "invalid", problem: "manifest-invalid", count: 0, thumbnail: null})]});
        const items = [...root.querySelectorAll<HTMLElement>("[data-sticker-rail-item]")].map((element) => element.dataset.stickerRailItem);
        expect(items).toEqual(["user.bad", "user.cat", "user.lyra", "acme.cute.mochi"]);
        expect(root.querySelector("[data-sticker-rail-item='user.lyra'] [data-sticker-rail-flag='problem']")).not.toBeNull();
        expect(root.querySelector("[data-sticker-rail-item='user.bad'] [data-sticker-rail-flag='invalid']")).not.toBeNull();
        expect(root.querySelector("[data-sticker-rail-item='user.cat'] img")).toBeNull();
        expect(root.querySelector("[data-sticker-rail]")?.textContent).toContain("可爱表情包");
        await wrapper.get("[data-sticker-rail-item='acme.cute.mochi']").trigger("click");
        expect(wrapper.emitted("select")).toEqual([["acme.cute.mochi"]]);
    });

    it("左栏的方向键移动并选中（只有当前项在 Tab 序里）", async () => {
        const {wrapper, root} = show();
        expect(root.querySelector("[data-sticker-rail-item='user.lyra']")?.getAttribute("tabindex")).toBe("0");
        expect(root.querySelector("[data-sticker-rail-item='user.cat']")?.getAttribute("tabindex")).toBe("-1");
        await wrapper.get("[data-sticker-rail-item='user.lyra']").trigger("keydown", {key: "ArrowDown"});
        expect(wrapper.emitted("select")).toEqual([["acme.cute.mochi"]]);
    });
});

describe("头部与网格", () => {
    it("头部写显示名与说明；导出与更多；网格按认不出、常用、其他、没加进来分组，选中键是文件名加名字", async () => {
        const {wrapper, root} = show();
        expect(root.querySelector(".sticker-head")?.textContent).toContain("星璃的表情");
        await wrapper.get("[data-sticker-export]").trigger("click");
        expect(wrapper.emitted("export")).toEqual([["user.lyra"]]);
        const groups = [...root.querySelectorAll<HTMLElement>("[data-sticker-group]")].map((element) => [element.dataset.stickerGroup, [...element.querySelectorAll<HTMLElement>("[role='option']")].map((option) => option.title)]);
        expect(groups).toEqual([["problem", ["1.png"]], ["common", ["开心", "害羞"]], ["other", ["困"]], ["unlisted", ["新.png"]]]);
        expect(root.querySelector("[data-sticker-group='other'] [data-sticker-add]")).not.toBeNull();
        expect(root.querySelectorAll("[role='listbox']")).toHaveLength(4);
        // 格子里的图 alt 为空（名字在下面的文字里）。
        expect(root.querySelector("[role='option'] img")?.getAttribute("alt")).toBe("");
    });

    it("还没选格子时属性栏是表情包自己的；点格子换成表情的，返回按钮与 Esc 回来", async () => {
        const {wrapper, root} = show();
        expect(root.querySelector("[data-pack-fields]")).not.toBeNull();
        await wrapper.get("[data-grid-key^='s:开心']").trigger("click");
        expect(root.querySelector("[data-sticker-fields]")).not.toBeNull();
        expect((root.querySelector("[data-sticker-name] input, input[data-sticker-name]") as HTMLInputElement).value).toBe("开心");
        expect(root.querySelector("[data-sticker-syntax]")?.textContent).toBe(":lyra/开心:");
        await wrapper.get("[data-sticker-back]").trigger("click");
        expect(root.querySelector("[data-pack-fields]")).not.toBeNull();
        await wrapper.get("[data-grid-key^='s:开心']").trigger("click");
        await wrapper.get("[data-grid-key^='s:开心']").trigger("keydown", {key: "Escape"});
        expect(root.querySelector("[data-pack-fields]")).not.toBeNull();
    });

    it("焦点即选中：左右方向键按顺序跨组移动，Home、End 到头尾；只有一个格子在 Tab 序里", async () => {
        const {wrapper, root} = show();
        await wrapper.get("[data-grid-key^='s:开心']").trigger("click");
        expect(root.querySelectorAll("[role='option'][tabindex='0']")).toHaveLength(1);
        await wrapper.get("[data-grid-key^='s:开心']").trigger("keydown", {key: "ArrowRight"});
        expect(tile(root, "害羞").getAttribute("aria-selected")).toBe("true");
        await tile(root, "害羞").dispatchEvent(new KeyboardEvent("keydown", {key: "End", bubbles: true}));
        await flushPromises();
        expect(tile(root, "新.png").getAttribute("aria-selected")).toBe("true");
        await tile(root, "新.png").dispatchEvent(new KeyboardEvent("keydown", {key: "Home", bubbles: true}));
        await flushPromises();
        expect(tile(root, "1.png").getAttribute("aria-selected")).toBe("true");
    });

    it("认不出的图：属性栏要求先改名（输入框标红、写出规则），说明与常用不可用，没有写法", async () => {
        const {wrapper, root} = show();
        await wrapper.get("[data-grid-key='e:1.png']").trigger("click");
        expect(root.querySelector("[data-sticker-status]")?.textContent).toContain("字母或 _ 开头");
        expect(root.querySelector("textarea[data-sticker-description], [data-sticker-description] textarea")?.hasAttribute("disabled")).toBe(true);
        expect(root.querySelector("[data-sticker-syntax]")).toBeNull();
    });

    it("没加进来的图：只有“加进来”与“删除文件”；点“加进来”与“全部加进来”调用 listFiles", async () => {
        const {wrapper, root, calls} = show();
        await wrapper.get("[data-sticker-list-all]").trigger("click");
        await flushPromises();
        expect(calls.listFiles).toEqual([["user.lyra", "all"]]);
        await wrapper.get("[data-grid-key='e:新.png']").trigger("click");
        expect(root.querySelector("[data-sticker-name]")).toBeNull();
        expect(root.querySelector("[data-sticker-delete]")?.textContent).toContain("删除文件");
        await wrapper.get("[data-sticker-list]").trigger("click");
        await flushPromises();
        expect(calls.listFiles[1]).toEqual(["user.lyra", ["新.png"]]);
    });

    it("空的表情包整个网格是落点，点开选文件；“添加”格单独一行", async () => {
        const {root} = show({packs: [CAT], selected: "user.cat", detail: catDetail()});
        expect(root.querySelector("[data-sticker-empty]")?.textContent).toContain("拖进图片");
    });
});

describe("属性栏的保存", () => {
    const nameInput = (root: HTMLElement) => root.querySelector("input[data-sticker-name]") as HTMLInputElement;

    it("离开输入框保存，带提交那一刻的目标；值没变不保存；回车后紧接着离开只保存一次", async () => {
        const {wrapper, root, calls} = show();
        await wrapper.get("[data-grid-key^='s:开心']").trigger("click");
        nameInput(root).dispatchEvent(new Event("focus"));
        nameInput(root).dispatchEvent(new Event("blur"));
        await flushPromises();
        expect(calls.updateSticker).toEqual([]);
        await type(nameInput(root), "笑");
        nameInput(root).dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        nameInput(root).dispatchEvent(new Event("blur"));
        await flushPromises();
        expect(calls.updateSticker).toEqual([["user.lyra", {file: "开心.png", name: "开心"}, {name: "笑"}]]);
    });

    it("保存失败：输入框回到目录里的值，状态行写原因", async () => {
        const {wrapper, root} = show({updateSticker: async () => ({reason: "已经有表情用了这个名字。"})});
        await wrapper.get("[data-grid-key^='s:开心']").trigger("click");
        await type(nameInput(root), "害羞");
        nameInput(root).dispatchEvent(new Event("blur"));
        await flushPromises();
        expect(nameInput(root).value).toBe("开心");
        expect(root.querySelector("[data-sticker-status]")?.textContent).toContain("已经有表情用了这个名字");
    });

    it("Esc 还原正在输入的名字；常用开关立即保存", async () => {
        const {wrapper, root, calls} = show();
        await wrapper.get("[data-grid-key^='s:开心']").trigger("click");
        await type(nameInput(root), "笑");
        nameInput(root).dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await flushPromises();
        expect(nameInput(root).value).toBe("开心");
        await wrapper.get("[data-sticker-common]").trigger("click");
        await flushPromises();
        expect(calls.updateSticker.at(-1)).toEqual(["user.lyra", {file: "开心.png", name: "开心"}, {common: false}]);
    });

    it("表情包自己的显示名离开输入框保存", async () => {
        const {root, calls} = show();
        const title = root.querySelector("input[data-pack-title]") as HTMLInputElement;
        await type(title, "星璃的店");
        title.dispatchEvent(new Event("blur"));
        await flushPromises();
        expect(calls.updatePack).toEqual([["user.lyra", {title: "星璃的店"}]]);
    });
});

describe("删除", () => {
    const alert = () => document.body.querySelector("[role='alertdialog']");

    it("网格里按 Delete 先确认（写名字），确认后删这一项并让焦点到下一格", async () => {
        const {wrapper, root, calls} = show();
        await wrapper.get("[data-grid-key^='s:害羞']").trigger("click");
        await wrapper.get("[data-grid-key^='s:害羞']").trigger("keydown", {key: "Delete"});
        await waitUntil("确认框", () => alert() !== null);
        expect(alert()!.textContent).toContain("害羞");
        buttonIn(alert()!, "取消").click();
        await waitUntil("确认框关掉", () => alert() === null);
        expect(calls.deleteSticker).toEqual([]);
        await wrapper.get("[data-grid-key^='s:害羞']").trigger("keydown", {key: "Delete"});
        await waitUntil("确认框", () => alert() !== null);
        buttonIn(alert()!, "删除").click();
        await waitUntil("删了", () => calls.deleteSticker.length === 1);
        expect(calls.deleteSticker).toEqual([["user.lyra", {file: "害羞.png", name: null}]]);
        // 焦点与选中落到下一格（这里替身没有真的删，目录里它还在）。
        await waitUntil("选中下一格", () => tile(root, "困").getAttribute("aria-selected") === "true" || null);
        expect(document.activeElement).toBe(tile(root, "困"));
    });

    it("没加进来的图删文件；删表情包带名字与个数的确认", async () => {
        const {wrapper, calls} = show();
        await wrapper.get("[data-grid-key='e:新.png']").trigger("click");
        await wrapper.get("[data-sticker-delete]").trigger("click");
        await waitUntil("确认框", () => alert() !== null);
        buttonIn(alert()!, "删除").click();
        await waitUntil("删了文件", () => calls.deleteFile.length === 1);
        expect(calls.deleteFile).toEqual([["user.lyra", "新.png"]]);

        await waitUntil("确认框关掉", () => alert() === null);
        await wrapper.get("[data-sticker-more]").trigger("click");
        await waitUntil("菜单", () => document.body.querySelector("[role='menu']") !== null);
        const item = [...document.body.querySelectorAll("[role='menuitem']")].find((element) => element.textContent?.includes("删除表情包")) as HTMLElement;
        item.click();
        await waitUntil("确认框", () => alert() !== null);
        expect(alert()!.textContent).toContain("星璃");
        expect(alert()!.textContent).toContain("4 个表情");
        buttonIn(alert()!, "删除").click();
        await waitUntil("删了包", () => calls.deletePack.length === 1);
        expect(calls.deletePack).toEqual([["user.lyra"]]);
    });
});

describe("新建与改包名", () => {
    const dialog = () => document.body.querySelector("[data-sticker-name-dialog]");

    it("新建：包名不合规则提交后才标红；已被用的原因写在对话框里；成功关掉", async () => {
        let attempt = 0;
        const {wrapper, calls} = show({createPack: async (...args: unknown[]) => {
            calls_push("create", args);
            attempt += 1;
            return attempt === 1 ? {reason: "已经有同名的表情包。"} : {id: "user.cat2"};
        }});
        function calls_push(name: string, args: unknown[]): void {
            created.push([name, ...args]);
        }
        const created: unknown[][] = [];
        await wrapper.get("[data-sticker-rail] [data-sticker-create]").trigger("click");
        await waitUntil("对话框", () => dialog() !== null);
        const folder = () => dialog()!.querySelector("input[data-sticker-folder]") as HTMLInputElement;
        await type(folder(), "Cat Bad");
        expect(dialog()!.textContent).not.toContain("小写字母");
        buttonIn(dialog()!, "新建").click();
        await flushPromises();
        expect(dialog()!.textContent).toContain("小写字母");
        expect(created).toEqual([]);
        await type(folder(), "cat");
        buttonIn(dialog()!, "新建").click();
        await waitUntil("写出原因", () => dialog()!.textContent?.includes("同名") === true);
        buttonIn(dialog()!, "新建").click();
        await waitUntil("关掉", () => dialog() === null);
        expect(created.map((entry) => entry.slice(1))).toEqual([["cat", ""], ["cat", ""]]);
        expect(calls.create).toEqual([]);
    });

    it("改包名：写警示与用到它的 Profile，提交带新包名；查不到 Profile 写通用提醒", async () => {
        const {wrapper, calls} = show();
        await wrapper.get("[data-pack-rename]").trigger("click");
        await waitUntil("对话框", () => dialog() !== null);
        expect(dialog()!.textContent).toContain("用旧包名写的表情会认不出来");
        expect(dialog()!.textContent).toContain(":lyra/…:");
        await waitUntil("名单", () => dialog()!.querySelector("[data-sticker-usage]")?.textContent?.includes("剧情问答") === true);
        const folder = dialog()!.querySelector("input[data-sticker-folder]") as HTMLInputElement;
        expect(folder.value).toBe("lyra");
        await type(folder, "xingli");
        buttonIn(dialog()!, "改成 xingli").click();
        await waitUntil("提交", () => calls.rename.length === 1);
        expect(calls.rename).toEqual([["user.lyra", "xingli"]]);
    });

    it("没有 Profile 用它时不写名单；Agent 查不到时写通用提醒", async () => {
        const none = show({allowlistUsage: async () => []});
        await none.wrapper.get("[data-pack-rename]").trigger("click");
        await waitUntil("对话框", () => dialog() !== null);
        await waitUntil("查完", () => dialog()!.querySelector("[data-sticker-usage]") === null);
        none.wrapper.unmount();
        await waitUntil("对话框关掉", () => dialog() === null);
        const unknown = show({allowlistUsage: async () => null});
        await unknown.wrapper.get("[data-pack-rename]").trigger("click");
        await waitUntil("通用提醒", () => dialog()?.querySelector("[data-sticker-usage]")?.textContent?.includes("重新勾选") === true);
    });
});

describe("导入", () => {
    const conflictDialog = () => document.body.querySelector("[data-sticker-conflict]");
    const zip = new File([new Uint8Array([1, 2, 3])], "cat.zip", {type: "application/zip"});
    const choose = async (wrapper: ReturnType<typeof show>["wrapper"], file: File) => {
        const input = wrapper.get("[data-sticker-zip]").element as HTMLInputElement;
        Object.defineProperty(input, "files", {value: [file], configurable: true});
        await wrapper.get("[data-sticker-zip]").trigger("change");
        await flushPromises();
    };
    const info = {existing: {id: "user.cat", title: "猫", count: 3, files: ["a.png"], token: "tok"}, copyAs: "cat-2"};

    it("选 zip 导入；同名时开对话框，选“另存”带 copy，选“替换”带令牌，失败留在对话框里写原因", async () => {
        const responses: unknown[] = [{conflict: info}, {reason: "太忙了"}, {id: "user.cat-2"}];
        const {wrapper, calls} = show({importZip: async (...args: unknown[]) => {
            calls_import.push(args);
            return responses.shift();
        }, previewZip: async () => ({title: "猫猫", count: 12, items: [{url: "/p/1.png", label: "1.png"}]})});
        const calls_import: unknown[][] = [];
        await choose(wrapper, zip);
        await waitUntil("冲突对话框", () => conflictDialog() !== null);
        expect(conflictDialog()!.textContent).toContain("包名是 cat");
        expect(conflictDialog()!.textContent).toContain("12 个表情");
        expect(conflictDialog()!.textContent).toContain("3 个表情");
        buttonIn(conflictDialog()!, "另存为 cat-2").click();
        await waitUntil("写出失败原因", () => conflictDialog()!.textContent?.includes("太忙了") === true);
        buttonIn(conflictDialog()!, "另存为 cat-2").click();
        await waitUntil("关掉", () => conflictDialog() === null);
        expect(calls_import).toEqual([[zip], [zip, {mode: "copy"}], [zip, {mode: "copy"}]]);
        expect(calls.importZip).toEqual([]);
    });

    it("替换带已有的包的令牌", async () => {
        const responses: unknown[] = [{conflict: info}, {id: "user.cat"}];
        const seen: unknown[][] = [];
        const {wrapper} = show({importZip: async (...args: unknown[]) => {
            seen.push(args);
            return responses.shift();
        }});
        await choose(wrapper, zip);
        await waitUntil("冲突对话框", () => conflictDialog() !== null);
        buttonIn(conflictDialog()!, "替换已有的").click();
        await waitUntil("关掉", () => conflictDialog() === null);
        expect(seen[1]).toEqual([zip, {mode: "replace", token: "tok"}]);
    });
});

describe("拖放与只读的包", () => {
    /** 拖动事件：happy-dom 没有 DragEvent 的 dataTransfer，自己挂一个。 */
    function drag(type: "dragover" | "drop", target: EventTarget, files: File[] = []): {event: Event; transfer: {dropEffect: string}} {
        const transfer = {types: ["Files"], items: files.length === 0 ? [{}] : files.map(() => ({})), files, dropEffect: ""};
        const event = new Event(type, {bubbles: true, cancelable: true});
        Object.assign(event, {dataTransfer: transfer});
        target.dispatchEvent(event);
        return {event, transfer};
    }

    it("落在网格上收（发出添加）；落在别处也 preventDefault（浏览器不导航）但不收，dropEffect 是 none", async () => {
        const {wrapper, root} = show();
        const image = new File([new Uint8Array([1])], "a.png", {type: "image/png"});
        const over = drag("dragover", root.querySelector("[data-sticker-dropzone]")!);
        expect(over.event.defaultPrevented).toBe(true);
        expect(over.transfer.dropEffect).toBe("copy");
        await flushPromises();
        expect(root.querySelector("[data-sticker-drop]")).not.toBeNull();
        const outside = drag("dragover", root.querySelector(".sticker-head")!);
        expect(outside.event.defaultPrevented).toBe(true);
        expect(outside.transfer.dropEffect).toBe("none");
        expect(drag("drop", root.querySelector(".sticker-head")!, [image]).event.defaultPrevented).toBe(true);
        expect(wrapper.emitted("add-images")).toBeUndefined();
        drag("drop", root.querySelector("[data-sticker-dropzone]")!, [image]);
        expect(wrapper.emitted("add-images")).toEqual([["user.lyra", [image]]]);
        await flushPromises();
        expect(root.querySelector("[data-sticker-drop]")).toBeNull();
    });

    it("页面内部元素的拖动（没有文件）不管", () => {
        const {root} = show();
        const event = new Event("dragover", {bubbles: true, cancelable: true});
        Object.assign(event, {dataTransfer: {types: ["text/plain"], items: [], files: [], dropEffect: ""}});
        root.querySelector("[data-sticker-dropzone]")!.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
    });

    it("插件的包：只读（没有“添加”格、不收拖放、名字是文字），能导出、能复制到我的", async () => {
        const {wrapper, root, calls} = show({selected: "acme.cute.mochi", detail: pluginDetail()});
        expect(root.querySelector("[data-sticker-add]")).toBeNull();
        expect(root.querySelector("[data-sticker-copy]")).not.toBeNull();
        expect(root.querySelector("[data-sticker-export]")).not.toBeNull();
        const over = drag("dragover", root.querySelector("[data-sticker-dropzone]")!);
        expect(over.transfer.dropEffect).toBe("none");
        drag("drop", root.querySelector("[data-sticker-dropzone]")!, [new File([new Uint8Array([1])], "a.png", {type: "image/png"})]);
        expect(wrapper.emitted("add-images")).toBeUndefined();
        await wrapper.get("[data-grid-key^='s:好耶']").trigger("click");
        // Delete 键在只读的包里不开确认框。
        await wrapper.get("[data-grid-key^='s:好耶']").trigger("keydown", {key: "Delete"});
        await flushPromises();
        expect(document.body.querySelector("[role='alertdialog']")).toBeNull();
        expect(root.querySelector("input[data-sticker-name]")).toBeNull();
        expect(root.querySelector("[data-sticker-delete]")).toBeNull();
        await wrapper.get("[data-sticker-copy]").trigger("click");
        await flushPromises();
        expect(calls.copy).toEqual([["acme.cute.mochi"]]);
    });

    it("无效的表情包：右边写原因，没有“导出”", () => {
        const {root} = show({packs: [summary("user.bad", {status: "invalid", problem: "manifest-invalid", count: 0, thumbnail: null})], selected: "user.bad", detail: null});
        expect(root.querySelector("[data-sticker-invalid]")?.textContent).toContain("manifest-invalid");
        expect(root.querySelector("[data-sticker-export]")).toBeNull();
    });
});

describe("上传中", () => {
    it("这个包正在传的图在网格末尾显示占位格，别的包的不显示", () => {
        const {root} = show({uploads: [{id: 1, packId: "user.lyra", name: "a.png", state: "running"}, {id: 2, packId: "user.cat", name: "b.png", state: "waiting"}]});
        const placeholders = root.querySelectorAll("[data-sticker-uploading]");
        expect(placeholders).toHaveLength(1);
        expect(placeholders[0]!.textContent).toContain("a.png");
    });
});
