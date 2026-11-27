/**
 * DataTable 的状态、页脚与事件（DataTable.md 的“布局”“状态”“交互”）。
 *
 * happy-dom 不算布局：工具条与页脚“位置不变”、表头吸顶、最后一页时页脚在底部，由 Lab 的浏览器测试量几何
 * （packages/neuro-book/e2e/lab-nb-ui.e2e.ts）。这里核对它们的前提：各种状态下工具条与页脚是同一批元素，只换表格区里面的内容。
 * @vue/test-utils 把 Transition 换成直接渲染的替身，所以层的出现与消失在这里是即时的。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";

import DataTable from "./DataTable.vue";

type Chapter = {id: string; title: string; words: number};

const COLUMNS = [
    {key: "title" as const, label: "章节"},
    {key: "words" as const, label: "字数", align: "right" as const},
];

/** 一部 1284 章的长篇，每页 20 章，共 65 页；最后一页只有 4 章。 */
const TOTAL = 1284;
const PAGE_SIZE = 20;
function chapters(page: number, count = PAGE_SIZE): Chapter[] {
    return Array.from({length: count}, (_, index) => {
        const number = (page - 1) * PAGE_SIZE + index + 1;
        return {id: `ch-${number}`, title: `第 ${number} 章`, words: 3000 + number};
    });
}

type Props = {
    rows: Chapter[];
    total: number | null;
    page: number;
    loading?: boolean;
    error?: string;
};

