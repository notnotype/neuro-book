/** 配置存储（Spec 输出 3–6）：一份当前快照，替换成功才换、才通知；替换是同步的。 */

import type {ConfigResult, ConfigStore, HarnessConfig} from "./types";
import {validateHarnessConfig} from "./validate";

export function createConfigStore(initial: unknown): ConfigResult<ConfigStore> {
    const first = validateHarnessConfig(initial);
    if (!first.ok) return first;
    let current = first.value;
    const listeners = new Set<(snapshot: HarnessConfig) => void>();
    const store: ConfigStore = {
        get current() {
            return current;
        },
        replace(next) {
            const result = validateHarnessConfig(next);
            if (!result.ok) return result;
            current = result.value;
            for (const listener of [...listeners]) {
                try {
                    listener(current);
                } catch {
                    // 监听函数自己的问题：不影响替换的结果，也不挡住其它监听函数。
                }
            }
            return result;
        },
        subscribe(listener) {
            listeners.add(listener);
            return {release: () => listeners.delete(listener)};
        },
    };
    return {ok: true, value: store};
}
