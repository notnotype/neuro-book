/** `EntryTree` 的输入形状（同名 `.md` 的“数据”）；放在 `.ts` 里，视图宿主与测试不用从 `.vue` 取类型。 */

export interface EntryTreeItem {
    readonly id: string;
    /** 缺省位置上的名字。 */
    readonly name: string;
    /** 分组；空字符串是没有分组。只在根这一层用。 */
    readonly folder: string;
    readonly hasChildren: boolean;
    /** 缺省位置上是否已出场。 */
    readonly appeared: boolean;
    readonly deleted: boolean;
}

export interface EntryTreeLayer {
    /** 到目前读到的各页，按顺序。 */
    readonly items: readonly EntryTreeItem[];
    /** 这一层在已读的之后还会列出几项。 */
    readonly remaining: number;
    /** 还没读到过。 */
    readonly loading: boolean;
}
