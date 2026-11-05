/**
 * 按只读视图对象缓存剧情的索引（知情、伏笔）。世界服务在世界与读取输入都没变时交出同一个视图对象（快照与诊断的计算共用），
 * 所以同一份输入上的几次读取（一次读待处理里的几个诊断、接连几次按视角的读取）共用一份索引；输入一变就是新的视图对象，
 * 旧的连同它的索引随垃圾回收释放。不按读取输入的摘要缓存：摘要里只有世界的版本，不认是哪一份世界（同一进程里两份世界版本
 * 相同时会串用）。
 *
 * 一个视图对象可能活过很多次读取，每次读取的位置可以不同：每种索引在一个视图上最多留 `PER_VIEW` 份，先建的先丢。
 */

import type {CanonReadView} from "@notnotype/nb-canon/schema";

const PER_VIEW = 16;

export function perViewCache<T>(): (view: CanonReadView, key: string, build: () => T) => T {
    const caches = new WeakMap<CanonReadView, Map<string, T>>();
    return (view, key, build) => {
        let byView = caches.get(view);
        if (byView === undefined) {
            byView = new Map();
            caches.set(view, byView);
        }
        const cached = byView.get(key);
        if (cached !== undefined) return cached;
        const built = build();
        byView.set(key, built);
        if (byView.size > PER_VIEW) byView.delete(byView.keys().next().value!);
        return built;
    };
}
