/**
 * server 进程内的 profile release 内存权威。它不读盘、不 import，
 * 只保存 Publisher/refresh 已经构建好的 catalog 视图并递增 epoch。
 */
export class ProfileRegistry<TCatalog> {
    private currentCatalog?: TCatalog;
    private currentEpoch = 0;

    get catalog(): TCatalog | undefined {
        return this.currentCatalog;
    }

    get epoch(): number {
        return this.currentEpoch;
    }

    /**
     * 原子翻转当前内存视图。
     */
    publish(catalog: TCatalog): void {
        this.currentCatalog = catalog;
        this.currentEpoch += 1;
    }
}
