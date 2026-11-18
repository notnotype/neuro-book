/**
 * 表情包页加图的队列（docs/specs/agent/stickers.md 输出 29）：一次选或拖进来的几张图排成队，同时至多 `limit` 张在传；一次添加的
 * 全部做完后交回逐张的结果，页面据此发一条汇总通知。队列属于页面的运行期，不属于哪个包：切到别的包、改名、删除，已经开始的照常传，
 * 服务端对不存在的包得 `pack-missing`，算进结果。拖进来的文件夹（没有类型、大小为 0）跳过，结果里写出。
 */

/** 传一张图的结果：成功交回服务端实际用的文件名与是否缩小过；失败交回码，`reason` 是图片被拒的稳定原因码。 */
export type UploadResponse = {readonly ok: true; readonly file: string; readonly resized: boolean} | {readonly ok: false; readonly code: string; readonly reason?: string};

export type UploadOutcome = {readonly name: string} & UploadResponse;

export interface UploadItem {
    readonly id: number;
    readonly packId: string;
    readonly name: string;
    readonly state: "waiting" | "running";
}

export interface UploadQueueOptions {
    readonly limit: number;
    readonly send: (packId: string, file: File) => Promise<UploadResponse>;
    /** 队列里的项变了（加入、开始、完成）。 */
    readonly onChange: (items: readonly UploadItem[]) => void;
}

interface Task {
    readonly item: {id: number; packId: string; name: string; state: "waiting" | "running"};
    readonly file: File;
    readonly done: (outcome: UploadOutcome) => void;
}

export class UploadQueue {
    readonly #options: UploadQueueOptions;
    readonly #tasks: Task[] = [];
    #running = 0;
    #counter = 0;

    constructor(options: UploadQueueOptions) {
        this.#options = options;
    }

    /** 加进队列；全部做完后 resolve，顺序与 `files` 一致。 */
    add(packId: string, files: readonly File[]): Promise<readonly UploadOutcome[]> {
        const outcomes = files.map((file) => new Promise<UploadOutcome>((resolve) => {
            if (file.size === 0 && file.type === "") {
                resolve({name: file.name, ok: false, code: "image-rejected", reason: "folder"});
                return;
            }
            this.#counter += 1;
            this.#tasks.push({item: {id: this.#counter, packId, name: file.name, state: "waiting"}, file, done: resolve});
        }));
        this.#changed();
        this.#pump();
        return Promise.all(outcomes);
    }

    #changed(): void {
        this.#options.onChange(this.#tasks.map((task) => ({...task.item})));
    }

    #pump(): void {
        for (const task of this.#tasks) {
            if (this.#running >= this.#options.limit) break;
            if (task.item.state !== "waiting") continue;
            task.item.state = "running";
            this.#running += 1;
            void this.#options.send(task.item.packId, task.file).catch((): UploadResponse => ({ok: false, code: "unavailable"})).then((response) => {
                this.#tasks.splice(this.#tasks.indexOf(task), 1);
                this.#running -= 1;
                task.done({name: task.item.name, ...response});
                this.#changed();
                this.#pump();
            });
        }
        this.#changed();
    }
}
