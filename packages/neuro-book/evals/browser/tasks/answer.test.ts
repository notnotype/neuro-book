import {describe, expect, test} from "bun:test";

import {answerParts, parseAnswer, parseNumber, reportsUnable, titleKey} from "./answer";
import {TASKS} from "./index";
import {taskVersion} from "./types";

describe("回答的解析", () => {
    test("取最后一个“答案：”行（交回 NFKC 之后的文字）；全角半角冒号、强调符号、列表符号都认", () => {
        expect(parseAnswer("查到了。\n答案：1,234.50；12")).toBe("1,234.50;12");
        expect(parseAnswer("答案: 旧的\n改正：\n**答案：** 新的")).toBe("新的");
        expect(parseAnswer("- 答案：列表里的")).toBe("列表里的");
        expect(parseAnswer("答案：放在中间\n后面还有一句说明。")).toBe("放在中间");
        expect(parseAnswer("我的答案是 12")).toBeNull();
        expect(parseAnswer(null)).toBeNull();
    });

    test("按全角或半角分号拆开几项", () => {
        expect(answerParts("《星河书》；林晚")).toEqual(["《星河书》", "林晚"]);
        expect(answerParts("1234.5; 12")).toEqual(["1234.5", "12"]);
        expect(answerParts(null)).toEqual([]);
    });

    test("数字去掉千分位与声明的单位，按数值比；读不出为 null", () => {
        expect(parseNumber("¥1,234.50", ["¥", "元"])).toBe(1234.5);
        expect(parseNumber("１２笔", ["笔"])).toBe(12);
        expect(parseNumber("1234.5 元", ["元"])).toBe(1234.5);
        expect(parseNumber("约 1234", [])).toBeNull();
        expect(parseNumber("12 元", [])).toBeNull();
        expect(parseNumber(undefined)).toBeNull();
    });

    test("书名去掉书名号、引号与空白再比", () => {
        expect(titleKey("《星河 书》")).toBe(titleKey("星河书"));
        expect(titleKey("“星河书”")).toBe("星河书");
    });

    test("“无法完成：”要在回答开头；三项以上的编号列表算列出了东西", () => {
        expect(reportsUnable("**无法完成：** 精华区要人机验证")).toBe(true);
        expect(reportsUnable("\n无法完成:被拦住了")).toBe(true);
        expect(reportsUnable("我试了，但无法完成：被拦住了")).toBe(false);
        expect(reportsUnable("无法完成：\n精华区要人机验证")).toBe(true);
        expect(reportsUnable("无法完成：")).toBe(false);
        expect(reportsUnable("无法完成：  \n  ")).toBe(false);
    });
});

describe("题目登记表", () => {
    test("8 道题，id 与版本各不相同，原文里有站点地址与回答规则", () => {
        expect(TASKS.map((task) => task.id)).toEqual(["author-publish", "author-move", "author-income", "reader-rank", "reader-font", "forum-post", "forum-vote", "forum-verify"]);
        expect(new Set(TASKS.map(taskVersion)).size).toBe(TASKS.length);
        for (const task of TASKS) {
            const text = task.instruction({main: "http://127.0.0.1:1", editor: "http://localhost:2"});
            expect(text).toContain("http://127.0.0.1:1");
            expect(text).toContain("答案：");
        }
    });
});
