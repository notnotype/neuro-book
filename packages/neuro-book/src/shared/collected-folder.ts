/**
 * 收集出来的文件夹的形状与限额（读文件夹的实现在 `nbook/ui/dropped-folder`，用 DOM 的 `FileSystem*` 类型）。放在共享层是因为插件页的浏览器入口
 * 模块也被后端的类型检查编译（它没有 DOM 库）：入口只用这些形状，不碰读文件夹的实现。
 */

export interface FolderLimits {
    readonly maxFiles: number;
    readonly maxTotalBytes: number;
    readonly maxFileBytes: number;
}

export interface CollectedFile {
    /** 相对文件夹根的路径，用 `/` 分段，不含文件夹自己的名字。 */
    readonly path: string;
    readonly file: File;
}

export interface CollectedFolder {
    readonly name: string;
    readonly files: ReadonlyArray<CollectedFile>;
    /** 按 `cost` 累计出的总量（缺省是内容字节数）。 */
    readonly bytes: number;
}

export type CollectProblem =
    | {readonly kind: "too-many-files"}
    | {readonly kind: "file-too-large"; readonly path: string}
    | {readonly kind: "too-large"}
    | {readonly kind: "path-invalid"; readonly path: string; readonly detail: string}
    | {readonly kind: "too-deep"}
    | {readonly kind: "read-failed"; readonly path: string};

export type CollectResult = {readonly ok: true; readonly folder: CollectedFolder} | {readonly ok: false; readonly problem: CollectProblem};

export interface CollectOptions {
    readonly limits: FolderLimits;
    /** 这个目录或文件不要（例如任何深度的 `node_modules`、`.git`）；对目录返回 true 就整个目录不进。 */
    readonly skip?: (name: string, isDirectory: boolean) => boolean;
    /** 路径不合规时交回原因；没有就不查。 */
    readonly pathProblem?: (path: string) => string | null;
    /** 一个文件计入总量的字节数；缺省是内容字节数（上传时要加上分帧头）。 */
    readonly cost?: (path: string, size: number) => number;
}
