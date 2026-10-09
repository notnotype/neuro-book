/**
 * FilesExplorerView 的动作界面（同名 .md 与 ExplorerRow、ExplorerFeedback 的 .md）：内联输入的按键与输入法组字、错误的
 * 关联、右键菜单按菜单项发出命令、删除确认框默认在取消上、展示名对话框、碰撞对话框各按钮、结果区的逐项结果、进行中
 * 与结果未知、剪切标记。行数据由真实的投影
 * 算出，菜单项由真实的 `menuEntries` 算出。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import type {DirectoryEntry, Listing} from "nbook/plugins/files/shared/contracts";

import type {Availability, Dialog, OperationReport, Unknown} from "../controller";
import {menuEntries} from "../menu";
import type {DirectorySlot, RootState} from "../tree/model";
import {creatingId, projectRows} from "../tree/rows";
import type {EntryRow} from "../tree/rows";
import FilesExplorerView from "./FilesExplorerView.vue";

const ROOTS: RootState[] = [
    {scheme: "project", address: "project://", status: {kind: "live"}},
    {scheme: "user", address: "user://", status: {kind: "live"}},
];
const loaded = (listing: Listing): DirectorySlot => ({listing, error: null, loading: false, stale: false});
const dir = (name: string, extra: Partial<DirectoryEntry> = {}): DirectoryEntry => ({name, kind: "directory", ...extra});

const SLOTS = new Map<string, DirectorySlot>([
    ["project://", loaded({folder: "plain", contentRoot: null, entries: [dir("lore.content", {folder: "content"}), dir("plain"), {name: "a.md", kind: "file"}]})],
    ["project://lore.content", loaded({folder: "content", contentRoot: "lore.content", manifest: {status: "ok"}, entries: [dir("alice", {title: "爱丽丝", listed: true, body: false}), {name: "gone", kind: "missing", listed: true}]})],
]);

const rows = (creating: {parent: string; entry: "file" | "directory"; before: string | null} | null = null) => projectRows({roots: ROOTS, slots: SLOTS, expanded: new Set(["project://", "project://lore.content"]), showManifests: false, creating});

const ALL: Availability = {create: true, rename: true, delete: true, createContent: true, convert: true, display: true, include: true, drop: true, moveUp: true, moveDown: false, copy: true, cut: true, paste: false};

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

function view(props: Record<string, unknown> = {}) {
    const wrapper = mount(FilesExplorerView, {props: {locale: "zh-CN", rows: rows(), selected: [], focus: null, showManifests: false, ready: true, notice: null, problem: null, handleKey: () => "none" as const, ...props}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}

describe("FilesExplorerView：内联输入", () => {
    it("新建的输入行挂上即获得焦点；Enter 提交、Escape 取消且不冒泡；输入法组字中的 Enter 不提交；输入交给宿主", async () => {
        const wrapper = view({rows: rows({parent: "project://lore.content", entry: "file", before: "gone"}), editing: {id: creatingId("project://lore.content"), name: "", error: null, busy: false}});
        await flushPromises();
        const input = wrapper.get("[data-explorer-edit] input");
        expect(document.activeElement).toBe(input.element);
        expect(input.attributes("aria-label")).toBe("新文件的名字");
        const order = wrapper.findAll("[data-explorer-row], [data-explorer-edit]").map((item) => item.attributes("data-explorer-row") ?? "edit");
        expect(order.indexOf("edit")).toBe(order.indexOf("project://lore.content/gone") - 1);

        await input.setValue("新章");
        expect(wrapper.emitted("edit-input")).toEqual([["新章"]]);
        input.element.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", isComposing: true, bubbles: true}));
        expect(wrapper.emitted("edit-commit")).toBeUndefined();
        await input.trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("edit-commit")).toHaveLength(1);
        const escape = new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true});
        let reachedTree = false;
        wrapper.get("[role=tree]").element.addEventListener("keydown", () => {
            reachedTree = true;
        });
        input.element.dispatchEvent(escape);
        expect(wrapper.emitted("edit-cancel")).toHaveLength(1);
        expect(reachedTree).toBe(false);
    });

    it("改名：已显示的资源行换成输入框并拿到焦点；提交中只读不禁用，焦点留在框里；错误原位显示并与输入框关联", async () => {
        const wrapper = view();
        await flushPromises();
        await wrapper.setProps({editing: {id: "project://a.md", name: "a.md", error: null, busy: false}});
        await flushPromises();
        const input = wrapper.get("[data-explorer-edit=\"project://a.md\"] input");
        expect(document.activeElement).toBe(input.element);
        await wrapper.setProps({editing: {id: "project://a.md", name: "b.md", error: null, busy: true}});
        expect((input.element as HTMLInputElement).readOnly).toBe(true);
        expect((input.element as HTMLInputElement).disabled).toBe(false);
        expect(document.activeElement).toBe(input.element);
        await wrapper.setProps({editing: {id: "project://a.md", name: "a.md", error: "已存在同名项", busy: false}});
        await flushPromises();
        const editing = wrapper.get("[data-explorer-edit=\"project://a.md\"]");
        expect(editing.attributes("role")).toBe("treeitem");
        // 改名的行仍带完整的同层位置；输入框有说明在改哪个资源的名称。
        expect(editing.attributes()).toMatchObject({"aria-posinset": "3", "aria-setsize": "3", "aria-description": "project://a.md"});
        expect(input.attributes("aria-label")).toBe("重命名 a.md");
        const error = wrapper.get("[data-explorer-input-error]");
        expect(error.text()).toBe("已存在同名项");
        expect(error.attributes("role")).toBe("alert");
        expect(wrapper.get("[data-explorer-edit] [aria-describedby]").attributes("aria-describedby")).toBe(error.attributes("id"));
    });
});

describe("FilesExplorerView：右键菜单", () => {
    it("资源行的菜单按可用性列出动作，点一项发出它的命令；根行只有新建", async () => {
        const alice = rows().find((row) => row.id === "project://lore.content/alice") as EntryRow;
        const wrapper = view({menu: {x: 10, y: 20, entries: menuEntries(alice, ALL, "zh-CN")}});
        await flushPromises();
        const labels = [...document.querySelectorAll("[role=menuitem]")].map((item) => item.textContent?.trim());
        expect(labels).toEqual(["新建文件", "新建文件夹", "剪切Ctrl+X", "复制Ctrl+C", "粘贴Ctrl+V", "重命名F2", "创建内容", "修改展示名与图标", "上移Alt+↑", "下移Alt+↓", "删除Delete"]);
        const down = [...document.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].find((item) => item.textContent?.includes("下移"));
        expect(down?.disabled).toBe(true);
        [...document.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].find((item) => item.textContent?.includes("创建内容"))?.click();
        expect(wrapper.emitted("menu-command")).toEqual([["nbook.files.create-content"]]);
        expect(wrapper.emitted("menu-close")).toHaveLength(1);

        const root = rows().find((row) => row.id === "project://");
        expect(menuEntries(root!, ALL, "zh-CN").map((entry) => (entry.kind === "item" ? entry.command : "-"))).toEqual(["nbook.files.new-file", "nbook.files.new-folder", "-", "nbook.files.paste"]);
        const gone = rows().find((row) => row.id === "project://lore.content/gone") as EntryRow;
        expect(menuEntries(gone, ALL, "zh-CN").map((entry) => (entry.kind === "item" ? entry.command : "-"))).toContain("nbook.files.drop-entry");
    });

    it("Tab 关闭菜单、焦点回到树；点菜单外关闭时焦点留在被点的按钮上", async () => {
        const alice = rows().find((row) => row.id === "project://lore.content/alice") as EntryRow;
        const menu = {x: 10, y: 20, entries: menuEntries(alice, ALL, "zh-CN")};
        // 菜单在打开（visible 变真）时聚焦首项，所以先挂上再打开。
        const wrapper = view();
        await flushPromises();
        await wrapper.setProps({menu});
        await flushPromises();
        expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
        const tab = new KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true});
        document.activeElement?.dispatchEvent(tab);
        await flushPromises();
        expect(tab.defaultPrevented).toBe(true);
        expect(wrapper.emitted("menu-close")).toHaveLength(1);
        expect(document.activeElement?.closest("[role=tree]")).not.toBeNull();

        await wrapper.setProps({menu: null});
        await wrapper.setProps({menu: {...menu}});
        await flushPromises();
        expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
        const refresh = wrapper.get<HTMLButtonElement>("[data-explorer-tool=\"refresh\"]").element;
        refresh.focus();
        refresh.click();
        await flushPromises();
        expect(wrapper.emitted("menu-close")).toHaveLength(2);
        expect(document.activeElement).toBe(refresh);
    });
});

describe("FilesExplorerView：确认框与结果区", () => {
    it("删除确认列出受影响项，焦点默认在取消上；确认与取消各自发出", async () => {
        const dialog: Dialog = {kind: "delete", items: [{address: "project://plain", token: "t1"}, {address: "project://a.md", token: "t2"}], busy: false, unsaved: ["project://plain/x.md"]};
        const wrapper = view({dialog});
        await flushPromises();
        const panel = document.querySelector("[role=alertdialog]") as HTMLElement;
        expect(panel.textContent).toContain("删除 2 项？");
        expect([...document.querySelectorAll("[data-explorer-delete-items] li")].map((item) => item.textContent)).toEqual(["project://plain", "project://a.md"]);
        // 会丢失未保存修改的打开文档单独列出。
        expect(panel.textContent).toContain("这些打开的文件有未保存的修改，删除后会丢失");
        expect([...document.querySelectorAll("[data-explorer-delete-unsaved] li")].map((item) => item.textContent)).toEqual(["project://plain/x.md"]);
        expect(document.activeElement?.textContent?.trim()).toBe("取消");
        (document.activeElement as HTMLButtonElement).click();
        await flushPromises();
        expect(wrapper.emitted("dialog-close")).toHaveLength(1);
        expect(wrapper.emitted("delete-confirm")).toBeUndefined();
    });

    it("复制有未保存修改的文件：列出文档，三个按钮各自发出；关闭等于取消", async () => {
        const dialog: Dialog = {kind: "dirty-copy", documents: ["project://plain/a.md"]};
        const wrapper = view({dialog});
        await flushPromises();
        expect(document.querySelector("[data-explorer-dirty-copy]")?.textContent).toContain("project://plain/a.md");
        for (const choice of ["cancel", "disk", "save"]) document.querySelector<HTMLButtonElement>(`[data-explorer-dirty-copy-${choice}]`)?.click();
        await flushPromises();
        expect(wrapper.emitted("dirty-copy")).toEqual([["cancel"], ["disk"], ["save"]]);
    });

    it("展示名对话框：带上当前值，保存发出新的展示名与图标", async () => {
        const dialog: Dialog = {kind: "display", address: "project://lore.content/alice", name: "alice", title: "爱丽丝", icon: "", busy: false};
        const wrapper = view({dialog});
        await flushPromises();
        const title = document.querySelector<HTMLInputElement>("[data-explorer-display-title] input, input[data-explorer-display-title]");
        expect(title?.value).toBe("爱丽丝");
        title!.value = "艾丽斯";
        title!.dispatchEvent(new Event("input"));
        const save = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "保存");
        save?.click();
        await flushPromises();
        expect(wrapper.emitted("display-commit")).toEqual([["艾丽斯", ""]]);
    });

    it("结果区：进行中可取消；逐项结果列出失败原因与残留范围，结果省略时说明", async () => {
        const report: OperationReport = {
            action: "delete",
            items: [
                {address: "project://plain", target: null, result: {status: "failed", code: "permission-denied", detail: "没有权限", partial: {removed: {paths: ["plain/a.md"], truncated: false}}}},
                {address: "project://a.md", target: null, result: {status: "done"}},
                {address: "project://b.md", target: null, result: {status: "cancelled"}},
            ],
            manifests: [{path: "lore.content/content.xml", status: "failed", detail: "写不进去"}],
            truncated: true,
        };
        const wrapper = view({report, running: {action: "delete", count: 3}});
        expect(wrapper.get("[data-explorer-running]").text()).toContain("正在删除 3 项…");
        await wrapper.get("[data-explorer-running] button").trigger("click");
        expect(wrapper.emitted("cancel-running")).toHaveLength(1);
        const section = wrapper.get("[data-explorer-report]");
        expect(section.text()).toContain("删除：1 项完成，2 项没有完成");
        expect(section.get("[data-explorer-report-item=\"failed\"]").text()).toContain("失败：没有权限");
        expect(section.get("[data-explorer-report-item=\"failed\"]").text()).toContain("已删除：plain/a.md");
        expect(section.get("[data-explorer-report-item=\"cancelled\"]").text()).toContain("已取消");
        expect(section.text()).toContain("清单 lore.content/content.xml 没有更新：写不进去");
        expect(section.text()).toContain("结果已省略，请重新列出核对");
    });
});

describe("FilesExplorerView：碰撞对话框", () => {
    const dialog: Dialog = {kind: "collision", action: "copy", source: "project://plain/a.md", target: "project://dest/a.md", candidate: "a (2).md", error: null, busy: false};
    const button = (marker: string) => document.querySelector<HTMLButtonElement>(`[${marker}]`) as HTMLButtonElement;

    it("显示真实的源与目标、预填候选名；改名带输入框里的名字，“对其余都这样”随跳过一起发出；取消剩余", async () => {
        const wrapper = view({dialog});
        await flushPromises();
        expect(document.querySelector("[data-explorer-collision-source]")?.textContent).toBe("project://plain/a.md");
        expect(document.querySelector("[data-explorer-collision-target]")?.textContent).toBe("project://dest/a.md");
        const name = document.querySelector<HTMLInputElement>("[data-explorer-collision-name] input, input[data-explorer-collision-name]") as HTMLInputElement;
        expect(name.value).toBe("a (2).md");
        name.value = "b.md";
        name.dispatchEvent(new Event("input"));
        button("data-explorer-collision-rename").click();
        expect(wrapper.emitted("collision")).toEqual([[{kind: "rename", name: "b.md"}, false]]);

        const all = document.querySelector<HTMLInputElement>("[data-explorer-collision-all] input, input[type=checkbox]") as HTMLInputElement;
        all.click();
        await flushPromises();
        button("data-explorer-collision-skip").click();
        button("data-explorer-collision-cancel").click();
        expect(wrapper.emitted("collision")?.slice(1)).toEqual([[{kind: "skip"}, true], [{kind: "cancel"}, false]]);
    });

    it("换到下一项时换成它的候选名；名字不能用时原位提示并与输入框关联", async () => {
        const wrapper = view({dialog});
        await flushPromises();
        await wrapper.setProps({dialog: {...dialog, source: "project://plain/z.md", target: "project://dest/z.md", candidate: "z (2).md", error: {code: "conflict"}}});
        await flushPromises();
        const name = document.querySelector<HTMLInputElement>("[data-explorer-collision-name] input, input[data-explorer-collision-name]") as HTMLInputElement;
        expect(name.value).toBe("z (2).md");
        const error = document.querySelector("#explorer-collision-error");
        expect(error?.getAttribute("role")).toBe("alert");
        expect(error?.textContent).toBe("已存在同名项");
        expect(name.getAttribute("aria-describedby")).toBe("explorer-collision-error");
    });
});

describe("FilesExplorerView：结果未知与剪切标记", () => {
    it("结果未知列出意图里的源与目标，说明门禁与放弃的后果；重新列出与放弃各自发出", async () => {
        const unknown: Unknown = {action: "move", clipboard: 1, items: [{address: "project://plain/a.md", target: "project://dest/a.md"}]};
        const wrapper = view({unknown});
        const section = wrapper.get("[data-explorer-unknown]");
        expect(section.attributes("role")).toBe("alert");
        expect(section.text()).toContain("移动 1 项的结果未知");
        expect(section.text()).toContain("project://plain/a.md → project://dest/a.md");
        expect(section.text()).toContain("放弃不会取消可能仍在后台执行的操作");
        await section.get("[data-explorer-recheck]").trigger("click");
        await section.get("[data-explorer-abandon]").trigger("click");
        expect(wrapper.emitted("recheck")).toHaveLength(1);
        expect(wrapper.emitted("abandon")).toHaveLength(1);
    });

    it("剪切中的行带标记并淡化", () => {
        const cut = rows().map((row) => (row.kind === "entry" && row.id === "project://a.md" ? {...row, cut: true} : row));
        const wrapper = view({rows: cut});
        const row = wrapper.get("[data-explorer-row=\"project://a.md\"]");
        expect(row.attributes("data-explorer-cut")).toBe("");
        expect(row.text()).toContain("剪切中");
        expect(wrapper.get("[data-explorer-row=\"project://plain\"]").attributes("data-explorer-cut")).toBeUndefined();
    });
});
