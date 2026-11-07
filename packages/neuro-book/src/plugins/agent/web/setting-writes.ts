/**
 * 一个设置项的写入队列。配置服务写成功才更新快照，同一拍里写两次读到的是同一份旧值，后写的会盖掉先写的：所以排成一个队，每次写都带上
 * 读到的值比较（`expect`），调用方再按这次改动的性质选冲突怎么办。
 */

import type {SettingDefinition, SettingsService, SettingWriteResult} from "nbook/shared/settings";

export interface SettingWriter<T> {
    /** 写的那一刻对当时的值求改动。别处抢先写了（另一个窗口、设置文件）就按新值再求一次，只重试一次。 */
    edit(change: (current: T) => T): Promise<SettingWriteResult>;
    /** 照着旧值改好的整份。别处抢先写了就得 `conflict`、不写：写下去会盖掉别处的改动。 */
    replace(value: T): Promise<SettingWriteResult>;
}

export function createSettingWriter<T>(settings: SettingsService, setting: SettingDefinition<T>): SettingWriter<T> {
    let queue: Promise<unknown> = Promise.resolve();
    const enqueue = (write: () => Promise<SettingWriteResult>): Promise<SettingWriteResult> => {
        const result = queue.then(write);
        queue = result.catch(() => undefined);
        return result;
    };
    const writeOnce = (change: (current: T) => T): Promise<SettingWriteResult> => {
        const {value, user} = settings.inspect(setting);
        return settings.update(setting, change(value as T) as never, {expect: {value: user.status === "ok" ? user.value : undefined}});
    };
    return {
        edit: (change) => enqueue(async () => {
            const first = await writeOnce(change);
            return first.ok || first.code !== "conflict" ? first : writeOnce(change);
        }),
        replace: (value) => enqueue(() => writeOnce(() => value)),
    };
}
