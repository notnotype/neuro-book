import {describe, expect, it} from "vitest";
import {rpIntakeTools} from "nbook/server/agent/tools/rp-intake-tools";
import {createBuiltinTools} from "nbook/server/agent/tools";

describe("rp_intake tool confirmation gate", () => {
    it("P1/P2 RP 状态工具都注册为内置工具", () => {
        const keys = createBuiltinTools().map((tool) => tool.key);
        expect(keys).toContain("rp_intake");
        expect(keys).toContain("rp_turn");
    });

    it("确认权只属于 RP 状态页，Agent schema 不再暴露 confirm 或 pending 表单", () => {
        const tool = rpIntakeTools.rpIntake.runtime();
        expect(tool.userInputRequest).toBeUndefined();
        expect(JSON.stringify(tool.parameters)).not.toContain('"confirm"');
        expect(tool.description).toContain("status panel");
        expect(JSON.stringify(tool.validationSchema)).toContain('"checkpoint_bootstrap"');
        expect(JSON.stringify(tool.validationSchema)).toContain('"initialize_config"');
        expect(tool.description).toContain("do not hand-write");
        expect(JSON.stringify(tool.validationSchema)).not.toContain('"version"');
    });
});
