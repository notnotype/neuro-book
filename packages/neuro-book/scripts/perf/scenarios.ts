/**
 * Files 性能验收的场景表（w00017 t72）：编号、名称与执行顺序。外壳按它校验 `--only`，浏览器部分按它补齐没有执行的
 * 场景（not-run），报告按它排序。每个场景自己建立前置（展开哪些目录、打开哪些文件），`--only` 单跑任何一个都成立。
 */

export interface Scenario {
    readonly id: string;
    readonly name: string;
}

export const SCENARIOS: ReadonlyArray<Scenario> = [
    {id: "A1+A2", name: "打开项目：服务刚启动 / 宽限期内再打开"},
    {id: "A3", name: "打开项目：子进程退出后重开"},
    {id: "A4", name: "打开项目：恢复多个已展开目录"},
    {id: "B1", name: "未打开过的章节：选中与标签 / 正文（富文本）"},
    {id: "B2", name: "未打开过的源码文件：选中与标签 / 正文（源码）"},
    {id: "C1-md", name: "已打开过：来回点标签（富文本，单组）"},
    {id: "C2-md", name: "已打开过：从资源树再点（富文本）"},
    {id: "C1-code", name: "已打开过：来回点标签（源码，单组）"},
    {id: "C2-code", name: "已打开过：从资源树再点（源码）"},
    {id: "C1-md-split", name: "已打开过：来回点标签（富文本，双组）"},
    {id: "C1-code-split", name: "已打开过：来回点标签（源码，双组）"},
    {id: "F1", name: "资源保留：打开再关闭 20 个文件 × 5 轮"},
    {id: "D1-cold", name: "展开宽目录：新页面里第一次展开（列出）"},
    {id: "D1-warm", name: "展开宽目录：收起再展开（已列出过）"},
    {id: "D2-cold", name: "展开内容目录 lorebook.content/characters：新页面里第一次展开（列出）"},
    {id: "D2-warm", name: "展开内容目录 lorebook.content/characters：收起再展开（已列出过）"},
    {id: "D3", name: "滚动展开后的文件树（滚轮从顶到底）"},
    {id: "E1", name: "外部改写 500 个文件时连续键入"},
];

/** 外部改写场景（E1）的工作量：已展开卷里的章节与宽目录里的文件各这么多。 */
export const E1_CHAPTERS = 250;
export const E1_WIDE = 250;
/** 资源保留场景（F1）每轮打开再关闭的文件数。 */
export const F1_FILES = 20;
/** 展开场景（D1、D2）每格的次数。 */
export const EXPAND_SAMPLES = 10;
