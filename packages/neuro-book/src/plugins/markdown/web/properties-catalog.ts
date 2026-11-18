/**
 * 属性的图标、显示名与类型（docs/specs/workbench/markdown-editing.md 输出 59–61）：按属性名查贡献点 `markdown.properties` 的声明，
 * 交给属性面板的 `describe`。每次调用现查声明（运行时按存活登记推导、不缓存），所以插件装卸之后面板下一次重查时生效；`label`
 * 在查的时候经窗口的翻译端口解析，面板在计算里调用，界面语言变了跟着变。
 *
 * 几个声明给同一个名字：贡献 id 码元顺序最小的整条生效（`list` 已按这个顺序给出），其余忽略，每个被忽略的声明记一条诊断，同一对
 * 只记一次。诊断在第一次查到这个名字时记（有文件用到它才有意义），不在插件装载时按目录整体检测；`reported` 随窗口的寿命，
 * 插件卸载又装回同一对不再记第二次。这个模块在插件入口里运行，不引组件与编辑内核。
 */

import type {ContributionDeclarations} from "@notnotype/nb-runtime/plugins";
import type {InjectionKey} from "vue";

import type {DisplayText} from "nbook/shared/localized-text";

import {MARKDOWN_PROPERTIES_POINT} from "../shared/properties";
import type {PropertyDeclaration, PropertyKind} from "../shared/properties";

/**
 * 给属性面板的显示信息（形状同 nb-markdown 的 `PropertyDescription`，传给 `MarkdownProperties` 时类型核对）。不从 nb-markdown 的
 * 编辑入口引类型：这个模块在插件入口里，后端的类型检查展开不了它（DOM 类型）。
 */
export type PropertyDescription = {
    readonly icon?: string;
    readonly label?: string;
    readonly kind?: PropertyKind;
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
        // 空的显示名（空串、空的语言表、只有空白）等于没给：面板会拿它当名字，名字一列与输入的可访问名称就成了空的。
        const shown = label === undefined ? "" : sources.text(label);
        return {...(icon === undefined ? {} : {icon}), ...(shown.trim() === "" ? {} : {label: shown}), ...(kind === undefined ? {} : {kind})};
    };
}
