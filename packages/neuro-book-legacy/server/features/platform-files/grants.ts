/**
 * 根能力：宿主签发、消费者持有的操作授予，以及授予的登记与派生。
 *
 * 授予对象由本文件的权威类构造并登记进 `WeakSet`：伪造对象、来自其它服务实例的授予、
 * 以及服务关闭后对已失效授予的派生都会以 `grant-revoked` 拒绝。授予只携带根身份、独立授予
 * 身份与操作集合；子目录范围保存在权威内部记录里，消费者读不到也改不了。
 */

import {randomUUID} from "node:crypto";

import {PlatformFilesError} from "./contracts";
import type {RootGrant, RootOperation} from "./contracts";
import {assertRelativeAddress} from "./paths";

/** 授予的内部记录：只有签发它的权威能读出，`directory` 是授予的子目录范围。 */
export interface GrantRecord {
    readonly rootId: string;
    readonly grantId: string;
    /** 根内相对目录，`.` 表示根自身。 */
    readonly directory: string;
    readonly operations: ReadonlyArray<RootOperation>;
}

/** 规范化操作集合：去重、拒绝未知操作与空集合。 */
export function normalizeOperations(operations: ReadonlyArray<RootOperation>): ReadonlyArray<RootOperation> {
    const normalized: RootOperation[] = [];
    for (const operation of operations) {
        if (operation !== "read" && operation !== "write" && operation !== "delete") {
            throw new TypeError(`未知的操作签字：${String(operation)}`);
        }
        if (!normalized.includes(operation)) {
            normalized.push(operation);
        }
    }
    if (normalized.length === 0) {
        throw new TypeError("授予必须至少声明一个操作");
    }
    return normalized;
}

/** 单根的签发权威：一个服务实例内的每个根一个，授予的登记、派生与失效都只经它。 */
export class RootGrantAuthority {
    readonly #rootId: string;
    readonly #maxOperations: ReadonlyArray<RootOperation>;
    readonly #issued = new WeakSet<object>();
    #active = true;

    constructor(rootId: string, maxOperations: ReadonlyArray<RootOperation>) {
        this.#rootId = rootId;
        this.#maxOperations = normalizeOperations(maxOperations);
    }

    /** 以根上界内的操作集合签发授予；超出上界即整体拒绝，不做部分签发。 */
    issue(directory: string, operations: ReadonlyArray<RootOperation>): RootGrant {
        this.assertActive();
        const normalized = normalizeOperations(operations);
        for (const operation of normalized) {
            if (!this.#maxOperations.includes(operation)) {
                throw new PlatformFilesError(
                    "permission-denied",
                    `授予请求的操作 ${operation} 超出根 ${this.#rootId} 的上界`,
                );
            }
        }
        const record: GrantRecord = {
            rootId: this.#rootId,
            grantId: randomUUID(),
            directory: assertRelativeAddress(directory),
            operations: normalized,
        };
        const grant = new RootGrantImpl(this, record);
        this.#issued.add(grant);
        return grant;
    }

    /** 只承认本权威签发并登记的授予；伪造对象或其它实例的授予返回 null。 */
    recognize(value: RootGrant): GrantRecord | null {
        if (!(value instanceof RootGrantImpl) || !this.#issued.has(value)) {
            return null;
        }
        return {...value.record};
    }

    /** 服务进入停止时调用：之后签发与派生都以 `grant-revoked` 拒绝。 */
    revoke(): void {
        this.#active = false;
    }

    assertActive(): void {
        if (!this.#active) {
            throw new PlatformFilesError("grant-revoked", `根 ${this.#rootId} 的授予已随服务关闭失效`);
        }
    }
}

class RootGrantImpl implements RootGrant {
    readonly rootId: string;
    readonly grantId: string;
    readonly operations: ReadonlyArray<RootOperation>;
    readonly record: GrantRecord;
    readonly #authority: RootGrantAuthority;

    constructor(authority: RootGrantAuthority, record: GrantRecord) {
        this.#authority = authority;
        this.record = record;
        this.rootId = record.rootId;
        this.grantId = record.grantId;
        this.operations = record.operations;
    }

    allows(operation: RootOperation): boolean {
        return this.record.operations.includes(operation);
    }

    narrow(relativeDir: string, operations: ReadonlyArray<RootOperation>): RootGrant {
        this.#authority.assertActive();
        const directory = assertRelativeAddress(relativeDir);
        if (!isWithinDirectory(this.record.directory, directory)) {
            throw new PlatformFilesError("permission-denied", `派生授予不能越出原授予目录：${directory}`);
        }
        const narrowed = normalizeOperations(operations);
        for (const operation of narrowed) {
            if (!this.record.operations.includes(operation)) {
                throw new PlatformFilesError("permission-denied", `派生授予不能扩大操作集合：${operation}`);
            }
        }
        return this.#authority.issue(directory, narrowed);
    }
}

/** 派生目录与操作地址同一坐标（以根为基准）：只能是原授予目录自身或其后代。 */
function isWithinDirectory(base: string, candidate: string): boolean {
    if (base === ".") {
        return true;
    }
    return candidate === base || candidate.startsWith(`${base}/`);
}
