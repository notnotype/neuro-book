import {describe, expect, it} from "vitest";
import {
    MARKDOWN_FONT_OPTIONS,
    MARKDOWN_NUMBER_LIMITS,
    MONACO_FONT_OPTIONS,
    MONACO_NUMBER_LIMITS,
    clampEditorNumber,
    clampMonacoNumber,
    editorFontLabel,
} from "./editor-prefs";

describe("editor 偏好数值夹紧", () => {
    it("越界输入夹到区间边界", () => {
        expect(clampEditorNumber("fontSize", "99")).toBe(MARKDOWN_NUMBER_LIMITS.fontSize.max);
        expect(clampEditorNumber("fontSize", "2")).toBe(MARKDOWN_NUMBER_LIMITS.fontSize.min);
        expect(clampEditorNumber("lineHeight", "9")).toBe(MARKDOWN_NUMBER_LIMITS.lineHeight.max);
        expect(clampMonacoNumber("lineHeight", "1")).toBe(MONACO_NUMBER_LIMITS.lineHeight.min);
        expect(clampMonacoNumber("tabSize", "64")).toBe(MONACO_NUMBER_LIMITS.tabSize.max);
    });

    it("区间内的原值透传，含小数步长", () => {
        expect(clampEditorNumber("lineHeight", "1.85")).toBe(1.85);
        expect(clampEditorNumber("paragraphIndentEm", "0.25")).toBe(0.25);
        expect(clampMonacoNumber("tabSize", "3")).toBe(3);
    });

    it("空串与非数字不写回", () => {
        expect(clampEditorNumber("fontSize", "")).toBeNull();
        expect(clampEditorNumber("contentWidth", "   ")).toBeNull();
        expect(clampEditorNumber("fontSize", "abc")).toBeNull();
        expect(clampMonacoNumber("fontSize", "")).toBeNull();
        expect(clampMonacoNumber("tabSize", "4px")).toBeNull();
    });
});

describe("editor 字体候选", () => {
    it("正文与源码候选都给出非空展示名", () => {
        expect(MARKDOWN_FONT_OPTIONS).toHaveLength(5);
        expect(MONACO_FONT_OPTIONS).toHaveLength(4);
        for (const option of [...MARKDOWN_FONT_OPTIONS, ...MONACO_FONT_OPTIONS]) {
            expect(option.value).not.toBe("");
            expect(Boolean(option.labelKey) || Boolean(option.label)).toBe(true);
        }
    });

    it("有 i18n key 的候选走翻译，品牌字体名保持字面量", () => {
        const translate = (key: string) => `t:${key}`;
        expect(editorFontLabel(MARKDOWN_FONT_OPTIONS[0]!, translate)).toBe("t:settings.editor.fontChineseSerif");
        const jetBrains = MONACO_FONT_OPTIONS.find((option) => option.label === "JetBrains Mono");
        expect(jetBrains).toBeDefined();
        expect(editorFontLabel(jetBrains!, translate)).toBe("JetBrains Mono");
    });
});
