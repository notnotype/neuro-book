/**
 * 一套主题在一个明暗下要写的东西（docs/specs/theme/skins.md）。单独一个文件：工作台的入口静态引它，不能因此把 nb-ui 的主题包打进首屏。
 */

export interface ProductTheme {
    /** nb-ui 主题包。 */
    readonly base: string;
    /** 盖在主题包缺省配色上的变量。 */
    readonly vars: Readonly<Record<string, string>>;
    readonly scene: boolean;
}
