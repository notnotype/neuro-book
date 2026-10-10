/** 继续写作的地址参数（docs/specs/workbench/editor.md 输出 29）：解析与去掉参数都是纯函数。 */

import {describe, expect, it} from "bun:test";

import {continueRequestOf, withoutContinueParams} from "./web/continue-writing";

describe("Spec workbench.editor 输出 29：地址参数", () => {
    it("读出 open 与 at；没有 open 为 null；at 不是 end 时只打开", () => {
        expect(continueRequestOf("http://localhost/?project=book&open=project%3A%2F%2F%E7%AC%AC%E4%B8%80%E7%AB%A0.md&at=end")).toEqual({address: "project://第一章.md", reveal: "end"});
        expect(continueRequestOf("http://localhost/?project=book&open=project%3A%2F%2Fa.md")).toEqual({address: "project://a.md", reveal: null});
        expect(continueRequestOf("http://localhost/?project=book&open=project%3A%2F%2Fa.md&at=top")).toEqual({address: "project://a.md", reveal: null});
        expect(continueRequestOf("http://localhost/?project=book")).toBeNull();
        expect(continueRequestOf("http://localhost/?project=book&open=")).toBeNull();
    });

    it("去掉 open 与 at，project 与其它参数保留", () => {
        expect(withoutContinueParams("http://localhost/?project=book&open=project%3A%2F%2Fa.md&at=end")).toBe("http://localhost/?project=book");
        expect(withoutContinueParams("http://localhost/?open=x&project=book&at=end&debug=1#top")).toBe("http://localhost/?project=book&debug=1#top");
        expect(withoutContinueParams("http://localhost/?project=book")).toBe("http://localhost/?project=book");
    });
});
