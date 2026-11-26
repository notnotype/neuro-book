/**
 * Agent 交回的主文字（backend/agent-entry-text.ts；docs/specs/canon/agent-tools.md 输出 6、7）：工具测试里造不出的几支（出错的块、
 * 读的时候栈溢出）在这里按纯函数测；其余经真实工具的在 agent-tools.test.ts。
 */

import {describe, expect, it} from "bun:test";

import {agentBlockText} from "./agent-entry-text";

const keys = new Map([["jin", "tmp:jin"]]);

describe("Agent 交回的一块主文字", () => {
    it("出错的块（读到的就是源文）原样写，不去值、不改写法；$代号照换", () => {
        const source = '<div>旧</div>\n\n<V  of="a.b"/> 与 <Ref id="$jin" />';
        expect(agentBlockText(source, keys, {verbatim: true})).toEqual({source: '<div>旧</div>\n\n<V  of="a.b"/> 与 <Ref id="tmp:jin" />', notes: []});
    });

    it("不是这一批前面的代号拒收；去值后写成规范写法", () => {
        expect(agentBlockText('<Ref id="$nobody" />', keys)).toEqual({problem: expect.stringContaining("$nobody 不是这一批前面 create 的代号")});
        expect(agentBlockText('<V  of="a.b">3</V>', keys)).toEqual({source: '<V of="a.b" />', notes: []});
    });

    it("嵌套深到读的时候栈溢出：回一句话，不抛", () => {
        expect(agentBlockText(`${"> ".repeat(30_000)}字`, keys)).toEqual({problem: "这一块嵌套太深，读不出结构：把引用、列表、强调展开一些再写。"});
    });
});
