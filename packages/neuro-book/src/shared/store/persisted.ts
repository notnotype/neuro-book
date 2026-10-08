/**
 * 持久化字段：一条 Storage 记录在 store 里的投影（docs/specs/state/store.md 输出第 5–16 条）。
 *
 * 三份数据分开：`base` 是已确认的快照，只随 Storage 订阅更新；`display` 是当前显示；排队的意图是还没保存的修改。
 * 保存的结果只结算意图、不写 `base`：订阅按写入顺序送达，迟到的保存结果因此不会让 `base` 倒退。何时把新的 `base`
 * 应用到显示由拥有者决定（`adopt`），另一个窗口保存时不强行改本窗口的显示。
 *
 * 同一字段同一时刻至多一个保存在途；队首确定失败或结果不确定时队列暂停，后面的意图不发，等拥有者 `retry` 或
 * `discard`。结果不确定（`unknown-outcome`）时保留这次要写的具体值与 `expect` 原样重发，不在新 `base` 上重算
 * `change`，否则同一次修改可能生效两次。
 */

import {computed, reactive, readonly, shallowRef} from "@vue/reactivity";
import type {DeepReadonly, ShallowRef} from "@vue/reactivity";

import type {RecordDefinition, RecordHandle, RecordSnapshot, Revision, StorageService} from "nbook/shared/storage";

export type FieldSnapshot<T> = Exclude<RecordSnapshot<T>, {status: "error"}>;

export type CommitResult = "saved" | "failed" | "unknown" | "protected" | "cancelled" | "discarded";

export type SaveState = {readonly state: "idle" | "saving"} | {readonly state: "failed" | "unknown"; readonly code: string};

/** 读取方看到的字段：只有数据，没有方法（输出第 2 条）。 */
export interface PersistedFieldView<T> {
    readonly base: DeepReadonly<FieldSnapshot<T>> | null;
    /** `open` 失败、读取错误或订阅结束时的失败码；订阅结束时是结束原因（例如 `provider-stopped`）。 */
    readonly failure: string | null;
    readonly ready: boolean;
    readonly canSave: boolean;
    readonly display: DeepReadonly<T>;
    readonly queue: number;
    readonly save: SaveState;
}

/** setup 闭包里的字段句柄：数据之外还有方法，方法只经 action 使用。 */
export interface PersistedField<T> {
    readonly base: FieldSnapshot<T> | null;
    readonly failure: string | null;
    readonly ready: boolean;
    readonly canSave: boolean;
    readonly display: T;
    readonly queue: number;
    readonly save: SaveState;
    show(value: T): void;
    commit(change: (current: T) => T): Promise<CommitResult>;
    reset(value: T): Promise<CommitResult>;
    retry(): Promise<CommitResult | "busy" | "nothing">;
    discard(): "discarded" | "busy" | "nothing";
    adopt(): void;
    reopen(): Promise<void>;
}

export interface PersistOptions<T> {
    /** 记录还没有值时的显示；只用于呈现，不自动保存（输出第 5 条）。 */
    readonly initial: T;
    /** `keyed` 记录的资源 id。 */
    readonly resource?: string;
}

/** store 已释放：字段方法与 action 都抛这个错（输出第 17 条）。 */
export class StoreClosedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StoreClosedError";
    }
}

type Operation = "save" | "reset";

interface Intent<T> {
    readonly operation: Operation;
    /** `reset` 的 change 忽略参数、直接给出要写的值。 */
    readonly change: (current: T) => T;
    state: "queued" | "sending" | "failed" | "unknown";
    /** 结果不确定时这次要写的具体值与 expect，`retry` 原样重发。 */
    pending: {readonly value: T; readonly expect: Revision | null} | null;
    /** commit 返回的 Promise 只以第一次尝试的结果结算；结算后置空。 */
    settle: ((result: CommitResult) => void) | null;
}

type Outcome<T> =
    | {readonly result: "saved"}
    | {readonly result: "failed"; readonly code: string}
    | {readonly result: "unknown"; readonly code: string; readonly pending: {readonly value: T; readonly expect: Revision | null}};

/** 失败从哪来：读取错误在下一个正常快照到达时清掉；打开失败与订阅结束要 `reopen`。 */
type FailureKind = "read" | "open" | "ended";

export class PersistedFieldState<T> {
    readonly handle: PersistedField<T>;
    readonly view: PersistedFieldView<T>;

