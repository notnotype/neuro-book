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
import {WORKBENCH_THEME_SCENES_POINT, WORKBENCH_THEMES_POINT} from "./theme-points";

import {EYE_GREEN_LOOKS, EYE_SEPIA_LOOKS} from "./eye-care-themes";

export {MAX_SCENE_BYTES, WORKBENCH_THEME_SCENES_POINT, WORKBENCH_THEMES_POINT} from "./theme-points";
export type {SceneProviderImplementation, SceneRequest, SceneResult} from "./theme-points";
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
    /** Agent 工作中（有会话在运行或等用户处理）时用的场景图（docs/specs/theme/skins.md 输出 17）；没写或解析不出时仍用 `scene`。 */
    workingScene: Type.Optional(Type.String({minLength: 1})),
    /** 图标集（docs/specs/theme/skins.md 输出 16）：图标名（`i-lucide-<名>` 的 <名>）到插件目录内 .svg 的相对路径，按名覆盖，没写的保持原图标。 */
    icons: Type.Optional(StringMap),
    /** 浮层的画框：描边里面再画一道细线（docs/specs/theme/skins.md 输出 13）。 */
    frame: Type.Optional(Type.Object({line: Type.String({minLength: 1})}, {additionalProperties: false})),
}, {additionalProperties: false});

export const ThemeDeclarationSchema = Type.Object({
    title: TextSchema,
    base: Type.Union([Type.Literal("nbook"), Type.Literal("macos")]),
    fonts: Type.Optional(Type.Object({display: Type.Optional(Type.String()), prose: Type.Optional(Type.String())}, {additionalProperties: false})),
    crop: Type.Optional(Type.Object({
        empty: Type.Optional(Type.Object({position: Type.Optional(Type.String()), contentX: Type.Optional(Type.Number({minimum: 0.25, maximum: 0.5}))}, {additionalProperties: false})),
        marginLeft: Type.Optional(CropSchema),
        marginRight: Type.Optional(CropSchema),
        sidebarCorner: Type.Optional(CropSchema),
        auxiliaryCorner: Type.Optional(CropSchema),
    }, {additionalProperties: false})),
    /** 场景图由哪个提供者画（`workbench.theme-scenes` 的贡献 id）；提供者没发布或失败时用 `Look.scene` 作后备。 */
    sceneProvider: Type.Optional(Type.String({minLength: 1})),
    light: LookSchema,
    dark: LookSchema,
}, {additionalProperties: false});

export type ThemeDeclaration = Static<typeof ThemeDeclarationSchema>;
export type ThemeLook = Static<typeof LookSchema>;

const COLOR_VARS: ReadonlySet<string> = new Set(nbColorwayVarKeys);
const ROLE_VARS: ReadonlySet<string> = new Set(THEME_ROLE_VARS);
/**
 * 能引外部资源的写法：素材只能经 `scene` 取插件自己的文件。反斜杠一律不收：CSS 先解转义再认函数名，`u\\72l(` 就是 `url(`；取值都是颜色、
 * 渐变、字体栈与尺寸，用不到它。
 */
