/** 草稿的条数与过期（docs/specs/agent/conversation.md 输出 29）与 `@` 菜单（输出 28）。 */

import {describe, expect, test} from "bun:test";

import {DRAFT_TTL_MS, draftOf, MAX_DRAFTS, NO_DRAFTS, withDraft} from "./web/drafts";
import {createFileMentions} from "./web/mentions";

describe("草稿", () => {
    test("写、读、空文字删掉", () => {
        const one = withDraft(NO_DRAFTS, "a", "字", 100);
        expect(draftOf(one, "a", 100)).toBe("字");
        expect(draftOf(one, "b", 100)).toBeNull();
        expect(draftOf(withDraft(one, "a", "", 200), "a", 200)).toBeNull();
    });

    test("过期的读不到，写的时候丢掉；只留最近的几条", () => {
        const old = withDraft(NO_DRAFTS, "old", "字", 0);
        expect(draftOf(old, "old", DRAFT_TTL_MS + 1)).toBeNull();
        expect(withDraft(old, "new", "字", DRAFT_TTL_MS + 1).items.map((item) => item.session)).toEqual(["new"]);
        let many = NO_DRAFTS;
        for (let index = 0; index < MAX_DRAFTS + 3; index += 1) many = withDraft(many, `s${index}`, "字", index);
        expect(many.items).toHaveLength(MAX_DRAFTS);
        expect(draftOf(many, "s0", MAX_DRAFTS)).toBeNull();
        expect(draftOf(many, `s${MAX_DRAFTS + 2}`, MAX_DRAFTS)).toBe("字");
    });
});

describe("@ 菜单", () => {
    const texts = () => ({title: "项目文件", empty: "没有匹配", noProject: "没有作品", failed: "失败了"});
    const context = (query: string, trigger = "@") => ({trigger, query, atStart: false}) as never;

    test("先显示加载中，数据到了通知换函数；选中插入带方案的引用，文件名里的 # 编码；标题优先", async () => {
        let changes = 0;
        const mentions = createFileMentions({
            find: async () => ({ok: true, value: {items: [{path: "正文/第#3章.md", name: "第#3章.md", title: "雨夜"}, {path: "大纲.md", name: "大纲.md"}], truncated: false}}),
            texts,
            onChange: () => {
                changes += 1;
            },
        });
        expect(mentions.resolve(context("雨"))).toMatchObject({loading: true});
        await Promise.resolve();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(changes).toBe(1);
        const menu = mentions.resolve(context("雨"));
        expect(menu.items.map((item) => item.label)).toEqual(["雨夜", "大纲.md"]);
        expect(menu.items[0]!.insertText).toBe("[雨夜](project://正文/第%233章.md)");
    });

    test("没有打开作品时说明；查失败时说明，下一次再问；别的触发字符不管", async () => {
        const none = createFileMentions({find: null, texts, onChange: () => undefined});
        expect(none.resolve(context(""))).toMatchObject({items: [], emptyText: "没有作品"});
        expect(none.resolve(context("", "$")).items).toEqual([]);

        let calls = 0;
        const failing = createFileMentions({
            find: async () => {
                calls += 1;
                return {ok: false};
            },
            texts,
            onChange: () => undefined,
        });
        failing.resolve(context("x"));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(failing.resolve(context("x"))).toMatchObject({emptyText: "失败了"});
        expect(failing.resolve(context("x"))).toMatchObject({loading: true});
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(calls).toBe(2);
    });
});
