/**
 * 属性的图标、显示名与类型（docs/specs/workbench/markdown-editing.md 输出 59–61）：按属性名查贡献点 `markdown.properties` 的声明，
 * 交给属性面板的 `describe`。声明每次现查（运行时按存活登记推导、不缓存），所以插件装卸之后下一次渲染生效；`label` 在查的时候
 * 经窗口的翻译端口解析，面板在渲染里调用，界面语言变了跟着变。
 *
 * 几个声明给同一个名字：贡献 id 码元顺序最小的整条生效（`list` 已按这个顺序给出），其余忽略，每个被忽略的声明记一条诊断，同一对
 * 只记一次。这个模块在插件入口里运行，不引组件与编辑内核。
 */

import type {ContributionDeclarations} from "@notnotype/nb-runtime/plugins";
import type {InjectionKey} from "vue";

import type {DisplayText} from "nbook/shared/localized-text";

import {MARKDOWN_PROPERTIES_POINT} from "../shared/properties";
import type {PropertyDeclaration} from "../shared/properties";

/**
 * 给属性面板的显示信息（形状同 nb-markdown 的 `PropertyDescription`，传给 `MarkdownProperties` 时类型核对）。不从 nb-markdown 的
 * 编辑入口引类型：这个模块在插件入口里，后端的类型检查展开不了它（DOM 类型）。
 */
export type PropertyDescription = {
    readonly icon?: string;
    readonly label?: string;
    readonly kind?: NonNullable<PropertyDeclaration["kind"]>;
};

/** 属性面板的 `describe`：由插件入口建好、经注入交给 Markdown 控件；没有注入（Lab、组件测试）时面板不用它。 */
export type DescribeProperty = (name: string) => PropertyDescription | null;

export const markdownPropertiesDescribeKey: InjectionKey<DescribeProperty> = Symbol("nbook.markdown/properties-describe");

export interface PropertyDescriptionSources {
    readonly declarations: ContributionDeclarations;
    /** 窗口的翻译端口：把声明里的文字换成当前语言的字符串。 */
    readonly text: (text: DisplayText) => string;
    /** 同名冲突：`kept` 生效，`ignored` 被忽略。 */
    readonly conflict: (name: string, kept: string, ignored: string) => void;
}

export function createPropertyDescriptions(sources: PropertyDescriptionSources): DescribeProperty {
    const reported = new Set<string>();
    return (name) => {
        const matching = sources.declarations.list<PropertyDeclaration>(MARKDOWN_PROPERTIES_POINT).filter((descriptor) => descriptor.declaration.name === name);
        const [first, ...ignored] = matching;
        if (first === undefined) return null;
        for (const other of ignored) {
            const pair = `${first.id}\n${other.id}`;
            if (reported.has(pair)) continue;
            reported.add(pair);
            sources.conflict(name, first.id, other.id);
        }
        const {icon, label, kind} = first.declaration;
        return {...(icon === undefined ? {} : {icon}), ...(label === undefined ? {} : {label: sources.text(label)}), ...(kind === undefined ? {} : {kind})};
    };
}
