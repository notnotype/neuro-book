/**
 * 引用（docs/specs/agent/page-agent.md 输出 4）：形如 `k7q.12`，前段是这次页面加载的前缀，后段单调发号。
 *
 * 发号时存下元素的身份；同一元素身份没变就沿用原来的号，身份变了（例如以下标为 key 的列表反序后，同一个 DOM 元素换了内容）
 * 发新号，旧号仍指着旧身份，用旧号时核对不上就按元素不在了处理。
 */

/** 元素的身份：这几项都相同才算还是“那个元素”。 */
export interface Identity {
    readonly role: string;
    readonly name: string;
    readonly target: string | null;
    readonly key: string | null;
    /** 所在层的根；null 是底层。 */
    readonly layer: Element | null;
    readonly layerRole: string | null;
    readonly layerName: string | null;
}

/**
 * 同一层：层根是同一个元素；或原来的层根已不在页面上（弹层关了又开，换了新元素），现在的层根角色与名字相同。
 */
export function sameLayer(issued: Identity, current: Identity): boolean {
    if (issued.layer === current.layer) return true;
    return issued.layer !== null && current.layer !== null && !issued.layer.isConnected
        && issued.layerRole === current.layerRole && issued.layerName === current.layerName;
}

export function sameIdentity(issued: Identity, current: Identity): boolean {
    return issued.role === current.role && issued.name === current.name && issued.target === current.target
        && issued.key === current.key && sameLayer(issued, current);
}

export type RefLookup =
    | {readonly kind: "foreign"}
    | {readonly kind: "unknown"}
    | {readonly kind: "known"; readonly element: Element | null; readonly identity: Identity};

const REF_PATTERN = /^([a-z][a-z0-9]{1,7})\.([1-9][0-9]{0,8})$/u;
/** 一次页面加载里至多记这么多条；更早的号被淘汰，用时按“不是这次发的”处理。 */
const RECORD_LIMIT = 20_000;

/** 这次页面加载的前缀：一个小写字母加两个字母或数字。同一窗口刷新前后撞上同一个的概率约 1/34000，撞上了还有身份核对。 */
export function randomRefPrefix(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(3));
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    return alphabet[bytes[0]! % 26]! + alphabet[bytes[1]! % 36]! + alphabet[bytes[2]! % 36]!;
}

interface RefRecord {
    readonly element: WeakRef<Element>;
    readonly identity: Identity;
}

export class RefRegistry {
    readonly prefix: string;
    #next = 1;
    readonly #byElement = new WeakMap<Element, number>();
    readonly #records = new Map<number, RefRecord>();

    constructor(prefix: string) {
        if (!/^[a-z][a-z0-9]{1,7}$/u.test(prefix)) throw new TypeError(`引用前缀要是 2 到 8 个小写字母或数字、以字母开头：${prefix}`);
        this.prefix = prefix;
    }

    /** 给元素一个引用：身份没变时沿用原来的号。 */
    issue(element: Element, identity: Identity): string {
        const existing = this.#byElement.get(element);
        if (existing !== undefined) {
            const record = this.#records.get(existing);
            if (record !== undefined && sameIdentity(record.identity, identity)) return this.#format(existing);
        }
        const id = this.#next;
        this.#next += 1;
        this.#records.set(id, {element: new WeakRef(element), identity});
        this.#byElement.set(element, id);
        if (this.#records.size > RECORD_LIMIT) this.#evict();
        return this.#format(id);
    }

    lookup(ref: string): RefLookup {
        const match = REF_PATTERN.exec(ref);
        if (match === null || match[1] !== this.prefix) return {kind: "foreign"};
        const record = this.#records.get(Number(match[2]));
        if (record === undefined) return {kind: "unknown"};
        return {kind: "known", element: record.element.deref() ?? null, identity: record.identity};
    }

    #format(id: number): string {
        return `${this.prefix}.${String(id)}`;
    }

    /** 先丢元素已被回收的，还多就丢最早发的；Map 按插入顺序迭代，最早发的在前。 */
    #evict(): void {
        for (const [id, record] of this.#records) {
            if (record.element.deref() === undefined) this.#records.delete(id);
        }
        for (const id of this.#records.keys()) {
            if (this.#records.size <= RECORD_LIMIT * 0.9) break;
            this.#records.delete(id);
        }
    }
}
