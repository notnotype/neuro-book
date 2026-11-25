/**
 * DataTable 场景的样本：一部连载长篇的章节表，共 1286 章、每页 20 章，65 页，最后一页 6 章。
 * 场景输入与夹具里模拟取数都从这里取同一份，翻到哪页拿到的行都对得上。
 */

import type {DataTable} from "@notnotype/nb-ui/components";

export type SampleChapter = {
    id: string;
    title: string;
    volume: string;
    words: number;
    status: string;
    updated: string;
};

export const SAMPLE_TOTAL = 1286;
export const SAMPLE_PAGE_SIZE = 20;
export const SAMPLE_LAST_PAGE = Math.ceil(SAMPLE_TOTAL / SAMPLE_PAGE_SIZE);

const TITLES = ["灯塔", "雾中城", "巡夜人", "渡口", "雪线", "旧信", "北山", "长街", "空驿", "回声", "夜航", "无名岛"];
const STATUSES = ["已定稿", "修改中", "草稿"];

export const SAMPLE_COLUMNS = [
    {key: "title" as const, label: "章节"},
    {key: "volume" as const, label: "分卷", width: "88px"},
    {key: "words" as const, label: "字数", width: "80px", align: "right" as const},
    {key: "status" as const, label: "状态", width: "80px"},
    {key: "updated" as const, label: "修改", width: "72px", align: "center" as const},
    {key: "id" as const, label: "", width: "48px", align: "right" as const},
];

function chapter(number: number): SampleChapter {
    // 字数与日期由章号算出来，每次渲染都一样，截图之间可以比对。
    const day = 1 + (number % 28);
    return {
        id: `chapter-${String(number)}`,
        title: `第 ${String(number)} 章 ${TITLES[number % TITLES.length]!}`,
        volume: `第 ${String(Math.ceil(number / 120))} 卷`,
        words: 2200 + ((number * 7919) % 2600),
        status: STATUSES[number % STATUSES.length]!,
        updated: `11-${String(day).padStart(2, "0")}`,
    };
}

/** 第 page 页的行；页码越界时给空数组。 */
export function samplePage(page: number): SampleChapter[] {
    const first = (page - 1) * SAMPLE_PAGE_SIZE + 1;
    const last = Math.min(SAMPLE_TOTAL, page * SAMPLE_PAGE_SIZE);
    if (page < 1 || first > SAMPLE_TOTAL) return [];
    return Array.from({length: last - first + 1}, (_, index) => chapter(first + index));
}

/** `DataTable` 是泛型组件，按样本的行实例化它的 props，拼成场景类型推导认的构造器类型（同 display.ts 里的 Table）。 */
export type SampleDataTable = new () => {$props: Parameters<typeof DataTable<SampleChapter>>[0]};