const LOADS_RESOURCE = /\\|(?:url|src|image|image-set|cross-fade|element|paint)\s*\(|@import/iu;

function stringsIn(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (typeof value === "object" && value !== null) return Object.values(value).flatMap(stringsIn);
    return [];
}

/** 图标名只收小写字母、数字与连字符（lucide 的写法）：它会拼进样式表的选择器。 */
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const MAX_ICONS = 64;
const SCENE_PROVIDER_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

/** 只能是插件目录内的相对路径：不能带方案、不能从根开始、不能往上走。 */
function pathProblem(label: string, path: string): string | null {
    if (/^[a-z][a-z0-9+.-]*:/iu.test(path) || /^[/\\]/u.test(path) || path.split(/[/\\]/u).includes("..")) return `${label} 要是插件目录内的相对路径：${path}`;
    return null;
}

function lookProblem(name: string, look: ThemeLook): string | null {
    for (const key of Object.keys(look.colors ?? {})) if (!COLOR_VARS.has(key)) return `${name}.colors 不收 ${key}：不是配色变量`;
    for (const key of Object.keys(look.vars ?? {})) if (!ROLE_VARS.has(key)) return `${name}.vars 不收 ${key}：不在主题角色变量里`;
    for (const [field, path] of [["scene", look.scene], ["workingScene", look.workingScene]] as const) {
        if (path === undefined) continue;
        const problem = pathProblem(`${name}.${field}`, path);
        if (problem !== null) return problem;
    }
    const icons = Object.entries(look.icons ?? {});
    if (icons.length > MAX_ICONS) return `${name}.icons 最多 ${String(MAX_ICONS)} 个：写了 ${String(icons.length)} 个`;
    for (const [icon, path] of icons) {
        if (!ICON_NAME.test(icon)) return `${name}.icons 的图标名只收小写字母、数字与连字符：${icon}`;
        if (!path.toLowerCase().endsWith(".svg")) return `${name}.icons.${icon} 只收 .svg：${path}`;
        const problem = pathProblem(`${name}.icons.${icon}`, path);
        if (problem !== null) return problem;
    }
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
    return declarationProblem(id, declaration);
}

/** 声明内容的规则，插件主题与“我的主题”（`user-themes.ts`）共用：取值不能引外部资源，`vars`、`colors` 在白名单里，`scene` 是相对路径。 */
export function declarationProblem(id: string, declaration: ThemeDeclaration): string | null {
    const {title: _title, ...rest} = declaration;
    const {scene: _light, workingScene: _lightWorking, icons: _lightIcons, ...light} = declaration.light;
    const {scene: _dark, workingScene: _darkWorking, icons: _darkIcons, ...dark} = declaration.dark;
    if (stringsIn({...rest, light, dark}).some((value) => LOADS_RESOURCE.test(value))) return `主题 ${id} 的取值不能引外部资源（url()）`;
    if (declaration.sceneProvider !== undefined && !SCENE_PROVIDER_ID.test(declaration.sceneProvider)) return `主题 ${id} 的 sceneProvider 要是点分的小写贡献 id：${declaration.sceneProvider}`;
    return lookProblem("light", declaration.light) ?? lookProblem("dark", declaration.dark);
}

export const themesPoint: ContributionPointDefinition<ThemeDeclaration> = {
    id: WORKBENCH_THEMES_POINT,
    implementation: "none",
    schema: ThemeDeclarationSchema,
    validate: themeProblem,
};

/** 工作台自己的主题：前两套只选主题包，别的都取主题包的；护眼的两套只多了配色。 */
export const BUILTIN_THEME_CONTRIBUTIONS = [
    {capability: WORKBENCH_THEMES_POINT, id: "nbook", declaration: {title: workbenchText("themes.nbook.title"), base: "nbook", light: {}, dark: {}} satisfies ThemeDeclaration},
    {capability: WORKBENCH_THEMES_POINT, id: "macos", declaration: {title: workbenchText("themes.macos.title"), base: "macos", light: {}, dark: {}} satisfies ThemeDeclaration},
    {capability: WORKBENCH_THEMES_POINT, id: "eye-green", declaration: {title: workbenchText("themes.eyeGreen.title"), base: "nbook", ...EYE_GREEN_LOOKS} satisfies ThemeDeclaration},
    {capability: WORKBENCH_THEMES_POINT, id: "eye-sepia", declaration: {title: workbenchText("themes.eyeSepia.title"), base: "nbook", ...EYE_SEPIA_LOOKS} satisfies ThemeDeclaration},
];

/** 提供者的声明没有字段：它只是个有实现的名字，主题经 id 引用。 */
export const SceneProviderDeclarationSchema = Type.Object({}, {additionalProperties: false});
export type SceneProviderDeclaration = Static<typeof SceneProviderDeclarationSchema>;

/** `workbench.theme-scenes` 贡献点：实现只在浏览器入口交付，提供者所在入口要在启动时激活，工作台不替它激活。 */
export const themeScenesPoint: ContributionPointDefinition<SceneProviderDeclaration> = {
    id: WORKBENCH_THEME_SCENES_POINT,
    implementation: "required",
    idPrefix: "plugin",
    schema: SceneProviderDeclarationSchema,
    validate: (descriptor) => (descriptor.location === "browser" ? null : `${WORKBENCH_THEME_SCENES_POINT} 只接受浏览器入口的贡献`),
};
