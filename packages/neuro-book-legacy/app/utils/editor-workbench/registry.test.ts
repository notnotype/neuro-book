import {h} from "vue";
import {describe, expect, it} from "vitest";
import {createEditorRegistry, resolveEditorAssociation} from "./registry";
import type {EditorContribution, EditorResource} from "nbook/app/components/editor-workbench/editor-view.types";

function contribution(id: string, supports: (resource: EditorResource) => boolean = (r) => r.editable): EditorContribution {
    return {id, titleKey: id, iconClass: "", supports, render: () => h("div", id)};
}
const code = contribution("code");
const markdown = contribution("markdown", (r) => r.editable && r.languageId === "markdown");

function registry() {
    const result = createEditorRegistry([code, markdown, contribution("test.preview")]);
    if (!result.ok) throw new Error(result.reason);
    return result.value;
}

describe("编辑器注册表", () => {
    it("拒绝重复ID与缺少源码回退", () => {
        expect(createEditorRegistry([code, code]).ok).toBe(false);
        expect(createEditorRegistry([markdown]).ok).toBe(false);
    });
    it("第三视图可注册选择且标签显式选择优先配置", () => {
        const entries = registry();
        const resource = {path: "a.md", languageId: "markdown", editable: true};
        expect(entries.available(resource).map((entry) => entry.id)).toContain("test.preview");
        expect(resolveEditorAssociation({registry: entries, resource, requestedId: "test.preview", associations: {".md": "markdown"}}).editor?.id).toBe("test.preview");
    });
    it("未知或不适用的视图回落源码但不改原关联", () => {
        const entries = registry();
        const associations = {".json": "missing", ".md": "markdown"};
        for (const path of ["a.json", "a.md"]) {
            const result = resolveEditorAssociation({registry: entries, resource: {path, languageId: "plaintext", editable: true}, requestedId: null, associations});
            expect(result.editor?.id).toBe("code");
            expect(result.diagnosis).not.toBeNull();
        }
        expect(associations).toEqual({".json": "missing", ".md": "markdown"});
    });
    it("二进制不因关联得到编辑器", () => {
        expect(resolveEditorAssociation({registry: registry(), resource: {path: "image.png", languageId: "plaintext", editable: false}, requestedId: "code", associations: {}}).editor).toBeNull();
    });
});
