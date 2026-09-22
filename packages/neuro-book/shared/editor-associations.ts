import {z} from "zod";
import {resolveMonacoLanguage, resolveWorkspaceFileExtension} from "nbook/shared/editor-workbench";

export const EditorAssociationMapSchema = z.record(
    z.string().regex(/^\.[a-z0-9][a-z0-9_-]*$/u),
    z.string().min(1).regex(/^\S+$/u),
);
export const EditorAssociationSettingsSchema = z.object({
    associations: EditorAssociationMapSchema.default({}),
    languageAssociations: EditorAssociationMapSchema.default({}),
});
export type EditorAssociationSettings = z.infer<typeof EditorAssociationSettingsSchema>;
export const DEFAULT_EDITOR_ASSOCIATIONS: Readonly<Record<string, string>> = Object.freeze({".md": "markdown"});

/** 两层显式配置按扩展名叠加；返回有效投影，不作为任何一层的写回值。 */
export function mergeEditorAssociations(
    global: Partial<EditorAssociationSettings> | undefined,
    project?: Partial<EditorAssociationSettings>,
): EditorAssociationSettings {
    return {
        associations: {...DEFAULT_EDITOR_ASSOCIATIONS, ...global?.associations, ...project?.associations},
        languageAssociations: {...global?.languageAssociations, ...project?.languageAssociations},
    };
}

export function resolveEditorLanguage(
    path: string,
    associations: Readonly<Record<string, string>>,
    availableLanguageIds: ReadonlySet<string>,
): {languageId: string; diagnosis: string | null} {
    const requested = associations[resolveWorkspaceFileExtension(path)] ?? resolveMonacoLanguage(path);
    if (requested === "plaintext" || availableLanguageIds.has(requested)) {
        return {languageId: requested, diagnosis: null};
    }
    return {languageId: "plaintext", diagnosis: `无法使用语言“${requested}”，当前按纯文本编辑。`};
}
