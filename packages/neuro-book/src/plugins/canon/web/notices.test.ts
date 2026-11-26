/**
 * 保存后的提示的去处（notices.ts；docs/specs/canon/author-ui.md 输出 18）：三种页面有一个挂着时浮在页面上，都没挂着时是一条
 * 工作台通知（动作是“查看详情”，自己收起），新的顶掉旧的；窗口里没有工作台通知时一律留给页面那一份。页面那一份 6 秒后自己收起，
 * 计时是窗口里一份，暂停的来源都放开才接着计。
 */

import {describe, expect, it} from "bun:test";

import type {NotificationInput} from "nbook/plugins/workbench/shared/contracts";

import {createNotices, NOTICE_CLOSE_MS, NOTICE_MIN_AFTER_HOLD_MS} from "./notices";
import type {NoticeClock} from "./notices";

function recording() {
    const sent: NotificationInput[] = [];
    const opened: string[] = [];
    const notices = createNotices({
        workbench: {notify: (input) => {
            sent.push(input);
            return {id: String(sent.length), update: () => undefined, dismiss: () => undefined};
        }},
        receipt: (revision) => void opened.push(revision),
    });
    return {notices, sent, opened};
}

describe("保存后的提示", () => {
    it("有页面挂着时浮在页面上；页面都卸载以后是一条工作台通知（自己收起），点“查看详情”打开那次修订的回执，页面上那条不再留着", () => {
        const {notices, sent, opened} = recording();
        const release = notices.attach();
        notices.show({revision: "r1", title: "改外观"});
        expect(notices.current.value).toEqual({revision: "r1", title: "改外观"});
        expect(sent).toEqual([]);

        release();
        release();
        notices.show({revision: "r2", title: "记了一笔"});
        expect(notices.current.value).toBeNull();
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({tone: "success", message: "记了一笔", sticky: false, action: {label: {kind: "text", ns: "nbook.canon", key: "notice.receipt"}}});
        sent[0]!.action!.run();
        expect(opened).toEqual(["r2"]);
        // 带了位置的，通知里同样写出记在哪。
        notices.show({revision: "r3", title: "改年龄", where: "最初"});
        expect(sent[1]).toMatchObject({message: {kind: "text", ns: "nbook.canon", key: "notice.withWhere", params: {title: "改年龄", where: "最初"}}});
    });

    it("两个页面挂着时，卸载其中一个仍算有页面在前台", () => {
        const {notices, sent} = recording();
        const first = notices.attach();
        notices.attach();
        first();
        notices.show({revision: "r1", title: "改外观"});
        expect(notices.current.value?.revision).toBe("r1");
        expect(sent).toEqual([]);
    });

    it("调用方随即要打开条目页（新建条目）时，没有页面挂着也留给那一页，不发工作台通知", () => {
        const {notices, sent} = recording();
        notices.show({revision: "r1", title: "新建“魔杖”"}, {page: true});
        expect(notices.current.value?.revision).toBe("r1");
        expect(sent).toEqual([]);
    });

    it("窗口里没有工作台通知时，没有页面挂着也留在页面顶上那一份", () => {
        const notices = createNotices();
        notices.show({revision: "r1", title: "改外观"});
        expect(notices.current.value?.revision).toBe("r1");
        notices.dismiss();
        expect(notices.current.value).toBeNull();
    });
});

describe("Agent 改了设定的提示（author-ui.md 的 Agent 提示）", () => {
    it("另占一格：不顶掉作者自己的提示、不发工作台通知；再来的接着计数，指最近一次；关掉以后从头算；看改动记录交给路由", () => {
        const sent: NotificationInput[] = [];
        let revisions = 0;
        const notices = createNotices({workbench: {notify: (input) => {
            sent.push(input);
            return {id: String(sent.length), update: () => undefined, dismiss: () => undefined};
        }}, receipt: () => undefined, revisions: () => void (revisions += 1)});
        const detach = notices.attach();
        notices.show({revision: "r1", title: "作者改了名字"});
        notices.agentRevised({revision: "r2", title: "Agent 改外观"});
        notices.agentRevised({revision: "r3", title: "Agent 加别名"});
        expect(notices.current.value).toEqual({revision: "r1", title: "作者改了名字"});
        expect(notices.agent.value).toEqual({revision: "r3", title: "Agent 加别名", earlier: 1});
        detach();
        notices.agentRevised({revision: "r4", title: "Agent 又改"});
        expect(sent).toHaveLength(0);
        expect(notices.agent.value?.earlier).toBe(2);
        notices.dismissAgent();
        notices.agentRevised({revision: "r5", title: "Agent 再改"});
        expect(notices.agent.value).toEqual({revision: "r5", title: "Agent 再改", earlier: 0});
        notices.openRevisions();
        expect(revisions).toBe(1);
        // 还原的是提示里那一次时标成已还原（别的修订不算）；Agent 再写一次就是新的一条。
        notices.reverted("r4");
        expect(notices.agent.value?.undone).toBeUndefined();
        notices.reverted("r5");
        expect(notices.agent.value).toEqual({revision: "r5", title: "Agent 再改", earlier: 0, undone: true});
        notices.agentRevised({revision: "r6", title: "Agent 又写"});
        expect(notices.agent.value).toEqual({revision: "r6", title: "Agent 又写", earlier: 1});
    });
});

