/**
 * 保存后的提示的去处（notices.ts；docs/specs/canon/author-ui.md 输出 18）：三种页面有一个挂着时显示在页面顶上，都没挂着时是一条
 * 工作台通知（动作是“看回执”），新的顶掉旧的；窗口里没有工作台通知时一律留在页面顶上那一份。
 */

import {describe, expect, it} from "bun:test";

import type {NotificationInput} from "nbook/plugins/workbench/shared/contracts";

import {createNotices} from "./notices";

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
    it("有页面挂着时在页面顶上；页面都卸载以后是一条工作台通知，点“看回执”打开那次修订的回执，页面顶上那条不再留着", () => {
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
        expect(sent[0]).toMatchObject({tone: "success", message: "记了一笔", action: {label: {kind: "text", ns: "nbook.canon", key: "notice.receipt"}}});
        sent[0]!.action!.run();
        expect(opened).toEqual(["r2"]);
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

    it("窗口里没有工作台通知时，没有页面挂着也留在页面顶上那一份", () => {
        const notices = createNotices();
        notices.show({revision: "r1", title: "改外观"});
        expect(notices.current.value?.revision).toBe("r1");
        notices.dismiss();
        expect(notices.current.value).toBeNull();
    });
});
