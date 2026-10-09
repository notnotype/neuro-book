/**
 * FilesExplorerView 的动作界面（同名 .md 与 ExplorerRow、ExplorerFeedback 的 .md）：内联输入的按键与输入法组字、错误的
 * 关联、右键菜单按菜单项发出命令、删除确认框默认在取消上、展示名对话框、结果区的逐项结果与进行中。行数据由真实的投影
 * 算出，菜单项由真实的 `menuEntries` 算出。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import type {DirectoryEntry, Listing} from "nbook/plugins/files/shared/contracts";

import type {Availability, Dialog, OperationReport} from "../controller";
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

const ALL: Availability = {create: true, rename: true, delete: true, createContent: true, convert: true, display: true, include: true, drop: true, moveUp: true, moveDown: false};

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
        expect(labels).toEqual(["新建文件", "新建文件夹", "重命名F2", "创建内容", "修改展示名与图标", "上移Alt+↑", "下移Alt+↓", "删除Delete"]);
        const down = [...document.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].find((item) => item.textContent?.includes("下移"));
        expect(down?.disabled).toBe(true);
        [...document.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].find((item) => item.textContent?.includes("创建内容"))?.click();
        expect(wrapper.emitted("menu-command")).toEqual([["nbook.files.create-content"]]);
        expect(wrapper.emitted("menu-close")).toHaveLength(1);

        const root = rows().find((row) => row.id === "project://");
        expect(menuEntries(root!, ALL, "zh-CN").map((entry) => (entry.kind === "item" ? entry.command : "-"))).toEqual(["nbook.files.new-file", "nbook.files.new-folder"]);
        const gone = rows().find((row) => row.id === "project://lore.content/gone") as EntryRow;
        expect(menuEntries(gone, ALL, "zh-CN").map((entry) => (entry.kind === "item" ? entry.command : "-"))).toContain("nbook.files.drop-entry");
    });
});

describe("FilesExplorerView：确认框与结果区", () => {
    it("删除确认列出受影响项，焦点默认在取消上；确认与取消各自发出", async () => {
        const dialog: Dialog = {kind: "delete", items: [{address: "project://plain", token: "t1"}, {address: "project://a.md", token: "t2"}], busy: false};
        const wrapper = view({dialog});
        await flushPromises();
        const panel = document.querySelector("[role=alertdialog]") as HTMLElement;
        expect(panel.textContent).toContain("删除 2 项？");
        expect([...document.querySelectorAll("[data-explorer-delete-items] li")].map((item) => item.textContent)).toEqual(["project://plain", "project://a.md"]);
        expect(document.activeElement?.textContent?.trim()).toBe("取消");
        (document.activeElement as HTMLButtonElement).click();
        await flushPromises();
        expect(wrapper.emitted("dialog-close")).toHaveLength(1);
        expect(wrapper.emitted("delete-confirm")).toBeUndefined();
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
                {address: "project://plain", result: {status: "failed", code: "permission-denied", detail: "没有权限", partial: {removed: {paths: ["plain/a.md"], truncated: false}}}},
                {address: "project://a.md", result: {status: "done"}},
                {address: "project://b.md", result: {status: "cancelled"}},
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