/** 手动的时钟：`advance` 走时间并触发到点的计时器。 */
function manualClock(): NoticeClock & {advance(ms: number): void; pending(): number} {
    let now = 0;
    let next = 0;
    const timers = new Map<number, {at: number; run: () => void}>();
    return {
        now: () => now,
        set: (run, ms) => {
            next += 1;
            timers.set(next, {at: now + ms, run});
            return next;
        },
        clear: (handle) => void timers.delete(handle as number),
        advance: (ms) => {
            now += ms;
            for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
                if (timer.at > now || !timers.has(id)) continue;
                timers.delete(id);
                timer.run();
            }
        },
        pending: () => timers.size,
    };
}

describe("页面那一份自己收起（输出 18）", () => {
    const setup = () => {
        const clock = manualClock();
        const notices = createNotices({workbench: null, receipt: () => undefined, clock});
        notices.attach();
        return {clock, notices};
    };

    it("6 秒后收起；新的一条顶掉旧的时从头计；关掉以后没有计时器留着", () => {
        const {clock, notices} = setup();
        notices.show({revision: "r1", title: "改外观"});
        clock.advance(NOTICE_CLOSE_MS - 1000);
        notices.show({revision: "r2", title: "记了一笔"});
        clock.advance(NOTICE_CLOSE_MS - 1);
        expect(notices.current.value?.revision).toBe("r2");
        clock.advance(1);
        expect(notices.current.value).toBeNull();
        notices.show({revision: "r3", title: "又改"});
        notices.dismiss();
        expect(clock.pending()).toBe(0);
    });

    it("暂停期间不收；几个来源都放开才按剩下的时间接着计，至少再留 0.8 秒；重复放开无效", () => {
        const {clock, notices} = setup();
        notices.show({revision: "r1", title: "改外观"});
        clock.advance(NOTICE_CLOSE_MS - 200);
        const pointer = notices.hold();
        const dialog = notices.hold();
        clock.advance(60_000);
        pointer();
        pointer();
        clock.advance(60_000);
        expect(notices.current.value?.revision).toBe("r1");
        dialog();
        clock.advance(NOTICE_MIN_AFTER_HOLD_MS - 1);
        expect(notices.current.value?.revision).toBe("r1");
        clock.advance(1);
        expect(notices.current.value).toBeNull();
    });

    it("暂停期间换了新的一条，放开后从头计 6 秒", () => {
        const {clock, notices} = setup();
        notices.show({revision: "r1", title: "改外观"});
        const release = notices.hold();
        notices.show({revision: "r2", title: "还原“改外观”"});
        clock.advance(60_000);
        release();
        clock.advance(NOTICE_CLOSE_MS - 1);
        expect(notices.current.value?.revision).toBe("r2");
        clock.advance(1);
        expect(notices.current.value).toBeNull();
    });

    it("页面卸载再挂上不影响计时：收起的不会回来，没收起的照原来的时间收", () => {
        const clock = manualClock();
        const notices = createNotices({workbench: null, receipt: () => undefined, clock});
        const first = notices.attach();
        notices.show({revision: "r1", title: "改外观"});
        first();
        clock.advance(3000);
        const second = notices.attach();
        clock.advance(3000);
        expect(notices.current.value).toBeNull();
        second();
        notices.attach();
        clock.advance(60_000);
        expect(notices.current.value).toBeNull();
    });

    it("Agent 的提示不自己收", () => {
        const {clock, notices} = setup();
        notices.agentRevised({revision: "r1", title: "Agent 改外观"});
        clock.advance(60_000);
        expect(notices.agent.value?.revision).toBe("r1");
    });
});
