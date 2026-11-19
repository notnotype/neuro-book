import {describe, expect, it} from "bun:test";

import * as entry from "./index";

/** 入口的意图回写只有两个说清时机的函数（docs/specs/ui/workbench-layout.md 输出 49）：底下的零件漏传参数不报错，不交给宿主。 */
describe("nb-workbench-layout 的入口", () => {
    it("导出 applyGestureCommit、rebaseForOperation，不导出 rebaseIntents、fixedNodesOf", () => {
        expect(typeof entry.applyGestureCommit).toBe("function");
        expect(typeof entry.rebaseForOperation).toBe("function");
        expect(Object.hasOwn(entry, "rebaseIntents")).toBe(false);
        expect(Object.hasOwn(entry, "fixedNodesOf")).toBe(false);
    });
});