const mounted: {unmount: () => void}[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

function mountTable(props: Props, slots: Record<string, string> = {}) {
    const wrapper = mount(DataTable<Chapter>, {
        props: {columns: COLUMNS, rowKey: "id", pageSize: PAGE_SIZE, ...props},
        slots: {filters: "<button type=\"button\" class=\"filter\">全部</button>", actions: "<button type=\"button\" class=\"action\">新建</button>", ...slots},
        attachTo: document.body,
    });
    mounted.push(wrapper);
    return wrapper;
}

const countText = (wrapper: ReturnType<typeof mountTable>) => wrapper.get(".nb-data-table-count").text();
const bodyRows = (wrapper: ReturnType<typeof mountTable>) => wrapper.findAll("tbody tr").filter((row) => row.find("td").text() !== "");

describe("DataTable 的三块", () => {
    it("五种状态之间工具条与页脚是同一批元素，只有表格区的内容在换", async () => {
        const wrapper = mountTable({rows: chapters(3), total: TOTAL, page: 3});
        const bar = wrapper.get(".nb-data-table-bar").element;
        const barHtml = bar.innerHTML;
        const foot = wrapper.get(".nb-data-table-foot").element;
        const count = wrapper.get(".nb-data-table-count").element;
        const nav = wrapper.get(".nb-data-table-foot nav").element;
        const body = wrapper.get(".nb-data-table-body").element;
        const expectSameFrame = () => {
            expect(wrapper.get(".nb-data-table-bar").element).toBe(bar);
            expect(bar.innerHTML).toBe(barHtml);
            expect(wrapper.get(".nb-data-table-foot").element).toBe(foot);
            expect(wrapper.get(".nb-data-table-count").element).toBe(count);
            expect(wrapper.get(".nb-data-table-foot nav").element).toBe(nav);
            expect(wrapper.get(".nb-data-table-body").element).toBe(body);
            expect(wrapper.element.children).toHaveLength(3);
        };
        expect(bodyRows(wrapper)).toHaveLength(20);

        // 首次加载
        await wrapper.setProps({rows: [], total: null, page: 1, loading: true});
        expectSameFrame();
        expect(bodyRows(wrapper)).toHaveLength(0);
        // 翻页加载
        await wrapper.setProps({rows: chapters(3), total: TOTAL, page: 4, loading: true});
        expectSameFrame();
        expect(bodyRows(wrapper)).toHaveLength(20);
        // 空
        await wrapper.setProps({rows: [], total: 0, page: 1, loading: false});
        expectSameFrame();
        expect(wrapper.get(".nb-data-table-body").text()).toContain("暂无数据");
        // 出错
        await wrapper.setProps({rows: chapters(3), total: TOTAL, page: 3, error: "列表没有取回来"});
        expectSameFrame();
        expect(wrapper.get("[role=alert]").text()).toContain("列表没有取回来");
        // 最后一页不满
        await wrapper.setProps({rows: chapters(65, 4), total: TOTAL, page: 65, error: undefined});
        expectSameFrame();
        expect(bodyRows(wrapper)).toHaveLength(4);
        expect(wrapper.find("[role=alert]").exists()).toBe(false);
    });

    it("表头一直在，表格吸顶", async () => {
        const wrapper = mountTable({rows: [], total: null, page: 1, loading: true});
        expect(wrapper.findAll("th").map((th) => th.text())).toEqual(["章节", "字数"]);
        // Table 的根是表格区的滚动容器（stickyHeader 的结构，Table.test.ts 守它的细节）。
        expect(wrapper.get(".nb-data-table-body > div").classes()).toContain("overflow-auto");
        for (const th of wrapper.findAll("th")) expect(th.classes()).toContain("sticky");
    });
});

describe("DataTable 的页脚", () => {
    it("条数的起点按页码算、终点按这一页实际拿到的行算，数字分位", () => {
        expect(countText(mountTable({rows: chapters(3), total: TOTAL, page: 3}))).toContain("第 41 到 60 条，共 1,284 条");
        expect(countText(mountTable({rows: chapters(65, 4), total: TOTAL, page: 65}))).toContain("第 1,281 到 1,284 条，共 1,284 条");
        // 数据变少了、总数还是旧的：这一页只拿到 5 行，终点跟着行数走。
        expect(countText(mountTable({rows: chapters(3, 5), total: TOTAL, page: 3}))).toContain("第 41 到 45 条，共 1,284 条");
    });

    it("页码越界、这一页没有行时只写总数，与表格区的空态一致", () => {
        // 删掉了最后一页的唯一一行：总数 65、每页 20，使用方还停在第 9 页，没有行。
        const wrapper = mountTable({rows: [], total: 65, page: 9});
        expect(countText(wrapper)).toBe("共 65 条");
        expect(wrapper.get(".nb-data-table-body").text()).toContain("暂无数据");
        expect(wrapper.get(".nb-data-table-foot [aria-current='page']").text()).toBe("4");
    });

    it("还不知道总数时条数写“—”，分页条不可用", () => {
        const wrapper = mountTable({rows: [], total: null, page: 1, loading: true});
        expect(countText(wrapper)).toBe("—");
        const buttons = wrapper.findAll(".nb-data-table-foot nav button");
        expect(buttons.length).toBeGreaterThan(0);
        for (const button of buttons) expect(button.attributes("disabled")).toBeDefined();
    });

    it("空时写“共 0 条”，分页条 1 页、不可用；empty 插槽替换空态", () => {
        const wrapper = mountTable({rows: [], total: 0, page: 1}, {empty: "<p class=\"custom-empty\">这一卷还没有章节</p>"});
        expect(countText(wrapper)).toBe("共 0 条");
        expect(wrapper.findAll(".nb-data-table-foot nav .nb-pagination-cell").map((cell) => cell.text())).toEqual(["1"]);
        for (const button of wrapper.findAll(".nb-data-table-foot nav button")) expect(button.attributes("disabled")).toBeDefined();
        expect(wrapper.get(".custom-empty").text()).toBe("这一卷还没有章节");
        expect(wrapper.text()).not.toContain("暂无数据");
    });

    it("出错时页脚留着条数与页码", async () => {
        const wrapper = mountTable({rows: chapters(3), total: TOTAL, page: 3});
        await wrapper.setProps({error: "列表没有取回来"});
        expect(countText(wrapper)).toContain("第 41 到 60 条，共 1,284 条");
        expect(wrapper.get(".nb-data-table-foot [aria-current='page']").text()).toBe("3");
        const pageTwo = wrapper.findAll(".nb-data-table-foot nav button").find((button) => button.attributes("aria-label") === "第 2 页")!;
        expect(pageTwo.attributes("disabled")).toBeUndefined();
    });

    it("count 插槽拿到起止与总数，这一页没有行时起止都是 0", async () => {
        const wrapper = mountTable({rows: chapters(2), total: TOTAL, page: 2}, {count: "<template #count=\"{from, to, total}\">{{ from }}-{{ to }}/{{ total }} 章</template>"});
        expect(countText(wrapper)).toBe("21-40/1284 章");
        await wrapper.setProps({rows: []});
        expect(countText(wrapper)).toBe("0-0/1284 章");
    });
});

describe("DataTable 的加载", () => {
    it("首次加载时转圈不立即出现，等一小段时间后出现", async () => {
        const wrapper = mountTable({rows: [], total: null, page: 1, loading: true});
        expect(wrapper.find(".nb-data-table-body [role=status]").exists()).toBe(false);
        expect(wrapper.get(".nb-data-table-body").attributes("aria-busy")).toBe("true");
        await vi.waitFor(() => expect(wrapper.get(".nb-data-table-body [role=status]").text()).toBe("加载中"));
    });

    it("翻页加载时旧行留着，遮罩不立即出现，等一小段时间后出现；加载完遮罩与 aria-busy 都去掉", async () => {
        const wrapper = mountTable({rows: chapters(3), total: TOTAL, page: 3});
        await wrapper.setProps({page: 4, loading: true});
        expect(bodyRows(wrapper)[0]!.text()).toContain("第 41 章");
        expect(wrapper.get(".nb-data-table-body").attributes("aria-busy")).toBe("true");
        expect(wrapper.find(".nb-data-table-layer.is-mask").exists()).toBe(false);
        expect(wrapper.get(".nb-data-table-foot [aria-current='page']").text()).toBe("4");

        await vi.waitFor(() => expect(wrapper.find(".nb-data-table-layer.is-mask").exists()).toBe(true));
        expect(wrapper.get(".nb-data-table-layer.is-mask [role=status]").text()).toBe("加载中");

        await wrapper.setProps({rows: chapters(4), loading: false});
        // 遮罩刚出现就加载完：新行与 aria-busy 立即换掉，遮罩再停一小段才去掉，不闪一下就没了。
        expect(wrapper.get(".nb-data-table-body").attributes("aria-busy")).toBeUndefined();
        expect(bodyRows(wrapper)[0]!.text()).toContain("第 61 章");
        expect(wrapper.find(".nb-data-table-layer.is-mask").exists()).toBe(true);
        await vi.waitFor(() => expect(wrapper.find(".nb-data-table-layer").exists()).toBe(false));
    });

    it("遮罩盖着旧行时行所在的那一层是 inert，工具条与页脚不是；焦点在被盖住的行内按钮上时接到表格区", async () => {
        const wrapper = mountTable({rows: chapters(3), total: TOTAL, page: 3}, {"cell-title": "<template #cell-title=\"{row}\"><button type=\"button\" class=\"more\">{{ row.title }}</button></template>"});
        const tableRoot = () => wrapper.get(".nb-data-table-body > div").element;
        const rowButton = wrapper.get(".more").element as HTMLButtonElement;
        rowButton.focus();
        expect(document.activeElement).toBe(rowButton);

        await wrapper.setProps({page: 4, loading: true});
        // 延时没过、遮罩还没盖上：行仍可交互。
        expect(tableRoot().hasAttribute("inert")).toBe(false);
        expect(document.activeElement).toBe(rowButton);

        await vi.waitFor(() => expect(wrapper.find(".nb-data-table-layer.is-mask").exists()).toBe(true));
        expect(tableRoot().hasAttribute("inert")).toBe(true);
        expect(wrapper.get(".nb-data-table-bar").element.closest("[inert]")).toBeNull();
        expect(wrapper.get(".nb-data-table-foot").element.closest("[inert]")).toBeNull();
        expect(wrapper.findAll(".nb-data-table-foot nav button").some((button) => button.attributes("disabled") === undefined)).toBe(true);
        expect(document.activeElement).toBe(wrapper.get(".nb-data-table-body").element);

        await wrapper.setProps({rows: chapters(4), loading: false});
        expect(tableRoot().hasAttribute("inert")).toBe(false);
        // 遮罩还在停最短时长，但已不挡指针：指针与键盘一样能碰到新行。
        expect(wrapper.get(".nb-data-table-layer.is-mask").classes()).toContain("is-settled");

        // 停留期里焦点进了新行的按钮，又开始加载：层与行都没变，行变成 inert，焦点接到表格区，不掉回 body。
        const newButton = wrapper.get(".more").element as HTMLButtonElement;
        newButton.focus();
        expect(document.activeElement).toBe(newButton);
        await wrapper.setProps({page: 5, loading: true});
        expect(tableRoot().hasAttribute("inert")).toBe(true);
        expect(wrapper.get(".nb-data-table-layer.is-mask").classes()).not.toContain("is-settled");
        expect(document.activeElement).toBe(wrapper.get(".nb-data-table-body").element);
    });
});

describe("DataTable 的表格区", () => {
    it("单元格不换行", () => {
        const wrapper = mountTable({rows: chapters(1), total: TOTAL, page: 1});
        for (const td of wrapper.findAll("tbody td")) expect(td.classes()).toContain("whitespace-nowrap");
    });

    it("新的一批行到了才回到顶部：翻页加载期间旧行不动，换筛选（页码不变）也回顶", async () => {
        const wrapper = mountTable({rows: chapters(1), total: TOTAL, page: 1});
        const scroller = wrapper.get(".nb-data-table-body > div").element as HTMLElement;
        scroller.scrollTop = 120;
        expect(scroller.scrollTop).toBe(120);

        // 翻页加载：页码先变，旧行留着。
        await wrapper.setProps({page: 2, loading: true});
        expect(scroller.scrollTop).toBe(120);
        await wrapper.setProps({rows: chapters(2), loading: false});
        expect(scroller.scrollTop).toBe(0);

        // 换筛选：页码还是 2，取回来的是另一批行。
        scroller.scrollTop = 80;
        await wrapper.setProps({rows: chapters(2).slice(0, 10), total: 30});
        expect(scroller.scrollTop).toBe(0);
    });
});

describe("DataTable 的事件", () => {
    it("出错时点重试发 retry", async () => {
        const wrapper = mountTable({rows: [], total: null, page: 1, error: "列表没有取回来"});
        const alert = wrapper.get("[role=alert]");
        await alert.get("button").trigger("click");
        expect(alert.get("button").text()).toBe("重试");
        expect(wrapper.emitted("retry")).toEqual([[]]);
    });

    it("点了重试、使用方清掉 error 以后，焦点从离场的出错层接到表格区", async () => {
        const wrapper = mountTable({rows: chapters(3), total: TOTAL, page: 3, error: "列表没有取回来"});
        const retry = wrapper.get("[role=alert] button");
        (retry.element as HTMLButtonElement).focus();
        await retry.trigger("click");
        // 使用方照取数约定清掉 error、置 loading。
        await wrapper.setProps({error: undefined, loading: true});
        expect(wrapper.find("[role=alert]").exists()).toBe(false);
        expect(document.activeElement).toBe(wrapper.get(".nb-data-table-body").element);
    });

    it("焦点不在表格区里时，出错层离场不挪焦点", async () => {
        const wrapper = mountTable({rows: chapters(3), total: TOTAL, page: 3, error: "列表没有取回来"});
        const filter = wrapper.get(".filter").element as HTMLButtonElement;
        filter.focus();
        await wrapper.setProps({error: undefined});
        expect(document.activeElement).toBe(filter);
    });

    it("点分页条发 update:page，点行发 row-click，单元格插槽透传", async () => {
        const wrapper = mountTable(
            {rows: chapters(1), total: TOTAL, page: 1},
            {"cell-title": "<template #cell-title=\"{row, index}\"><b class=\"title\">{{ index }}:{{ row.title }}</b></template>"},
        );
        expect(wrapper.findAll(".title")[1]!.text()).toBe("1:第 2 章");

        const next = wrapper.findAll(".nb-data-table-foot nav button").find((button) => button.attributes("aria-label") === "第 2 页")!;
        await next.trigger("click");
        expect(wrapper.emitted("update:page")).toEqual([[2]]);

        await bodyRows(wrapper)[2]!.trigger("click");
        const clicked = wrapper.emitted("row-click");
        expect(clicked).toHaveLength(1);
        expect(clicked![0]).toEqual([chapters(1)[2], 2]);
    });
});
