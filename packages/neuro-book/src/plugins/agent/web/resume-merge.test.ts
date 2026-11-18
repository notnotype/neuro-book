/**
 * 恢复方式“合并一起发”的合成（docs/specs/agent/conversation.md 输出 47、50）。
 */
import {describe, expect, test} from "bun:test";

import {mergeHeld} from "./resume-merge";

const image = (n: number, uri: string) => `![image #${String(n)}](${uri})`;

describe("合并留着的话", () => {
    test("按入队顺序、空一行；附件随文字、同一地址只带一次；#N 整体重新编号；replaces 带读到时的修改次数", () => {
        const merged = mergeHeld(
            [
                {id: "a", edits: 0, text: `看这张 ${image(1, "session://attachments/a.png")}`, attachments: [{uri: "session://attachments/a.png"}]},
                {id: "b", edits: 2, text: `还有这张 ${image(1, "session://attachments/b.png")}`, attachments: [{uri: "session://attachments/b.png"}, {uri: "session://attachments/a.png"}]},
            ],
            {text: "两张一起看"},
        );
        expect(merged.input.text).toBe(`看这张 ${image(1, "session://attachments/a.png")}\n\n还有这张 ${image(2, "session://attachments/b.png")}\n\n两张一起看`);
        expect(merged.input.attachments).toEqual([{uri: "session://attachments/a.png"}, {uri: "session://attachments/b.png"}]);
        expect(merged.replaces).toEqual([{id: "a", edits: 0}, {id: "b", edits: 2}]);
    });

    test("空着继续时只有留着的话；没有附件时不带附件字段", () => {
        expect(mergeHeld([{id: "a", edits: 0, text: "一"}, {id: "b", edits: 0, text: "二"}], null)).toEqual({input: {text: "一\n\n二"}, replaces: [{id: "a", edits: 0}, {id: "b", edits: 0}]});
    });
});
