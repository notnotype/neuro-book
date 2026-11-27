import {mount} from "@vue/test-utils";
import {nextTick} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import type {AgentSessionListItem} from "../types";
import AgentSessionPanel from "./AgentSessionPanel.vue";

const now = new Date(2026, 9, 20, 13, 30).getTime();
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();
const items: AgentSessionListItem[] = [
    {id: "a", title: "今天的", updatedAt: at(20), status: "running", icon: "i-lucide-feather", iconTitle: "写作助手"},
    {id: "b", title: "", description: "说明", updatedAt: at(20), status: "waiting"},
    {id: "c", title: "昨天的", updatedAt: at(19), status: "interrupted"},
    {id: "d", title: "更早的", updatedAt: at(3), status: "idle", archived: true},
];

const panel = (props: Partial<InstanceType<typeof AgentSessionPanel>["$props"]> = {}) => mount(AgentSessionPanel, {props: {items, selectedId: "a", now, locale: "zh-CN", ...props}, attachTo: document.body});

afterEach(() => {
    document.body.innerHTML = "";
});

/** 像用户那样打开过滤菜单（焦点放到按钮上按↓），交回列出的各项（菜单画在 body 下）。 */
async function openFilter(view: ReturnType<typeof panel>): Promise<HTMLElement[]> {
    const button = view.get("[data-panel-filter]");
    (button.element as HTMLElement).focus();
    await button.trigger("keydown", {key: "ArrowDown"});
    for (let index = 0; index < 8; index += 1) await nextTick();
    return [...document.querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemradio], [role=menuitemcheckbox]")];
}

