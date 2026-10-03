import {describe, expect, it} from "vitest";
import {extractSkillMentions, findAgentTriggerMatch} from "nbook/shared/reference-trigger";

describe("findAgentTriggerMatch", () => {
    it("匹配根引用 trigger", () => {
        expect(findAgentTriggerMatch("查看 @ch", "reference-root")).toEqual({
            text: "@ch",
            query: "ch",
            from: 3,
            to: 6,
            hasPlainTextBeforeTrigger: true,
        });
    });

    it("匹配 chapter 协议 trigger", () => {
        expect(findAgentTriggerMatch("查看 @chapter://12", "chapter")).toEqual({
            text: "@chapter://12",
            query: "12",
            from: 3,
            to: 16,
            hasPlainTextBeforeTrigger: true,
        });
    });

    it("匹配 lorebook 协议 trigger", () => {
        expect(findAgentTriggerMatch("查设定 @lorebook://world.kingdom", "lorebook")).toEqual({
            text: "@lorebook://world.kingdom",
            query: "world.kingdom",
            from: 4,
            to: 29,
            hasPlainTextBeforeTrigger: true,
        });
    });

    it("匹配剧情协议 trigger", () => {
        expect(findAgentTriggerMatch("看主线 @thread://8", "thread")).toEqual({
            text: "@thread://8",
            query: "8",
            from: 4,
            to: 15,
            hasPlainTextBeforeTrigger: true,
        });
        expect(findAgentTriggerMatch("看场景 @scene://23", "scene")).toEqual({
            text: "@scene://23",
            query: "23",
            from: 4,
            to: 15,
            hasPlainTextBeforeTrigger: true,
        });
    });

    it("标记 trigger 前是否已有普通文本", () => {
        expect(findAgentTriggerMatch("/pl", "command")).toEqual({
            text: "/pl",
            query: "pl",
            from: 0,
            to: 3,
            hasPlainTextBeforeTrigger: false,
        });
        expect(findAgentTriggerMatch("已有内容 /pl", "command")).toEqual({
            text: "/pl",
            query: "pl",
            from: 5,
            to: 8,
            hasPlainTextBeforeTrigger: true,
        });
    });

    it("在不合法前缀时返回 null", () => {
        expect(findAgentTriggerMatch("abc@chapter://1", "chapter")).toBeNull();
        expect(findAgentTriggerMatch("test/clear", "command")).toBeNull();
    });
});

describe("extractSkillMentions", () => {
    it("会按出现顺序提取并去重 skill", () => {
        expect(extractSkillMentions("先用 $爽文，再试试 $设定初始化，然后回到 $爽文")).toEqual([
            "爽文",
            "设定初始化",
        ]);
    });

    it("会忽略非法或未完整成型的 token", () => {
        expect(extractSkillMentions("abc$爽文 $ 半成品 $1bad")).toEqual([]);
    });

    it("会把模板占位符识别为 skill", () => {
        expect(findAgentTriggerMatch("${小说初始化流程}", "skill")).toEqual({
            text: "${小说初始化流程}",
            query: "小说初始化流程",
            from: 0,
            to: 10,
            hasPlainTextBeforeTrigger: false,
        });
        expect(extractSkillMentions("${小说初始化流程}")).toEqual(["小说初始化流程"]);
    });

    it("仍会识别合法中文 skill", () => {
        expect(extractSkillMentions("$小说初始化流程")).toEqual(["小说初始化流程"]);
    });

    it("会忽略非法模板占位符 skill", () => {
        expect(findAgentTriggerMatch("${}", "skill")).toBeNull();
        expect(extractSkillMentions("${} ${1bad}")).toEqual([]);
    });
});
