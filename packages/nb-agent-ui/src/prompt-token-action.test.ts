import {describe, expect, it} from "bun:test";
import {promptTokenOutcome} from "./prompt-token-action";

const imageLabel = (number: number) => `图片 #${String(number)}`;

describe("点击标签的去向", () => {
    it("引用、选区、技能、文件发出动作；选区按行号写成 #L 形式", () => {
        expect(promptTokenOutcome({kind: "reference", label: "第一章", target: "chapter://c1"}, imageLabel)).toEqual({kind: "action", action: {type: "reference.open", target: "chapter://c1"}});
        expect(promptTokenOutcome({kind: "selection", path: "ch03.md", startLine: 12, endLine: 40}, imageLabel)).toEqual({kind: "action", action: {type: "reference.open", target: "ch03.md#L12-L40"}});
        expect(promptTokenOutcome({kind: "selection", path: "ch04.md", startLine: 5, endLine: 5}, imageLabel)).toEqual({kind: "action", action: {type: "reference.open", target: "ch04.md#L5"}});
        expect(promptTokenOutcome({kind: "selection", path: "ch05.md", startLine: null, endLine: null}, imageLabel)).toEqual({kind: "action", action: {type: "reference.open", target: "ch05.md"}});
        expect(promptTokenOutcome({kind: "skill", name: "writer"}, imageLabel)).toEqual({kind: "action", action: {type: "skill.open", name: "writer"}});
        expect(promptTokenOutcome({kind: "file", number: 1, name: "设定.pdf", target: "session://attachments/设定.pdf"}, imageLabel)).toEqual({kind: "action", action: {type: "attachment.open", target: "session://attachments/设定.pdf"}});
    });

    it("图片请求预览，会话内短地址的文件名写进标题；还没上传完、命令与粘贴标记不做任何事", () => {
        expect(promptTokenOutcome({kind: "image", number: 1, target: "ok:sketch"}, imageLabel)).toEqual({kind: "preview", image: {locator: "ok:sketch", name: "图片 #1"}});
        expect(promptTokenOutcome({kind: "image", number: 2, target: "session://attachments/地图.png"}, imageLabel)).toEqual({kind: "preview", image: {locator: "session://attachments/地图.png", name: "图片 #2 · 地图.png"}});
        expect(promptTokenOutcome({kind: "image", number: 3, target: null}, imageLabel)).toBeNull();
        expect(promptTokenOutcome({kind: "file", number: 4, name: "x.pdf", target: null}, imageLabel)).toBeNull();
        expect(promptTokenOutcome({kind: "command", name: "plan"}, imageLabel)).toBeNull();
        expect(promptTokenOutcome({kind: "paste", number: 5}, imageLabel)).toBeNull();
    });
});
