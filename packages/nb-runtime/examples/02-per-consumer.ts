/**
 * 示例 2：按调用方提供服务（`providePerConsumer`）。
 *
 * `example.notes` 给每个依赖它的插件各生成一个门面：工厂收到内核填写的调用方身份（`ConsumerIdentity`），
 * 门面据此把数据按插件分开。调用方不能自报身份，所以 A 读不到 B 的笔记；这就是 `nbook.storage` 按插件划分
 * 命名空间的做法。门面随调用方入口的这一代释放：调用方停止时内核调用 `release`，之后再用门面会抛
 * `ServiceRevokedError`。
 *
 * 门面应是由函数组成的普通对象：内核交出的是包装过的代理，释放后任何访问都会抛错。
 *
 * 行为合同：docs/specs/runtime/services.md 输出第 11–12 条。
 * 运行：`bun packages/nb-runtime/examples/02-per-consumer.ts`。
 */

import {createApplication} from "@notnotype/nb-runtime/application";
import {providePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey, ServiceRevokedError} from "@notnotype/nb-runtime/services";

export interface NotesService {
    write(text: string): void;
    read(): ReadonlyArray<string>;
}

export const notesKey = defineServiceKey<NotesService>("example.notes/notes");

export function notesPlugin(released: string[]): PluginDefinition {
    return {
        id: "example.notes",
        entries: [{
            id: "main",
            location: "server",
            provides: [notesKey],
            activate: () => {
                // 数据由提供者持有、按调用方插件分开；门面只是带着身份的一层访问。
                const byPlugin = new Map<string, string[]>();
                return {
                    services: [providePerConsumer(notesKey, (consumer): NotesService => {
                        const owner = consumer.plugin ?? "host";
                        return {
                            write: (text) => void byPlugin.set(owner, [...(byPlugin.get(owner) ?? []), text]),
                            read: () => byPlugin.get(owner) ?? [],
                        };
                    }, {release: (_facade, consumer) => void released.push(consumer.plugin ?? "host")})],
                };
            },
        }],
    };
}

/** 一个使用笔记服务的插件：启动时写一条，再把读到的内容记下来。 */
export function writerPlugin(id: string, text: string, reads: Map<string, ReadonlyArray<string>>, captured: Map<string, NotesService>): PluginDefinition {
    return {
        id,
        entries: [{
            id: "main",
            location: "server",
            activationEvents: ["onStartup"],
            dependencies: [{key: notesKey}],
            activate: (context) => {
                const notes = context.services.require(notesKey);
                notes.write(text);
                reads.set(id, notes.read());
                captured.set(id, notes);
                return {};
            },
        }],
    };
}

/**
 * 返回每个插件读到的内容、停止时释放了哪些调用方的门面，以及停止后再用门面的结果。
 * 两个插件都在启动时激活、互不依赖，激活与释放的先后不固定，所以按插件记录而不是记一条流水。
 */
export async function runPerConsumerExample(): Promise<{readonly reads: Readonly<Record<string, ReadonlyArray<string>>>; readonly released: ReadonlyArray<string>; readonly revokedAfterStop: boolean}> {
    const reads = new Map<string, ReadonlyArray<string>>();
    const released: string[] = [];
    const captured = new Map<string, NotesService>();
    const app = createApplication(
        {identity: {location: "server", instanceId: "example"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {keys: [notesKey], plugins: [notesPlugin(released), writerPlugin("example.a", "A 的笔记", reads, captured), writerPlugin("example.b", "B 的笔记", reads, captured)], gates: []},
    );
    await app.startup;
    await app.stop();
    let revokedAfterStop = false;
    try {
        captured.get("example.a")?.read();
    } catch (error) {
        revokedAfterStop = error instanceof ServiceRevokedError;
    }
    return {reads: Object.fromEntries(reads), released: released.toSorted(), revokedAfterStop};
}

if (import.meta.main) {
    console.log(await runPerConsumerExample());
}
