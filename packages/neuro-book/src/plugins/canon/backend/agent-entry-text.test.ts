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
        expect(agentBlockText('<div>旧</div>', keys, {verbatim: true, current: '<div>旧</div>'})).toEqual({source: "<div>旧</div>", notes: [], unchanged: true});
    });

    it("不是这一批前面的代号拒收；去值后写成规范写法", () => {
        expect(agentBlockText('<Ref id="$nobody" />', keys)).toEqual({problem: expect.stringContaining("$nobody 不是这一批前面 create 的代号")});
        expect(agentBlockText('<V  of="a.b">3</V>', keys)).toEqual({source: '<V of="a.b" />', notes: []});
    });

    it("开头的 BOM 先去掉再读：缩进代码块里的标签照原文；当时的文字里已有的 $ 写法按次数原样留着，多出来的才当代号；换完代号再比长度", () => {
        const bom = String.fromCharCode(0xfeff);
        expect(agentBlockText(`${bom}    <V of="a.b">3</V>`, keys)).toEqual({source: '    <V of="a.b">3</V>', notes: []});
        const current = '作者写的 <Ref id="$jin" name="已删除的条目" />';
        expect(agentBlockText('作者写的 <Ref id="$jin" />，新写的 <Ref id="$jin" />', keys, {current})).toEqual({source: '作者写的 <Ref id="$jin" />，新写的 <Ref id="tmp:jin" />', notes: [], unchanged: false});
        expect(agentBlockText('作者写的 <Ref id="$jin" />', keys, {current})).toEqual({source: '作者写的 <Ref id="$jin" />', notes: [], unchanged: true});
        const full = `${"字".repeat(50_000 - '<Ref id="$jin" />'.length)}<Ref id="$jin" />`;
        expect(agentBlockText(full, keys)).toEqual({problem: "一块主文字最多 50000 字，拆成几块（addBlock）。"});
    });

    it("嵌套深到读的时候栈溢出：回一句话，不抛", () => {
        expect(agentBlockText(`${"> ".repeat(30_000)}字`, keys)).toEqual({problem: "这一块嵌套太深，读不出结构：把引用、列表、强调展开一些再写。"});
    });
});
