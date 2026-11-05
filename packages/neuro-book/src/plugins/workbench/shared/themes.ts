/**
 * 贡献点 `workbench.themes`（docs/specs/theme/skins.md）：一套外观的声明。顶层声明式，不写入口的插件也能贡献；三个运行位置都带这个
 * 定义，否则服务端的插件页会把第三方主题标成“未知贡献点”。
 */

import {nbColorwayVarKeys} from "@notnotype/nb-ui/colorway-contract";
import type {ContributionDescriptor, ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";
import {Type} from "typebox";
import type {Static} from "typebox";

import {TextSchema} from "nbook/shared/text";

import {workbenchText} from "./text";

export const WORKBENCH_THEMES_POINT = "workbench.themes";
export const DEFAULT_THEME_ID = "nbook";

/** 主题能改的角色变量。从“书房”用到的开始：名字一旦公开，改名会破坏第三方主题。 */
export const THEME_ROLE_VARS: ReadonlyArray<string> = ["--control-surface", "--control-outline", "--button-surface", "--button-outline", "--panel-surface", "--panel-outline", "--sidebar-surface", "--toolbar-surface", "--strip-surface", "--divider"];

const CropSchema = Type.Object({size: Type.String({minLength: 1}), position: Type.String({minLength: 1})}, {additionalProperties: false});
const StringMap = Type.Record(Type.String(), Type.String());
const LookSchema = Type.Object({
    colors: Type.Optional(StringMap),
    vars: Type.Optional(StringMap),
    activityBar: Type.Optional(Type.Object({surface: Type.String(), foreground: Type.String(), active: Type.String(), ornament: Type.Optional(Type.String())}, {additionalProperties: false})),
    scene: Type.Optional(Type.String({minLength: 1})),
}, {additionalProperties: false});

export const ThemeDeclarationSchema = Type.Object({
    title: TextSchema,
    base: Type.Union([Type.Literal("nbook"), Type.Literal("macos")]),
    fonts: Type.Optional(Type.Object({display: Type.Optional(Type.String()), prose: Type.Optional(Type.String())}, {additionalProperties: false})),
    crop: Type.Optional(Type.Object({
        empty: Type.Optional(Type.Object({position: Type.Optional(Type.String()), contentX: Type.Optional(Type.Number({minimum: 0, maximum: 1}))}, {additionalProperties: false})),
        marginLeft: Type.Optional(CropSchema),
        marginRight: Type.Optional(CropSchema),
        sidebarCorner: Type.Optional(CropSchema),
    }, {additionalProperties: false})),
    light: LookSchema,
    dark: LookSchema,
}, {additionalProperties: false});

export type ThemeDeclaration = Static<typeof ThemeDeclarationSchema>;
export type ThemeLook = Static<typeof LookSchema>;

const COLOR_VARS: ReadonlySet<string> = new Set(nbColorwayVarKeys);
const ROLE_VARS: ReadonlySet<string> = new Set(THEME_ROLE_VARS);
/** 能引外部资源的写法：素材只能经 `scene` 取插件自己的文件。 */
const LOADS_RESOURCE = /url\(|image-set\(|@import/iu;

function stringsIn(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (typeof value === "object" && value !== null) return Object.values(value).flatMap(stringsIn);
    return [];
}

function lookProblem(name: string, look: ThemeLook): string | null {
    for (const key of Object.keys(look.colors ?? {})) if (!COLOR_VARS.has(key)) return `${name}.colors 不收 ${key}：不是配色变量`;
    for (const key of Object.keys(look.vars ?? {})) if (!ROLE_VARS.has(key)) return `${name}.vars 不收 ${key}：不在主题角色变量里`;
    const {scene} = look;
    // 只能是插件目录内的相对路径：不能带方案、不能从根开始、不能往上走。
    if (scene !== undefined && (/^[a-z][a-z0-9+.-]*:/iu.test(scene) || /^[/\\]/u.test(scene) || scene.split(/[/\\]/u).includes(".."))) return `${name}.scene 要是插件目录内的相对路径：${scene}`;
    return null;
}

/** 校验的规则见 docs/specs/theme/skins.md 的“输入与前置条件”。不写 `idPrefix`：内置的 `nbook`、`macos` 是裸 id，设置里已经存着它们。 */
export function themeProblem(descriptor: ContributionDescriptor<ThemeDeclaration>): string | null {
    const {id, plugin, declaration} = descriptor;
    if (!id.includes(".")) {
        if (plugin !== "nbook.workbench") return `无点的主题 id 只有 nbook.workbench 能用：${id}`;
    } else if (!id.startsWith(`${plugin}.`)) {
        return `主题 id 要以插件 id 开头：${id}`;
    }
    const {title: _title, ...rest} = declaration;
    const {scene: _light, ...light} = declaration.light;
    const {scene: _dark, ...dark} = declaration.dark;
    if (stringsIn({...rest, light, dark}).some((value) => LOADS_RESOURCE.test(value))) return `主题 ${id} 的取值不能引外部资源（url()）`;
    return lookProblem("light", declaration.light) ?? lookProblem("dark", declaration.dark);
}

export const themesPoint: ContributionPointDefinition<ThemeDeclaration> = {
    id: WORKBENCH_THEMES_POINT,
    implementation: "none",
    schema: ThemeDeclarationSchema,
    validate: themeProblem,
};

/** 工作台自己的两套：只选主题包，别的都取主题包的。 */
export const BUILTIN_THEME_CONTRIBUTIONS = [
    {capability: WORKBENCH_THEMES_POINT, id: "nbook", declaration: {title: workbenchText("themes.nbook.title"), base: "nbook", light: {}, dark: {}} satisfies ThemeDeclaration},
    {capability: WORKBENCH_THEMES_POINT, id: "macos", declaration: {title: workbenchText("themes.macos.title"), base: "macos", light: {}, dark: {}} satisfies ThemeDeclaration},
];
