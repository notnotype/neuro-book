/**
 * 场景提供者下拉的选项（docs/specs/theme/editor.md 输出 20）：“无”加当前已发布的提供者。声明里已有的提供者没发布时，仍留一项
 * 不可选的“未发布”：`Select` 的受控值要在选项里，丢了它下拉就显示不出当前值。
 */

/** “无”用一个不会是贡献 id 的值（贡献 id 都带点）。 */
export const NO_PROVIDER = "none";

export interface ProviderOption {
    readonly value: string;
    readonly label: string;
    readonly description?: string;
    readonly disabled?: boolean;
}

export function providerOptions(published: ReadonlyArray<string>, current: string | undefined, labels: {readonly none: string; readonly unpublished: string}): ProviderOption[] {
    const options: ProviderOption[] = [{value: NO_PROVIDER, label: labels.none}, ...published.map((id) => ({value: id, label: id}))];
    if (current !== undefined && !published.includes(current)) options.push({value: current, label: current, description: labels.unpublished, disabled: true});
    return options;
}