    readonly #record: RecordDefinition<T>;
    readonly #options: PersistOptions<T>;
    readonly #label: string;
    readonly #base = shallowRef<FieldSnapshot<T> | null>(null);
    readonly #failure = shallowRef<{readonly kind: FailureKind; readonly code: string} | null>(null);
    readonly #display: ShallowRef<T>;
    readonly #queueLength = shallowRef(0);
    readonly #save = shallowRef<SaveState>({state: "idle"});
    readonly #queue: Intent<T>[] = [];
    #storage: StorageService | null = null;
    #recordHandle: RecordHandle<T> | null = null;
    #subscription: {release(): void} | null = null;
    /** 每次打开换一代：旧一代的快照与结束回调不再生效。 */
    #openGeneration = 0;
    #opening: Promise<void> | null = null;
    /** 首个快照到达或失败已定（`ready` 变为 true）时完成；停止时等它，未就绪前排队的修改才不会被直接取消。 */
    readonly #settled = Promise.withResolvers<void>();
    #inFlight: Promise<Outcome<T>> | null = null;
    #closed = false;
    #report: (event: string, error: unknown) => void = () => undefined;

    constructor(record: RecordDefinition<T>, options: PersistOptions<T>, label: string) {
        this.#record = record;
        this.#options = options;
        this.#label = label;
        this.#display = shallowRef(options.initial);
        const ready = computed(() => this.#base.value !== null || this.#failure.value !== null);
        const canSave = computed(() => {
            const base = this.#base.value;
            return this.#failure.value === null && base !== null && (base.status === "missing" || base.status === "ok");
        });
        const failure = computed(() => this.#failure.value?.code ?? null);
        this.view = readonly(reactive({
            base: this.#base,
            failure,
            ready,
            canSave,
            display: this.#display,
            queue: this.#queueLength,
            save: this.#save,
        })) as unknown as PersistedFieldView<T>;
        const state = this;
        this.handle = {
            get base() {
                return state.#base.value;
            },
            get failure() {
                return failure.value;
            },
            get ready() {
                return ready.value;
            },
            get canSave() {
                return canSave.value;
            },
            get display() {
                return state.#display.value;
            },
            get queue() {
                return state.#queueLength.value;
            },
            get save() {
                return state.#save.value;
            },
            show: (value) => {
                this.#assertOpen("show");
                this.#display.value = value;
            },
            commit: (change) => this.#enqueue("save", change),
            reset: (value) => this.#enqueue("reset", () => value),
            retry: () => this.#retry(),
            discard: () => this.#discard(),
            adopt: () => {
                this.#assertOpen("adopt");
                this.#display.value = this.#project();
            },
            reopen: () => this.#reopen(),
        };
    }

    /** setup 结束后由 store 调用：打开记录并订阅。`report` 记下不该发生的异常（Storage 的接口不以抛错表达失败）。 */
    attach(storage: StorageService, report: (event: string, error: unknown) => void): void {
        this.#storage = storage;
        this.#report = report;
        this.#opening = this.#guardedOpen();
    }

    /**
     * 停止时发出已接受的意图（输出第 17 条）：等在途保存结束，再按队列顺序发送，直到队列空或队首失败；剩下的
     * 以 `cancelled` 结算。返回这次结算为 `cancelled` 的条数。
     */
    async flush(): Promise<number> {
        for (;;) {
            if (this.#inFlight !== null) {
                await this.#inFlight;
                continue;
            }
            if (this.#base.value === null && this.#failure.value === null) {
                if (this.#opening === null) break;
                await this.#settled.promise;
                continue;
            }
            const head = this.#queue[0];
            if (head === undefined || head.state !== "queued") break;
            this.#pump();
            if (this.#inFlight === null && this.#queue[0] === head) break;
        }
        // 暂停的队首已经以 failed 或 unknown 结算过，只有从没尝试过的才算 cancelled。
        const remaining = this.#queue.splice(0);
        this.#queueLength.value = 0;
        const cancelled = remaining.filter((intent) => intent.settle !== null).length;
        for (const intent of remaining) this.#settleFirst(intent, "cancelled");
        return cancelled;
    }

    /** flush 之后：结束订阅，之后方法都抛错。 */
    close(): void {
        this.#closed = true;
        this.#openGeneration += 1;
        this.#subscription?.release();
        this.#subscription = null;
    }

    #assertOpen(operation: string): void {
        if (this.#closed) throw new StoreClosedError(`${this.#label} 已释放，不能再 ${operation}`);
    }

    #guardedOpen(): Promise<void> {
        return this.#open().catch((error: unknown) => {
            this.#report("store.open-threw", error);
            this.#fail("open", "unavailable");
        });
    }

    async #open(): Promise<void> {
        const generation = ++this.#openGeneration;
        const storage = this.#storage;
        if (storage === null) return;
        const opened = await storage.open(this.#record, this.#options.resource);
        if (generation !== this.#openGeneration) return;
        if (!opened.ok) {
            this.#fail("open", opened.code);
            return;
        }
        this.#recordHandle = opened.handle;
        // 订阅的首个快照与结束都可能早于 subscribe 返回：回调按代次判断，不看订阅是否已登记。
        let ended = false;
        const subscribed = await opened.handle.subscribe(
            (snapshot) => {
                if (generation === this.#openGeneration) this.#receive(snapshot);
            },
            {
                onEnd: (reason) => {
                    ended = true;
                    if (generation === this.#openGeneration) this.#fail("ended", reason);
                },
            },
        );
        if (!subscribed.ok) {
            if (generation === this.#openGeneration) this.#fail("open", subscribed.code);
            return;
        }
        if (ended || generation !== this.#openGeneration) {
            subscribed.handle.release();
            return;
        }
        this.#subscription = subscribed.handle;
    }

    #receive(snapshot: RecordSnapshot<T>): void {
        if (snapshot.status === "error") {
            this.#fail("read", snapshot.code);
            return;
        }
        const first = this.#base.value === null;
        this.#base.value = snapshot;
        this.#settled.resolve();
        if (this.#failure.value?.kind === "read") this.#failure.value = null;
        // 首个快照之前显示的是 initial（加上已排队的修改）；拿到它之后换成它的值。之后的快照不改显示。
        if (first) this.#display.value = this.#project();
        this.#pump();
    }

    #fail(kind: FailureKind, code: string): void {
        this.#failure.value = {kind, code};
        this.#settled.resolve();
        if (kind !== "read") {
            this.#subscription?.release();
            this.#subscription = null;
            this.#recordHandle = null;
        }
        this.#pump();
    }

    #enqueue(operation: Operation, change: (current: T) => T): Promise<CommitResult> {
        this.#assertOpen(operation === "save" ? "commit" : "reset");
        const {promise, resolve} = Promise.withResolvers<CommitResult>();
        const intent: Intent<T> = {operation, change, state: "queued", pending: null, settle: resolve};
        this.#display.value = change(this.#display.value);
        this.#queue.push(intent);
        this.#queueLength.value = this.#queue.length;
        this.#pump();
        return promise;
    }

    #protected(): boolean {
        const status = this.#base.value?.status;
        return status === "corrupt" || status === "unsupported-version";
    }

    /** 能发就发队首；不能发时按原因暂停或结算。 */
    #pump(): void {
        while (this.#inFlight === null) {
            const head = this.#queue[0];
            if (head === undefined || head.state !== "queued") return;
            const failure = this.#failure.value;
            if (failure !== null && failure.kind !== "read") {
                // 订阅结束或打开失败：不发，队首暂停，等拥有者 reopen 再 retry（输出第 16 条）。
                this.#pause(head, {result: "failed", code: failure.code});
                return;
            }
            if (this.#base.value === null || failure !== null) return;
            // 受保护的记录不接受普通修改：轮到它时直接结算、不写，显示回到其余修改的投影（输出第 12 条）。
            if (head.operation === "save" && this.#protected()) {
                this.#queue.shift();
                this.#queueLength.value = this.#queue.length;
                this.#settleFirst(head, "protected");
                this.#display.value = this.#project();
                continue;
            }
            void this.#send(head, null);
            return;
        }
    }

    /** 发送队首；`pending` 不为 null 时是结果不确定后的原样重发。 */
    #send(head: Intent<T>, pending: Intent<T>["pending"]): Promise<Outcome<T>> {
        head.state = "sending";
        this.#save.value = {state: "saving"};
        const attempt = this.#attempt(head, pending).then((outcome) => {
            this.#inFlight = null;
            if (outcome.result === "saved") {
                this.#queue.shift();
                this.#queueLength.value = this.#queue.length;
                this.#settleFirst(head, "saved");
                this.#save.value = {state: "idle"};
                this.#pump();
            } else {
                this.#pause(head, outcome);
            }
            return outcome;
        });
        this.#inFlight = attempt;
        return attempt;
    }

    async #attempt(head: Intent<T>, pending: Intent<T>["pending"]): Promise<Outcome<T>> {
        const handle = this.#recordHandle;
        const base = this.#base.value;
        if (handle === null || base === null) return {result: "failed", code: this.#failure.value?.code ?? "unavailable"};
        const write = (value: T, expect: Revision | null) => (head.operation === "reset" ? handle.reset(value, {expect}) : handle.save(value, {expect}));
        if (pending !== null) {
            const resent = await write(pending.value, pending.expect);
            return resent.ok ? {result: "saved"} : {result: "unknown", code: resent.code, pending};
        }
        const value = head.change(this.#valueOf(base));
        const first = await write(value, base.revision);
        if (first.ok) return {result: "saved"};
        if (first.code === "unknown-outcome") return {result: "unknown", code: first.code, pending: {value, expect: base.revision}};
        if (first.code !== "conflict" || head.operation === "reset") return {result: "failed", code: first.code};
        // 冲突重放一次：读最新快照，把同一个 change 作用在它上面（输出第 11 条）。
        const latest = await handle.read();
        if (latest.status === "error") return {result: "failed", code: latest.code};
        if (latest.status === "corrupt" || latest.status === "unsupported-version") return {result: "failed", code: "protected"};
        const replayed = head.change(this.#valueOf(latest));
        const second = await write(replayed, latest.revision);
        if (second.ok) return {result: "saved"};
        if (second.code === "unknown-outcome") return {result: "unknown", code: second.code, pending: {value: replayed, expect: latest.revision}};
        return {result: "failed", code: second.code};
    }

    #pause(head: Intent<T>, outcome: Exclude<Outcome<T>, {result: "saved"}>): void {
        head.state = outcome.result;
        head.pending = outcome.result === "unknown" ? outcome.pending : null;
        this.#save.value = {state: outcome.result, code: outcome.code};
        this.#settleFirst(head, outcome.result);
    }

    async #retry(): Promise<CommitResult | "busy" | "nothing"> {
        this.#assertOpen("retry");
        if (this.#inFlight !== null) return "busy";
        const head = this.#queue[0];
        if (head === undefined || (head.state !== "failed" && head.state !== "unknown")) return "nothing";
        const failure = this.#failure.value;
        if (this.#base.value === null || (failure !== null && failure.kind !== "read")) return head.state;
        if (head.state === "unknown" && head.pending !== null) {
            const base = this.#base.value;
            // 写已经落盘：订阅送来的 base 已是要写的值，视为完成，不再发（输出第 14 条）。
            if (base.status === "ok" && sameValue(base.value, head.pending.value)) {
                this.#queue.shift();
                this.#queueLength.value = this.#queue.length;
                this.#save.value = {state: "idle"};
                this.#pump();
                return "saved";
            }
            return (await this.#send(head, head.pending)).result;
        }
        head.state = "queued";
        if (head.operation === "save" && this.#protected()) {
            this.#pump();
            return "protected";
        }
        return (await this.#send(head, null)).result;
    }

    #discard(): "discarded" | "busy" | "nothing" {
        this.#assertOpen("discard");
        if (this.#inFlight !== null) return "busy";
        const head = this.#queue[0];
        if (head === undefined || (head.state !== "failed" && head.state !== "unknown")) return "nothing";
        this.#queue.shift();
        this.#queueLength.value = this.#queue.length;
        this.#settleFirst(head, "discarded");
        this.#save.value = {state: "idle"};
        this.#display.value = this.#project();
        this.#pump();
        return "discarded";
    }

    async #reopen(): Promise<void> {
        this.#assertOpen("reopen");
        const failure = this.#failure.value;
        if (failure === null || failure.kind === "read") return;
        this.#failure.value = null;
        this.#opening = this.#guardedOpen();
        await this.#opening;
    }

    /** 把排队的修改依次作用在 base 的值上。 */
    #project(): T {
        const base = this.#base.value;
        let value = base === null ? this.#options.initial : this.#valueOf(base);
        for (const intent of this.#queue) value = intent.change(value);
        return value;
    }

    #valueOf(snapshot: FieldSnapshot<T>): T {
        return snapshot.status === "ok" ? snapshot.value : this.#options.initial;
    }

    #settleFirst(intent: Intent<T>, result: CommitResult): void {
        const settle = intent.settle;
        intent.settle = null;
        settle?.(result);
    }
}

/** JSON 数据的结构相等：Storage 的值经 JSON 往返，键的顺序可能不同。 */
function sameValue(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => Object.hasOwn(right, key) && sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}
