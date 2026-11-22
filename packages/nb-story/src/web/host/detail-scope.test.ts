/**
 * 一张详情里的会话（`scopeSession`，docs/specs/story/viewer.md 输出 67）：卡片里的链接换它所在的那张，关闭关这一张，
 * 其余原样是会话的（getter 每次现读）。
 */

import {describe, expect, it} from "bun:test";

import type {BookSession} from "./book";
import {scopeSession} from "./detail-scope";
import type {DetailRequest, DetailTarget} from "./details";

/** 只有这几项的会话：记下打开到哪一张；`info` 是 getter，换 `version` 就换。 */
function fakeSession() {
    const opened: Array<{request: DetailRequest; target: DetailTarget}> = [];
    let version = 1;
    const session = {
        get info() {
            return {version};
        },
        openDetail(request: DetailRequest, target: DetailTarget) {
            opened.push({request, target});
        },
        openCard(entity: string) {
            opened.push({request: {kind: "card", entity}, target: "active"});
        },
        openBeside() {},
        closeDrawer() {
            throw new Error("关的应该是这一张，不是整块收起");
        },
    };
    return {session: session as unknown as BookSession, opened, bump: () => (version += 1)};
}

describe("scopeSession", () => {
    it("四种打开都换所在的那张（`{key}`），不按最近点过的", () => {
        const {session, opened} = fakeSession();
        const scoped = scopeSession(session, 7, () => {});
        scoped.openCard("e1");
        scoped.openCard("e1", "relations");
        scoped.openSource("3.4");
        scoped.openParagraph(3, 4);
        scoped.openNode("n1", "节点");
        expect(opened).toEqual([
            {request: {kind: "card", entity: "e1"}, target: {key: 7}},
            {request: {kind: "card", entity: "e1", tab: "relations"}, target: {key: 7}},
            {request: {kind: "source", ref: "3.4"}, target: {key: 7}},
            {request: {kind: "para", chapter: 3, paragraph: 4}, target: {key: 7}},
            {request: {kind: "node", id: "n1", label: "节点"}, target: {key: 7}},
        ]);
    });
    it("关闭关这一张；没覆盖的照旧是会话的，getter 每次现读", () => {
        const {session, bump} = fakeSession();
        let closed = 0;
        const scoped = scopeSession(session, 7, () => (closed += 1));
        scoped.closeDrawer();
        expect(closed).toBe(1);
        expect(scoped.openBeside).toBe(session.openBeside);
        const version = () => (scoped.info as unknown as {version: number}).version;
        expect(version()).toBe(1);
        bump();
        expect(version()).toBe(2);
    });
});
