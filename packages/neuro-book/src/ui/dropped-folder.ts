/**
 * 从系统拖入、或用“选择文件夹”选出的文件夹：读出里面的文件，交给调用方上传。浏览器与桌面（WebView2）同一份：两端的网页都拿不到
 * 本机路径，只能读内容。插件页（w00046 t16）与之后的文件树、编辑器、书架拖入（t15）共用，所以限额与路径规则由调用方给。
 *
 * 要点：
 * - `readDrop` 必须在 `drop` 事件的同步段里调用：`DataTransferItem.webkitGetAsEntry()` 在事件处理函数返回之后就取不到了。
 *   它只分类，不解释：交回每个条目是文件夹、文件还是别的，让调用方定“拖入的不是文件夹”怎么提示。
 * - 目录用 `FileSystemDirectoryReader.readEntries` 读，一次只给一批（Chromium 约 100 个），要读到返回空数组才算读完。
 * - 目录符号链接或挂载造成的环：遍历深度至多 `MAX_DEPTH`。
 * - 数目与大小在收集时累计，过限立即停，不读完整个文件夹。
 */

import type {CollectedFolder, CollectOptions, CollectProblem, CollectResult, CollectedFile} from "nbook/shared/collected-folder";

export type {CollectedFile, CollectedFolder, CollectOptions, CollectProblem, CollectResult, FolderLimits} from "nbook/shared/collected-folder";

/** 遍历深度上限：再深的当作环或不是正常的项目文件夹。 */
export const MAX_DEPTH = 64;

/** 一个拖入的条目。 */
export type DroppedItem =
    | {readonly kind: "folder"; readonly name: string; readonly entry: FileSystemDirectoryEntry}
    | {readonly kind: "file"; readonly name: string};

/** `drop` 事件里读出所有条目；只能在事件的同步段里调用。拿不到条目信息的（网页里的文字、链接）不在结果里。 */
export function readDrop(dataTransfer: DataTransfer): DroppedItem[] {
    const items: DroppedItem[] = [];
    for (const item of Array.from(dataTransfer.items)) {
        if (item.kind !== "file") continue;
        const entry = item.webkitGetAsEntry();
        if (entry === null) {
            const file = item.getAsFile();
            if (file !== null) items.push({kind: "file", name: file.name});
        } else if (entry.isDirectory) {
            items.push({kind: "folder", name: entry.name, entry: entry as FileSystemDirectoryEntry});
        } else {
            items.push({kind: "file", name: entry.name});
        }
    }
    return items;
}

/** 这个拖动里有没有文件（拖动进行中也能查）：页面内部元素的拖动、网页里的文字都没有。 */
export function dragHasFiles(dataTransfer: DataTransfer | null): boolean {
    return dataTransfer !== null && Array.from(dataTransfer.types).includes("Files");
}

const fileOf = (entry: FileSystemFileEntry): Promise<File> => new Promise((resolve, reject) => entry.file(resolve, reject));

/** `readEntries` 一次一批，读到空数组为止。 */
async function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    const all: FileSystemEntry[] = [];
    for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) return all;
        all.push(...batch);
    }
}

class Stop extends Error {
    readonly problem: CollectProblem;

    constructor(problem: CollectProblem) {
        super(problem.kind);
        this.problem = problem;
    }
}

/** 累计与检查：一个文件收进来之前过一遍。 */
function accept(state: {files: CollectedFile[]; bytes: number}, options: CollectOptions, path: string, file: File): void {
    const {limits} = options;
    const problem = options.pathProblem?.(path) ?? null;
    if (problem !== null) throw new Stop({kind: "path-invalid", path, detail: problem});
    if (file.size > limits.maxFileBytes) throw new Stop({kind: "file-too-large", path});
    if (state.files.length + 1 > limits.maxFiles) throw new Stop({kind: "too-many-files"});
    state.bytes += options.cost?.(path, file.size) ?? file.size;
    if (state.bytes > limits.maxTotalBytes) throw new Stop({kind: "too-large"});
    state.files.push({path, file});
}

/** 遍历一个拖入的目录。 */
export async function collectFolder(entry: FileSystemDirectoryEntry, options: CollectOptions): Promise<CollectResult> {
    const state = {files: [] as CollectedFile[], bytes: 0};
    const walk = async (directory: FileSystemDirectoryEntry, prefix: string, depth: number): Promise<void> => {
        if (depth > MAX_DEPTH) throw new Stop({kind: "too-deep"});
        let children: FileSystemEntry[];
        try {
            children = await readAll(directory.createReader());
        } catch {
            throw new Stop({kind: "read-failed", path: prefix === "" ? entry.name : prefix.slice(0, -1)});
        }
        for (const child of children) {
            if (options.skip?.(child.name, child.isDirectory) === true) continue;
            const path = `${prefix}${child.name}`;
            if (child.isDirectory) {
                await walk(child as FileSystemDirectoryEntry, `${path}/`, depth + 1);
                continue;
            }
            let file: File;
            try {
                file = await fileOf(child as FileSystemFileEntry);
            } catch {
                throw new Stop({kind: "read-failed", path});
            }
            accept(state, options, path, file);
        }
    };
    try {
        await walk(entry, "", 0);
    } catch (error) {
        if (error instanceof Stop) return {ok: false, problem: error.problem};
        throw error;
    }
    return {ok: true, folder: {name: entry.name, files: sortByPath(state.files), bytes: state.bytes}};
}

/**
 * `<input type="file" webkitdirectory>` 给的文件列表：每个文件的 `webkitRelativePath` 是“文件夹名/相对路径”。与拖入走同一套限额与
 * 路径检查。注意浏览器在给出列表之前已经枚举了整棵树（含 `node_modules`），这里只是不收它们。
 */
export function collectInputFiles(files: ReadonlyArray<File>, options: CollectOptions): CollectResult {
    const state = {files: [] as CollectedFile[], bytes: 0};
    let name = "";
    try {
        for (const file of files) {
            // 不是选文件夹得到的文件，浏览器给空串（个别环境没有这个属性）。
            const [root, ...rest] = (file.webkitRelativePath || "").split("/");
            if (root === undefined || rest.length === 0) throw new Stop({kind: "read-failed", path: file.name});
            name = root;
            const segments = rest;
            const skipped = segments.some((segment, index) => options.skip?.(segment, index < segments.length - 1) === true);
            if (skipped) continue;
            accept(state, options, segments.join("/"), file);
        }
    } catch (error) {
        if (error instanceof Stop) return {ok: false, problem: error.problem};
        throw error;
    }
    return {ok: true, folder: {name, files: sortByPath(state.files), bytes: state.bytes}};
}

const sortByPath = (files: CollectedFile[]): CollectedFile[] => [...files].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
