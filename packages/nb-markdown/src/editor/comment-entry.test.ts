/** 浮层何时出（docs/specs/workbench/markdown-editing.md 输出 30、验收 13）：进入才弹，在里面走动不弹。 */

import {describe, expect, it} from "bun:test";

import {commentEntry} from "./comment-entry";
import type {CommentEntry, CommentEntryEvent} from "./comment-entry";

const event = (inside: string[], overrides: Partial<CommentEntryEvent> = {}): CommentEntryEvent => ({inside, selectionEmpty: true, docChanged: false, composing: false, ...overrides});

/** 依次喂一串事件，返回每一步的结果。 */
function run(events: CommentEntryEvent[]): CommentEntry[] {
    const results: CommentEntry[] = [];
    let previous: ReadonlySet<string> = new Set();
    for (const next of events) {
        const result = commentEntry(previous, next);
        results.push(result);
        previous = result.inside;
    }
    return results;
}

const opens = (events: CommentEntryEvent[]): boolean[] => run(events).map((result) => result.open);

describe("进入一条批注才弹卡片", () => {
    it("从外面走进来弹；在里面继续走动不弹；走出去再进来又弹", () => {
        expect(opens([event([]), event(["a"]), event(["a"]), event([]), event(["a"])])).toEqual([false, true, false, false, true]);
    });

    it("在批注中间打字后按方向键不弹：打字的事务把光标处的批注记为已看过", () => {
        expect(opens([event([]), event(["a"], {docChanged: true}), event(["a"])])).toEqual([false, false, false]);
        expect(run([event(["a"], {docChanged: true})])[0]?.close).toBe(true);
    });

    it("重叠的批注：走进另一条弹，已经在里面的不再弹", () => {
        expect(opens([event(["a"]), event(["a", "b"]), event(["a", "b"]), event(["b"])])).toEqual([true, true, false, false]);
    });

    it("输入法组字中不弹，但记下光标处的批注，组字结束后同一处不弹", () => {
        expect(opens([event([]), event(["a"], {composing: true}), event(["a"])])).toEqual([false, false, false]);
    });

    it("选区不空时收起并忘掉：选区折回批注里算进入", () => {
        const results = run([event(["a"]), event(["a"], {selectionEmpty: false}), event(["a"])]);
        expect(results.map((result) => result.open)).toEqual([true, false, true]);
        expect(results[1]?.close).toBe(true);
    });
});