describe("AgentSessionPanel", () => {
    it("按最近活动排、不按日分组（没有分组标题）；图标写 Profile 名字；状态写明；未命名有占位", () => {
        const view = panel();
        expect(view.find(".acv-panel__group").exists()).toBe(false);
        expect(view.findAll(".acv-panel__state").map((node) => node.text())).toEqual(["运行中", "等你处理", "已中断"]);
        expect(view.get(".acv-panel__icon").attributes("title")).toBe("写作助手");
        expect(view.findAll(".acv-panel__title").map((node) => node.text())).toContain("未命名会话");
        expect(view.findAll(".acv-panel__row.is-current")).toHaveLength(1);
        expect(view.findAll(".acv-panel__row.is-archived")).toHaveLength(1);
    });

    it("选中、新建发 action；搜索发 update:query", async () => {
        const view = panel();
        await view.findAll("[data-panel-row]")[2]!.trigger("click");
        await view.get("[data-panel-create]").trigger("click");
        expect(view.emitted("action")).toEqual([[{type: "session.select", sessionId: "c"}], [{type: "session.create"}]]);
        await view.get("[data-panel-search] input, input[data-panel-search]").setValue("钟声");
        expect(view.emitted("update:query")).toEqual([["钟声"]]);
    });

    it("选了的过滤条件是按钮上的条数，不多占一行", () => {
        const none = panel();
        expect(none.find("[data-panel-filter-count]").exists()).toBe(false);
        const filtered = panel({profiles: [{id: "writer", label: "写作助手", active: true}, {id: "qa", label: "问答", active: false}], showArchived: true});
        expect(filtered.get("[data-panel-filter-count]").text()).toBe("2");
        // 列表前面的元素个数一样：有没有条件，列表都不被推动。
        expect(filtered.get(".acv-panel__list").element.parentElement!.children.length).toBe(none.get(".acv-panel__list").element.parentElement!.children.length);
    });

    it("顶上一行只有搜索框与新建，过滤按钮在框里；作品范围是过滤菜单最上面一组，选了“全部作品”算一个条件，清除时回到当前作品", async () => {
        const plain = panel();
        const row = plain.get(".acv-panel__search").element;
        expect([row.children.length, row.children[0]!.querySelector("input") !== null, row.children[1]!.hasAttribute("data-panel-create")]).toEqual([2, true, true]);
        expect(row.querySelector("[data-panel-search]")!.contains(row.querySelector("[data-panel-filter]"))).toBe(true);
        // 没打开作品时菜单里没有范围一组。
        expect((await openFilter(plain)).map((item) => item.getAttribute("role"))).not.toContain("menuitemradio");
        plain.unmount();

        const scoped = panel({scope: {value: "all"}});
        expect(scoped.get("[data-panel-filter-count]").text()).toBe("1");
        const menu = await openFilter(scoped);
        expect(menu.slice(0, 2).map((item) => [item.textContent?.trim(), item.getAttribute("aria-checked")])).toEqual([["当前作品", "false"], ["全部作品", "true"]]);
        menu.find((item) => item.textContent?.trim() === "清除过滤条件")!.click();
        await nextTick();
        expect(scoped.emitted("update:scope")).toEqual([["project"]]);
        scoped.unmount();
    });

    it("空与出错写明", () => {
        expect(panel({items: []}).text()).toContain("没有会话");
        expect(panel({items: [], error: "取不到"}).get("[role='alert']").text()).toBe("取不到");
        // 刷新失败不盖掉已经取到的列表：断线时还要能切会话。
        expect(panel({error: "取不到"}).findAll("[data-panel-row]")).toHaveLength(4);
    });

    describe("子会话", () => {
        const tree: AgentSessionListItem[] = [
            {id: "p", title: "第三章全面检查", updatedAt: at(20), status: "idle", childCount: 2},
            {id: "c1", title: "设定核对", description: "正在读取 正文/第二章.md", updatedAt: at(19), status: "running", parentId: "p"},
            {id: "c2", title: "伏笔检查", updatedAt: at(3), status: "waiting", parentId: "p"},
            {id: "orphan", title: "没有父会话的", updatedAt: at(20), status: "idle", parentId: "gone"},
            {id: "q", title: "人物小传", updatedAt: at(20), status: "idle", childCount: 1, childWaiting: true, dimmed: true},
            {id: "q1", title: "苏晴", updatedAt: at(20), status: "waiting", parentId: "q"},
        ];

        it("挂在父会话下；开关写个数、是打开按钮的兄弟；父会话不在条目里的不列出", async () => {
            const view = panel({items: tree, selectedId: null, expanded: {}});
            expect(view.text()).not.toContain("没有父会话的");
            const toggle = view.get("[data-panel-children]");
            expect(toggle.text()).toContain("2 个子代理");
            expect(toggle.attributes("aria-expanded")).toBe("false");
            expect(toggle.element.closest("[data-panel-row]")).toBeNull();
            // 收起时组不在页面里，开关不指向它。
            expect(toggle.attributes("aria-controls")).toBeUndefined();
            await toggle.trigger("click");
            // 受控：宿主没回写自动展开的那次，记录仍是传进来的那份。
            expect(view.emitted("update:expanded")?.at(-1)).toEqual([{p: true}]);
            await view.setProps({expanded: {p: true}});
            const group = view.get(`#${view.get("[data-panel-children]").attributes("aria-controls")!}`);
            expect(group.findAll("[data-panel-child]").map((node) => node.text())).toEqual([expect.stringContaining("设定核对"), expect.stringContaining("伏笔检查")]);
            await group.findAll("[data-panel-child]")[1]!.trigger("click");
            expect(view.emitted("action")?.at(-1)).toEqual([{type: "session.select", sessionId: "c2"}]);
        });

        it("收起时有子代理在等你处理，父会话行写出来；只因后代命中筛选才列出的父会话弱化并有读屏说明", async () => {
            const view = panel({items: tree, selectedId: null, expanded: {q: false}});
            const parent = view.findAll(".acv-panel__row").find((row) => row.text().includes("人物小传"))!;
            expect(parent.text()).toContain("子代理等你处理");
            expect(parent.classes()).toContain("is-dimmed");
            expect(parent.text()).toContain("上级会话");
        });

        it("子会话被筛掉时，父会话行仍写个数与“子代理等你处理”：两者按全部子会话算", () => {
            const view = panel({items: [{id: "q", title: "人物小传", updatedAt: at(20), status: "idle", childCount: 1, childWaiting: true}], selectedId: null, expanded: {}});
            const parent = view.get(".acv-panel__row");
            expect(parent.text()).toContain("子代理等你处理");
            expect(view.find("[data-panel-children]").exists()).toBe(false);
        });

        it("两个面板同时展开同一个父会话，组的 id 不重复", () => {
            const ids = [panel({items: tree, selectedId: null, expanded: {p: true}}), panel({items: tree, selectedId: null, expanded: {p: true}})]
                .map((view) => view.get("[data-panel-children]").attributes("aria-controls"));
            expect(ids[0]).not.toBe(ids[1]);
        });

        it("选中会话的祖先与有子代理在等的父会话自动展开一次；之后手动收起照常", async () => {
            const view = panel({items: tree, selectedId: "c1", expanded: {}});
            expect(view.emitted("update:expanded")?.at(-1)).toEqual([{p: true, q: true}]);
            await view.setProps({expanded: {p: true, q: true}});
            await view.findAll("[data-panel-children]").find((node) => node.text().includes("2 个"))!.trigger("click");
            expect(view.emitted("update:expanded")?.at(-1)).toEqual([{p: false, q: true}]);
            await view.setProps({expanded: {p: false, q: true}, items: [...tree]});
            expect(view.emitted("update:expanded")).toHaveLength(2);
            // 别的父会话新进入自动展开的集合：只展开它，用户收起的 p 不改回来。
            await view.setProps({items: [...tree, {id: "r", title: "另一个", updatedAt: at(20), status: "idle", childCount: 1, childWaiting: true}, {id: "r1", title: "子", updatedAt: at(20), status: "waiting", parentId: "r"}]});
            expect(view.emitted("update:expanded")?.at(-1)).toEqual([{p: false, q: true, r: true}]);
        });

        it("面板关掉再打开（重新挂载）：用户收起过的不改回来，只补没有记录的", () => {
            const view = panel({items: tree, selectedId: "c1", expanded: {p: false}});
            expect(view.emitted("update:expanded")?.at(-1)).toEqual([{p: false, q: true}]);
        });
    });
});
