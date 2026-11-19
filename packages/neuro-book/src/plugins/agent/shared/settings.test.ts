/** 恢复方式的设置项（docs/specs/agent/conversation.md 输出 47）：取值、缺省、所在分区与三项的文案。 */

import {describe, expect, test} from "bun:test";

import {Value} from "typebox/value";

import {completeSettingDeclaration} from "nbook/shared/settings";

import zhCN from "../locales/zh-CN.json";
import {agentSettings, RUN_GUARDS_SECTION} from "./settings";

describe("恢复方式 nbook.agent/resumeMode（输出 47）", () => {
    const {key, declaration} = agentSettings.settings.resumeMode;

    test("用户层，缺省合并，只认三种方式", () => {
        expect(key).toBe("nbook.agent/resumeMode");
        expect(declaration.layers).toEqual(["user"]);
        expect(declaration.default).toBe("merge");
        for (const mode of ["merge", "keep", "followups"]) expect(Value.Check(declaration.schema, mode)).toBe(true);
        expect(Value.Check(declaration.schema, "other")).toBe(false);
    });

    test("放在“运行可靠性”分区，三项写作“合并一起发”“保留原插话与排队”“按排队顺序”", () => {
        expect(declaration.section).toBe(RUN_GUARDS_SECTION);
        expect(zhCN.settingsSections.reliability.title).toBe("运行可靠性");
        const completed = completeSettingDeclaration({plugin: "nbook.agent", id: key, declaration}) as {choices: {value: string; title: {key: string}}[]};
        const titles = completed.choices.map((choice) => choice.title.key.replace(/^nbook\.agent:/, "").split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], zhCN));
        expect(titles).toEqual(["合并一起发", "保留原插话与排队", "按排队顺序"]);
    });
});
