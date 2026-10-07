/**
 * 按调用方门面：提供者交出 `perConsumer(facade, release?)` 时，装配为每个调用方生成自己的门面，
 * 并用可作废的代理包住它。作废后调用方仍可能持有旧门面（例如存进了闭包），所以作废必须在门面上
 * 生效，而不是只从缓存里删掉。行为合同见 docs/specs/runtime/services.md 输出第 11–12 条。
 */

import type {ConsumerIdentity, PerConsumerProvision} from "./contracts";

const provisions = new WeakSet<object>();

/** 构造按调用方提供的实例；把它作为提供者的实例交出即可。 */
export function perConsumer<F extends object>(
    facade: (consumer: ConsumerIdentity) => F,
    release?: (facade: F, consumer: ConsumerIdentity) => void | Promise<void>,
): PerConsumerProvision<F> {
    const provision = Object.freeze({facade, release}) as unknown as PerConsumerProvision<F>;
    provisions.add(provision);
    return provision;
}

export function isPerConsumerProvision(value: unknown): value is PerConsumerProvision<object> {
    return typeof value === "object" && value !== null && provisions.has(value);
}

/** 访问已作废或已释放的门面时抛出。 */
export class ServiceRevokedError extends Error {
    readonly key: string;
    readonly consumer: ConsumerIdentity;

    constructor(key: string, consumer: ConsumerIdentity, reason: "released" | "provider-stopped") {
        const who = consumer.plugin === null ? consumer.instanceId : `${consumer.plugin}/${consumer.entry ?? ""}#${String(consumer.generation)}`;
        super(`服务 ${key} 给 ${who} 的门面已${reason === "released" ? "随调用方释放" : "随提供者停止作废"}`);
        this.name = "ServiceRevokedError";
        this.key = key;
        this.consumer = consumer;
    }
}

export interface RevocableFacade {
    readonly proxy: object;
    revoke(reason: "released" | "provider-stopped"): void;
}

/**
 * 字符串属性在作废后一律抛错；`then` 永远返回 undefined，使门面不会被当成 thenable（否则从 async
 * 函数返回或 await 它会在作废后抛错）；symbol 属性透传，供调试与类型检查使用。函数属性返回同一个
 * 包装：调用方先取出方法再调用（`const read = facade.read`）时，作废也在调用时生效。
 */
export function revocableFacade(target: object, key: string, consumer: ConsumerIdentity): RevocableFacade {
    let revoked: "released" | "provider-stopped" | null = null;
    const guard = (property: string | symbol): void => {
        if (revoked !== null && typeof property === "string") {
            throw new ServiceRevokedError(key, consumer, revoked);
        }
    };
    const wrappers = new Map<string, (...args: unknown[]) => unknown>();
    const proxy = new Proxy(target, {
        get(object, property, receiver) {
            if (property === "then") {
                return undefined;
            }
            guard(property);
            const value: unknown = Reflect.get(object, property, receiver);
            if (typeof value !== "function" || typeof property !== "string") {
                return value;
            }
            let wrapper = wrappers.get(property);
            if (wrapper === undefined) {
                wrapper = (...args: unknown[]): unknown => {
                    guard(property);
                    return (Reflect.get(object, property) as (...args: unknown[]) => unknown).apply(object, args);
                };
                wrappers.set(property, wrapper);
            }
            return wrapper;
        },
        has(object, property) {
            guard(property);
            return Reflect.has(object, property);
        },
        set(object, property, value, receiver) {
            guard(property);
            return Reflect.set(object, property, value, receiver);
        },
    });
    return {
        proxy,
        revoke(reason) {
            revoked ??= reason;
        },
    };
}
