/**
 * Lab 桌面壁纸的本地存放处。
 *
 * **图片不进仓库。**`/lab` 是开发页，而 Nuxt 的 `public/` 会整个打进产品包发给终端用户——
 * 为一个开发工具让每个用户多下几十兆壁纸不划算。所以图片改由使用者当场选一张，
 * 只留在这台机器的浏览器里，不进 Git、不进产物。
 *
 * 为什么是 IndexedDB 而不是 localStorage：壁纸是几 MB 的图片，localStorage 只收字符串、
 * 上限约 5MB，一张 4K jpg 转成 base64 还要再涨三分之一，根本放不下。IndexedDB 直接收 Blob。
 *
 * 这是 Lab **自己的界面偏好**，不是场景状态。场景与 fixture 仍然一律不许依赖或写入持久化，
 * 否则「同一场景重复打开结果一致」这条验收就不成立。
 */

const DB_NAME = "nb-lab";
const STORE_NAME = "prefs";
const WALLPAPER_KEY = "wallpaper";

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * 开库、跑一个请求、关库。
 *
 * 每次都重开而不是缓存一个连接：这里一共三个调用，都由用户点击触发，开销可以忽略，
 * 而长活连接会挡住别的标签页升级数据库版本。close() 会等当前事务结束再真的关。
 */
async function withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
    const db = await openDatabase();
    try {
        return await new Promise<T>((resolve, reject) => {
            const request = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
}

export async function saveLabWallpaper(file: Blob): Promise<void> {
    await withStore("readwrite", (store) => store.put(file, WALLPAPER_KEY));
}

export async function loadLabWallpaper(): Promise<Blob | null> {
    const value = await withStore<unknown>("readonly", (store) => store.get(WALLPAPER_KEY));
    return value instanceof Blob ? value : null;
}

export async function clearLabWallpaper(): Promise<void> {
    await withStore("readwrite", (store) => store.delete(WALLPAPER_KEY));
}
