/**
 * 一套主题在一个明暗下要写的东西（docs/specs/theme/skins.md）。单独一个文件：工作台的入口静态引它，不能因此把 nb-ui 的主题包打进首屏。
 */

export interface ProductTheme {
    /** nb-ui 主题包。 */
    readonly base: string;
    /** 主题目录里的 id：不同的主题可以用同一个主题包，只有它能分出“换了一套主题”与“同一套主题改了配色”；没有时按主题包算。 */
    readonly skin?: string;
    /** 盖在主题包缺省配色上的变量。 */
    readonly vars: Readonly<Record<string, string>>;
    readonly scene: boolean;
}
