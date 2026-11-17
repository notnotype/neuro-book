/**
 * 属性的图标、显示名与类型的贡献（docs/specs/workbench/markdown-editing.md 输出 59–61）：贡献点 `markdown.properties` 的声明形状。
 * 只有声明，写在贡献方插件描述的顶层 `contributions` 里，浏览器与项目两个位置都登记（顶层声明在每个位置都要有拥有者，同
 * `markdown.dialects`），项目位置不使用它。声明是纯 JSON Schema 能校验的形状，第三方插件也能经清单贡献。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import type {ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";

import {TextSchema} from "nbook/shared/text";

export const MARKDOWN_PROPERTIES_POINT = "markdown.properties";

export const PropertyDeclarationSchema = Type.Object({
    /** 属性名：精确、区分大小写地等于 frontmatter 里键的文字；非空、不含控制字符。 */
    name: Type.String({pattern: "^[^\\u0000-\\u001f\\u007f]+$"}),
    /** Iconify 类名（`i-lucide-user`）；要在构建里有对应的样式，同菜单贡献的 `icon`。 */
    icon: Type.Optional(Type.String({pattern: "^i-[a-z0-9]+(?:-[a-z0-9]+)+$"})),
    label: Type.Optional(TextSchema),
    kind: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("number"), Type.Literal("checkbox"), Type.Literal("date"), Type.Literal("list")])),
// `name` 之外至少给一项；别的字段不收，以后只追加。
}, {additionalProperties: false, minProperties: 2});

export type PropertyDeclaration = Static<typeof PropertyDeclarationSchema>;

/** 声明里能给的类型：面板已有的五种可编辑类型，不含表示不了的“{ }”。 */
export type PropertyKind = NonNullable<PropertyDeclaration["kind"]>;

export const propertiesPoint: ContributionPointDefinition<PropertyDeclaration> = {id: MARKDOWN_PROPERTIES_POINT, implementation: "none", idPrefix: "plugin", schema: PropertyDeclarationSchema};
