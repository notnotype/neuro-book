/**
 * 书架页的固定数据：几部作品覆盖书架上要看的情形——长短书名、有无简介、指定颜色、统计新鲜度三种、正在打开、
 * 今天净增为负。时间以 `SHELF_NOW` 为准，Lab 里“今天”“昨天”的写法不随真实日期变。
 */

import type {ShelfItem, ShelfStats} from "nbook/plugins/projects/shared/shelf";

export const SHELF_NOW = "2026-10-10T16:30:00+01:00";

function stats(partial: Partial<ShelfStats> & Pick<ShelfStats, "freshness">): ShelfStats {
    return {computedAt: null, words: 0, files: 0, unreadable: 0, today: null, last: null, ...partial};
}

export const SHELF_ITEMS: ShelfItem[] = [
    {
        id: "8f0c2d4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
        name: "changyexing",
        title: "长夜行",
        description: "雪线以北的驿站里，一个守灯人等一封永远不会来的信。",
        color: null,
        cover: null,
        path: "/home/writer/books/changyexing",
        state: "running",
        stats: stats({
            freshness: "fresh",
            computedAt: "2026-10-10T16:28:00+01:00",
            words: 286_400,
            files: 41,
            today: 1240,
            last: {address: "project://正文/第十七章 雪线.md", label: "第十七章 雪线", at: "2026-10-10T16:27:00+01:00", excerpt: "他把灯放低一些，雪落在灯罩上，化成一圈细细的水痕。远处的狗叫了两声，又安静下去，像是谁把夜色重新折好，塞回了口袋里。"},
        }),
    },
    {
        id: "2b7e9a10-3c4d-4e5f-9a0b-1c2d3e4f5a6b",
        name: "beifang",
        title: "北方以北",
        description: "三代人，一条铁路，一座在地图上被划掉的小城。",
        color: "#7a4b3a",
        cover: null,
        path: "/home/writer/books/beifang",
        state: "stopped",
        stats: stats({
            freshness: "stale",
            computedAt: "2026-10-08T22:10:00+01:00",
            words: 132_900,
            files: 23,
            today: null,
            last: {address: "project://第二部/站台.md", label: "站台", at: "2026-10-08T22:05:00+01:00", excerpt: "火车没有停，只是慢了下来。"},
        }),
    },
    {
        id: "c41d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
        name: "wuzhongcheng",
        title: "雾中城",
        description: null,
        color: null,
        cover: null,
        path: "/home/writer/books/wuzhongcheng",
        state: "stopped",
        stats: stats({
            freshness: "stale",
            computedAt: "2026-09-21T10:00:00+01:00",
            words: 48_300,
            files: 9,
            today: null,
            last: {address: "project://雾中城.md", label: "雾中城", at: "2026-09-21T09:58:00+01:00", excerpt: "城门在雾里开着，没有人进出。"},
        }),
    },
    {
        id: "d9e8f7a6-b5c4-4d3e-9f2a-1b0c9d8e7f6a",
        name: "untitled",
        title: null,
        description: null,
        color: null,
        cover: null,
        path: "/home/writer/drafts/untitled",
        state: "stopped",
        stats: stats({freshness: "none"}),
    },
    {
        id: "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b",
        name: "duanpian",
        title: "短篇集：在所有的雨天之后，我们终于学会了不带伞出门",
        description: "十二个短篇，写给那些在雨里走过很远的人。",
        color: "#d9c9a3",
        cover: null,
        path: "/home/writer/books/short-stories-collection-after-all-the-rainy-days",
        state: "stopped",
        stats: stats({
            freshness: "stale",
            computedAt: "2025-12-30T23:40:00+00:00",
            words: 6_800,
            files: 12,
            today: null,
            last: {address: "project://雨天.md", label: "雨天", at: "2025-12-30T23:30:00+00:00", excerpt: "伞在门口立了一整个冬天。"},
        }),
    },
    {
        id: "f6a5b4c3-d2e1-4f0a-9b8c-7d6e5f4a3b2c",
        name: "the-long-dark",
        title: "The Long Dark",
        description: "A translation draft.",
        color: null,
        cover: null,
        path: "/home/writer/books/the-long-dark",
        state: "stopped",
        stats: stats({
            freshness: "stale",
            computedAt: "2026-10-09T20:00:00+01:00",
            words: 21_500,
            files: 6,
            today: null,
            last: {address: "project://chapter-03.md", label: "chapter-03", at: "2026-10-09T19:55:00+01:00", excerpt: "The lamp was lower now, and the snow had found it."},
        }),
    },
];

/** 今天删多于写：今天净增为负。 */
export const SHELF_ITEM_REVISING: ShelfItem = {
    ...SHELF_ITEMS[0]!,
    stats: {...SHELF_ITEMS[0]!.stats, today: -320},
};

/** Lab 里第一部作品的封面：一张内联 SVG（夜色、月亮、山），不依赖服务端的封面路由。 */
export const SHELF_COVER_SRC = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1b2e"/><stop offset=".55" stop-color="#1f3a5f"/><stop offset="1" stop-color="#6d7f9a"/></linearGradient></defs><rect width="200" height="300" fill="url(#g)"/><circle cx="100" cy="92" r="22" fill="#fff8e1"/><path d="M0 230 L40 190 L70 215 L110 170 L150 205 L200 180 L200 300 L0 300Z" fill="#0b1626"/><text x="100" y="268" text-anchor="middle" font-family="serif" font-size="22" font-weight="600" fill="#f7f2ec" letter-spacing="4">长夜行</text></svg>')}`;
