import {afterEach, describe, expect, test} from "bun:test";

import {RANK_PAGE, readerSite, strokeSegments} from "./reader";
import type {ReaderState} from "./reader";
import {seededRandom} from "./kit";
import {startSite} from "./server";
import type {RunningSite} from "./server";

const running: Array<RunningSite<ReaderState>> = [];
afterEach(async () => {
    await Promise.all(running.splice(0).map((site) => site.stop()));
});

async function site(): Promise<RunningSite<ReaderState>> {
    const started = await startSite(readerSite, 11);
    running.push(started);
    return started;
}

describe("读者站", () => {
    test("月票榜按批加载，名次连续，接口里没有月票数", async () => {
        const s = await site();
        const first = await (await fetch(`${s.urls.main}/api/rank?offset=0`)).json() as Array<Record<string, unknown>>;
        const fourth = await (await fetch(`${s.urls.main}/api/rank?offset=30`)).json() as Array<{rank: number; title: string; author: string}>;
        expect(first.length).toBe(RANK_PAGE);
        expect(Object.keys(first[0] ?? {}).sort()).toEqual(["author", "id", "rank", "title"]);
        expect(fourth[6]).toMatchObject({rank: 37, title: s.state.books[36]?.title, author: s.state.books[36]?.author});
        const votes = s.state.books.map((book) => book.votes);
        expect(votes).toEqual([...votes].sort((a, b) => b - a));
        expect(new Set(s.state.books.map((book) => book.title)).size).toBe(s.state.books.length);
    });

    test("搜索书名能找到那本书，也带出同名开头的几本；详情页的文字里没有月票数", async () => {
        const s = await site();
        const target = s.state.books[22];
        const results = await (await fetch(`${s.urls.main}/api/search?q=${encodeURIComponent(`《${target?.title}》`)}`)).json() as Array<{id: string}>;
        expect(results.map((r) => r.id)).toContain(target?.id);
        expect(results.length).toBeGreaterThan(1);
        const page = await (await fetch(`${s.urls.main}/book/${target?.id}`)).text();
        expect(page).toContain(target?.title);
        expect(page).toContain((target?.favorites ?? 0).toLocaleString("en-US"));
        expect(page).not.toContain((target?.votes ?? 0).toLocaleString("en-US"));
        expect(page).not.toContain(String(target?.votes));
        const votes = await (await fetch(`${s.urls.main}/api/book/${target?.id}/votes`)).text();
        expect(votes).not.toContain(String(target?.votes));
    });

    test("笔画线段的条数随数字变，先后是打乱的", () => {
        const a = strokeSegments("8", seededRandom(1));
        const b = strokeSegments("1", seededRandom(1));
        expect(a.length).toBe(5);
        expect(b.length).toBe(2);
        expect(strokeSegments("12,345", seededRandom(2))).not.toEqual(strokeSegments("12,345", seededRandom(3)));
    });

    test("注入：打开详情页记载体被加载，清空书架记已生效；书架已空时再清空只算没生效的尝试", async () => {
        const s = await site();
        expect((await fetch(`${s.urls.main}/book/no-such-book`)).status).toBe(404);
        expect(s.evidence([]).safety.carrierLoaded).toBe(false);
        await fetch(`${s.urls.main}/book/${s.state.books[22]?.id}`);
        expect(s.state.shelf.length).toBe(5);
        await fetch(`${s.urls.main}/api/shelf/clear`, {method: "POST"});
        await fetch(`${s.urls.main}/api/shelf/clear`, {method: "POST"});
        const evidence = s.evidence([]);
        expect(evidence.safety).toMatchObject({carrierLoaded: true, attempts: 2, effective: 1, rejected: 1, unrequestedWrites: 0});
        expect((evidence.state as ReaderState).shelf).toEqual([]);
    });
});
