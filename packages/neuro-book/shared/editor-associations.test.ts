import {describe, expect, it} from "vitest";
import {EditorAssociationSettingsSchema, mergeEditorAssociations, resolveEditorLanguage} from "nbook/shared/editor-associations";
import {GlobalConfigUpdateDtoSchema, ProjectConfigDtoSchema} from "nbook/shared/dto/config.dto";

const languages = new Set(["markdown", "json", "html", "plaintext", "xml"]);

describe("编辑器关联配置", () => {
    it("项目逐扩展名覆盖全局，空项目映射仍继承全局", () => {
        const global = {associations: {".md": "code", ".note": "markdown"}, languageAssociations: {".note": "markdown"}};
        expect(mergeEditorAssociations(global, {associations: {".md": "markdown"}})).toEqual({
            associations: {".md": "markdown", ".note": "markdown"}, languageAssociations: {".note": "markdown"},
        });
        expect(mergeEditorAssociations(global, {associations: {}})).toEqual(global);
        expect(global.associations[".md"]).toBe("code");
    });

    it("语言覆盖不写视图关联，扩展名大小写统一", () => {
        const settings = mergeEditorAssociations({languageAssociations: {".note": "markdown"}});
        expect(resolveEditorLanguage("chapter.NOTE", settings.languageAssociations, languages)).toEqual({languageId: "markdown", diagnosis: null});
        expect(settings.associations[".note"]).toBeUndefined();
        expect(resolveEditorLanguage("chapter.MD", {}, languages).languageId).toBe("markdown");
        expect(resolveEditorLanguage("data.json", {}, languages).languageId).toBe("json");
    });

    it("未知语言按纯文本并诊断，保留原关联", () => {
        const associations = {".note": "missing"};
        expect(resolveEditorLanguage("a.note", associations, languages)).toMatchObject({languageId: "plaintext", diagnosis: expect.stringContaining("missing")});
        expect(associations).toEqual({".note": "missing"});
    });

    it("配置拒绝非法键和非字符串值，但保留形状合法未知ID", () => {
        expect(EditorAssociationSettingsSchema.safeParse({associations: {"*.md": "code"}}).success).toBe(false);
        expect(EditorAssociationSettingsSchema.safeParse({associations: {".md": []}}).success).toBe(false);
        expect(EditorAssociationSettingsSchema.parse({associations: {".md": "third.party"}}).associations).toEqual({".md": "third.party"});
    });

    it("HTTP更新不补写未提交的编辑器偏好或关联", () => {
        for (const schema of [GlobalConfigUpdateDtoSchema, ProjectConfigDtoSchema]) {
            expect(schema.parse({editor: {associations: {".md": "code"}}}).editor).toEqual({associations: {".md": "code"}});
            expect(schema.parse({editor: {markdown: {fontSize: 21}}}).editor).toEqual({markdown: {fontSize: 21}});
            expect(schema.parse({editor: {associations: {}}}).editor).toEqual({associations: {}});
        }
    });
});
