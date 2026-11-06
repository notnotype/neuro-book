/**
 * “我的主题”（docs/specs/theme/editor.md）：用户自己做的主题声明，存在 Storage 的用户记录里，和插件主题进同一个主题目录。
 * 声明的形状与校验和插件主题是同一份（`themes.ts`），多出来的只有 id 的写法与素材的写法。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import {defineRecord} from "nbook/shared/storage";

import {declarationProblem, ThemeDeclarationSchema} from "./themes";
import type {ThemeDeclaration} from "./themes";

/** 我的主题的 id：冒号不会出现在插件 id 里，所以不会和第三方的撞。 */
export const USER_THEME_ID = /^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** 主题目录里“我的主题”用的插件名：素材地址按它解析（`user://theme-assets/`），不是真的插件。 */
export const USER_THEME_PLUGIN = "user";

/** 素材文件名：内容的 SHA-256 加按字节判定的扩展名（`nbook.files` 的写入路由算出来的）。 */
export const THEME_ASSET_NAME = /^[0-9a-f]{64}\.(?:png|jpg|webp)$/u;

export const UserThemeSchema = Type.Object({
    id: Type.String({pattern: USER_THEME_ID.source}),
    declaration: ThemeDeclarationSchema,
    /** 编辑器自己的数据：哪些配色项是手改过的（再推导时不覆盖）。声明与导出的插件里没有它。 */
    editor: Type.Optional(Type.Object({touched: Type.Array(Type.String())}, {additionalProperties: false})),
}, {additionalProperties: false});

export type UserTheme = Static<typeof UserThemeSchema>;

/**
 * 记录值：用对象包一层（Storage 的记录顶层必须是对象）。条目在记录层只当“任意值”：一条坏条目（别的版本写的、手改坏的）让整个
 * 记录被 Storage 判为损坏，别的正常主题也跟着消失；所以记录只验容器，条目由 `userThemeProblem` 逐条验，坏条目留在记录里不改写、
 * 只是不进主题列表也不进编辑器。
 */
export const UserThemesSchema = Type.Object({themes: Type.Array(Type.Unknown())}, {additionalProperties: false});

export type UserThemes = Static<typeof UserThemesSchema>;

/** 记录里合格的条目；坏条目跳过。 */
export const validUserThemes = (themes: ReadonlyArray<unknown>): ReadonlyArray<UserTheme> => themes.filter((theme) => userThemeProblem(theme) === null) as ReadonlyArray<UserTheme>;

/** 每套声明几 KB，512 KiB 够放一百多套带 `editor` 标记的主题；素材不在记录里。 */
export const USER_THEMES_RECORD = defineRecord({key: "user-themes", scope: "user", locality: "shared", version: 1, maxBytes: 512 * 1024, schema: UserThemesSchema});

/** 一条不合格的原因；合格为 null。读取时逐条过，不合格的那一条不进主题目录，别的照常。 */
export function userThemeProblem(value: unknown): string | null {
    if (!Value.Check(UserThemeSchema, value)) return "不是合法的“我的主题”条目";
    const {id, declaration} = value as UserTheme;
    const names = [declaration.light.scene, declaration.dark.scene].filter((scene): scene is string => scene !== undefined);
    const wrong = names.find((name) => !THEME_ASSET_NAME.test(name));
    if (wrong !== undefined) return `主题 ${id} 的场景图要写素材文件名：${wrong}`;
    // 用户层的素材只有按哈希命名的场景图，图标集与工作态场景的相对路径在这里没有可解析的位置（复制与导入时丢弃，见 theme.editor）。
    for (const look of [declaration.light, declaration.dark]) {
        if (look.icons !== undefined || look.workingScene !== undefined) return `主题 ${id} 不收图标集与工作态场景：“我的主题”只有一张场景图的素材`;
    }
    return declarationProblem(id, declaration);
}

/**
 * 放进用户层之前去掉用户层放不下的东西：图标集与工作态场景是插件包内的素材路径，用户素材只有按内容摘要命名的场景图。复制插件主题与
 * 导入主题包都用它（docs/specs/theme/editor.md 边界与兼容）；返回新对象，不改入参。
 */
export function forUserLayer(declaration: ThemeDeclaration): ThemeDeclaration {
    const strip = ({icons: _icons, workingScene: _working, ...look}: ThemeDeclaration["light"]): ThemeDeclaration["light"] => look;
    return {...declaration, light: strip(declaration.light), dark: strip(declaration.dark)};
}
