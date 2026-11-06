/**
 * 主题素材目录（`user://theme-assets/`）的两组路由共用的部分：上传（`theme-asset-route.ts`）与清理（`theme-asset-sweep.ts`）。
 * 放在这里是为了两个路由文件不互相导入。协调规则：
 *
 * - **互斥**：同一时刻只有一个在列出、判断、删除或定名写入。只管这两条路由：经文件管理器等通用入口改这个目录的写入不参与
 *   （那是用户明确的另一种操作；主题素材不在内容树里，通用删除也不取内容树的操作锁）。一个状态根只有一个服务进程
 *   （`server/instance.ts` 的 `server.claim.lock`），进程内的锁对这两条路由足够。
 * - **最近返回**：上传路由每次交出一个素材地址（新写入或命中已有的同字节文件）都记一笔。清理把“最近被交出过”的素材当作刚被引用，不删。
 *   不能改文件的修改时间来表达这件事：Bun 的目录监视会把 `utimes` 当成 `change` 报给订阅方，成为一条外部来源的变更，路由也不该绕开 Files 的
 *   提交链自己动磁盘。代价：进程重启后这张表丢失，保护退回文件修改时间。
 */

import type {BatchResult} from "../shared/contracts";
import type {ServerFilesResult} from "../shared/workspace-files";

export const THEME_ASSET_DIRECTORY = "theme-assets";

export interface ThemeAssetRouteSources {
    /** `user://` 根的真实路径。 */
    readonly userRoot: string;
    readonly write: (address: string, bytes: Uint8Array) => Promise<ServerFilesResult<unknown>>;
    /** 清理用：经 Files 的删除（`expected` 是目录项身份令牌）。 */
    readonly delete: (items: ReadonlyArray<{readonly address: string; readonly expected?: string}>) => Promise<ServerFilesResult<BatchResult>>;
    /** 时钟；测试注入，缺省 `Date.now`。 */
    readonly now?: () => number;
}

export const failure = (status: 400 | 409 | 413 | 415 | 500, code: string, detail: string): Response => Response.json({code, detail}, {status});

/** 清理不碰最近 30 分钟内写入或被上传路由交出过的素材：单张上传到写进主题记录只隔几秒，导入大包（至多 300 个文件）要几分钟。 */
export const SWEEP_PROTECTION_MS = 30 * 60 * 1000;

export class ThemeAssetGuard {
    #tail: Promise<unknown> = Promise.resolve();
    readonly #returned = new Map<string, number>();
    readonly #now: () => number;

    constructor(now: () => number = Date.now) {
        this.#now = now;
    }

    now(): number {
        return this.#now();
    }

    /** 排队执行：前一个无论成败都先结束。任务自己的失败照常抛给调用方，不影响后面的任务。 */
    run<T>(task: () => Promise<T>): Promise<T> {
        const result = this.#tail.then(task, task);
        this.#tail = result.catch(() => undefined);
        return result;
    }

    /** 记下这个素材刚被上传路由交出去，顺手丢掉已过保护期的记录，表不会无限长。 */
    returned(name: string): void {
        const now = this.#now();
        for (const [known, at] of this.#returned) if (at <= now - SWEEP_PROTECTION_MS) this.#returned.delete(known);
        this.#returned.set(name, now);
    }

    /** 这个素材最近一次被交出的时刻；没有记录为 0。 */
    returnedAt(name: string): number {
        return this.#returned.get(name) ?? 0;
    }
}
