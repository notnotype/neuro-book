/**
 * 场景提供者下拉的选项（docs/specs/theme/editor.md 输出 20）：“无”加当前已发布的提供者。声明里已有的提供者没发布时，仍留一项
 * 不可选的“未发布”：`Select` 的受控值要在选项里，丢了它下拉就显示不出当前值。
 */

import type {PublishedProvider} from "../../scene-providers";

/** “无”用一个不会是贡献 id 的值（贡献 id 都带点）。 */
export const NO_PROVIDER = "none";

export interface ProviderOption {
    readonly value: string;
    readonly label: string;
    readonly description?: string;
    readonly disabled?: boolean;
}

/**
 * 有显示名的提供者：标题作 label，贡献 id 放在 `description`（`Select` 里是同一行右侧的次要文字，放不下先截它）；没有显示名就只显示 id。
 * `resolve` 把声明里的文字（字符串或语言映射）按当前语言解出来。
 */
export function providerOptions(published: ReadonlyArray<PublishedProvider>, current: string | undefined, labels: {readonly none: string; readonly unpublished: string}, resolve: (title: NonNullable<PublishedProvider["title"]>) => string): ProviderOption[] {
    const options: ProviderOption[] = [{value: NO_PROVIDER, label: labels.none}, ...published.map(({id, title}): ProviderOption => (title === undefined ? {value: id, label: id} : {value: id, label: resolve(title), description: id}))];
    if (current !== undefined && !published.some(({id}) => id === current)) options.push({value: current, label: current, description: labels.unpublished, disabled: true});
    return options;
}
