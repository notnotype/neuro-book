/**
 * 创建管理员的命令读密码（`site.operations` 输出 5；w00037 t07 计划 3.12 第 2 步、设计审查处理表第 8 条、omp 设计审查第 15 条）。
 *
 * 两种来源：
 * - 标准输入是终端：原始模式下逐字节读，不回显（计划探针 p8）。原始模式里终端不再替我们处理退格、Ctrl-C 这些键，它们都作为
 *   字节送来，所以由 `TerminalLineDecoder` 自己解释；Ctrl-C 是一个 `\u0003` 字节、进程收不到 `SIGINT`（p8）。密码输两次并比对。
 * - 标准输入是管道：读到结尾整体解码，去掉末尾的一个换行，只读一次；其余的控制字符与终端里一样不收（`decodePipedPassword`）。
 *
 * 结果的分工：输错的（空、不合长度、两次不一致、含控制字符）回 `invalid`，用户按 Ctrl-C 或空输入时按 Ctrl-D 回 `cancelled`，
 * 都是 resolve；只有 `signal` abort（进程收到停止信号）才 reject，reject 为 `signal.reason`，入口据此报 `interrupted`
 * （`SiteCommand` 的约定）。Ctrl-C 不 reject：那时 `signal` 没有 abort，入口会把 reject 当成没预料到的错误、报 `internal`。
 *
 * 终端模式在 `finally` 里恢复：正常读完、输错、取消、abort 都一样，命令退出后终端不会停在不回显的状态。
 */

import {PASSWORD} from "@notnotype/nb-site-identity-contract";

/** 一行输入读完时的结果。 */
export type TerminalEvent =
    /** 回车；`text` 是这一行的内容（已按退格、Ctrl-U 处理过）。 */
    | {readonly kind: "line"; readonly text: string}
    /** 回车，但这一行里出现过不收的输入（控制字符、坏的 UTF-8、超过密码上限），内容作废。 */
    | {readonly kind: "rejected"}
    /** 还没输入内容时按了 Ctrl-D。 */
    | {readonly kind: "eof"}
    /** Ctrl-C。 */
    | {readonly kind: "interrupt"};

const CTRL_C = 0x03;
const CTRL_D = 0x04;
const BACKSPACE = 0x08;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const CTRL_U = 0x15;
const DELETE = 0x7f;

/** UTF-8 多字节序列的首字节决定的长度；不能作首字节的回 0。只看形状，超长编码与代理项由 `TextDecoder` 的 `fatal` 拦下。 */
function sequenceLength(lead: number): number {
    if (lead >= 0xc2 && lead <= 0xdf) return 2;
    if (lead >= 0xe0 && lead <= 0xef) return 3;
    if (lead >= 0xf0 && lead <= 0xf4) return 4;
    return 0;
}

/**
 * 不收进密码的控制字符：C0（U+0000 到 U+001F）、U+007F、C1（U+0080 到 U+009F）。终端与管道两种来源用同一条规则（实现审查第 4、5 片
 * 第 3 条）：浏览器的密码框输不出它们，收下了，这个管理员就只能在命令行里登录。C1 在键盘上也打不出来，出现了多半是终端发来的控制序列。
 */
function isControlCharacter(codePoint: number): boolean {
    return codePoint <= 0x1f || codePoint === 0x7f || (codePoint >= 0x80 && codePoint <= 0x9f);
}

/**
 * 终端原始模式下的按键字节流，切成一行一行。可以跨多次 `push` 续上：一个多字节字符被切在两块之间、两行在同一块里送来都照常。
 *
 * - 回车（`\r`）或换行（`\n`）结束一行；`\r` 紧跟的 `\n` 不算新的一行（粘贴来的文字常是 `\r\n`，不然第二次输入会被当成空行）。
 * - 退格（`0x7f` 或 `0x08`）删掉最后一个码点；Ctrl-U 清空这一行，连同“出现过不收的输入”的标记一起清掉，用户可以重输。
 * - 没有内容时 Ctrl-D 是取消；有内容时什么也不做（不进密码，也不结束这一行）。
 * - 其余控制字符（Tab、Esc、方向键发来的控制序列等）与坏的 UTF-8 不收：这一行标为作废，回车时回 `rejected`。不是悄悄丢掉
 *   那个字节：方向键是 `Esc [ A`，只丢 `Esc` 会把 `[A` 留进密码，用户却看不见。
 * - 超过密码上限（`PASSWORD.maxLength` 个码点）的这一行同样作废；多出来的码点不再存，内存不随输入增长。
 *
 * 控制字节都小于 0x80，不会出现在合法的多字节序列里，所以先按字节判控制字符、再把 0x80 以上的字节拼成码点。
 */
export class TerminalLineDecoder {
    // `ignoreBOM`：缺省的解码去掉每次解码开头的 U+FEFF，逐码点解码时密码里任何位置的它都会丢，两次只差一个 U+FEFF 的输入被当成
    // 一致（omp 实现审查第 5 条）。原样留下，交给后面的校验。
    readonly #utf8 = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true});
    #codePoints: string[] = [];
    #tainted = false;
    /** 还没拼完的多字节序列。 */
    #pending: number[] = [];
    #pendingLength = 0;
    #afterCarriageReturn = false;

    push(bytes: Uint8Array): TerminalEvent[] {
        const events: TerminalEvent[] = [];
        for (const byte of bytes) {
            const event = this.#byte(byte);
            if (event !== undefined) events.push(event);
        }
        return events;
    }

    #byte(byte: number): TerminalEvent | undefined {
        const afterCarriageReturn = this.#afterCarriageReturn;
        this.#afterCarriageReturn = false;
        if (byte >= 0x80) {
            this.#continueSequence(byte);
            return undefined;
        }
        // 单字节的输入打断了没拼完的多字节序列：那个序列是坏的。
        if (this.#pending.length > 0) {
            this.#pending = [];
            this.#tainted = true;
        }
        switch (byte) {
            case CARRIAGE_RETURN:
                this.#afterCarriageReturn = true;
                return this.#endLine();
            case LINE_FEED:
                return afterCarriageReturn ? undefined : this.#endLine();
            case CTRL_C:
                this.#reset();
                return {kind: "interrupt"};
            case CTRL_D:
                if (this.#codePoints.length === 0 && !this.#tainted) return {kind: "eof"};
                return undefined;
            case DELETE:
            case BACKSPACE:
                this.#codePoints.pop();
                return undefined;
            case CTRL_U:
                this.#reset();
                return undefined;
            default:
                if (isControlCharacter(byte)) this.#tainted = true;
                else this.#append(String.fromCharCode(byte));
                return undefined;
        }
    }

    #continueSequence(byte: number): void {
        if (this.#pending.length === 0) {
            const length = sequenceLength(byte);
            if (length === 0) {
                this.#tainted = true;
                return;
            }
            this.#pending = [byte];
            this.#pendingLength = length;
            return;
        }
        if (byte > 0xbf) {
            // 该是续字节的位置来了一个首字节：前一个序列是坏的，这个字节重新起一个序列。
            this.#pending = [];
            this.#tainted = true;
            this.#continueSequence(byte);
            return;
        }
        this.#pending.push(byte);
        if (this.#pending.length < this.#pendingLength) return;
        const sequence = Uint8Array.from(this.#pending);
        this.#pending = [];
        let char: string;
        try {
            char = this.#utf8.decode(sequence);
        } catch {
            // 超长编码、代理项、超出 U+10FFFF：形状对但不是合法的 UTF-8。这一行作废，回车时回 rejected，不另记诊断（是输入错误）。
            this.#tainted = true;
            return;
        }
        if (isControlCharacter(char.codePointAt(0)!)) this.#tainted = true;
        else this.#append(char);
    }

    #append(char: string): void {
        if (this.#codePoints.length >= PASSWORD.maxLength) {
            this.#tainted = true;
            return;
        }
        this.#codePoints.push(char);
    }

    #endLine(): TerminalEvent {
        const event: TerminalEvent = this.#tainted ? {kind: "rejected"} : {kind: "line", text: this.#codePoints.join("")};
        this.#reset();
        return event;
    }

    #reset(): void {
        this.#codePoints = [];
        this.#tainted = false;
        this.#pending = [];
    }
}

/**
 * 管道读到的全部字节最多留这么多：密码上限的码点每个至多 4 个字节，再加末尾的 `\r\n`。超过的一定不合规则，不再往下读。
 */
export const PIPED_PASSWORD_MAX_BYTES = PASSWORD.maxLength * 4 + 2;

/**
 * 管道读到结尾的字节整体解码，去掉末尾的一个换行（`\n` 或 `\r\n`，`echo` 与 Windows 的写法）。坏的 UTF-8、去掉那个换行以后仍含
 * 控制字符（中间的换行、多出来的空行、只有 `\r` 的结尾、Tab、Esc）时回 null，与终端里一样不收。管道里的退格（U+007F）不当按键
 * 解释，同样作为控制字符不收。
 */
export function decodePipedPassword(bytes: Uint8Array): string | null {
    let text: string;
    try {
        // `ignoreBOM`：开头的 U+FEFF 是密码的一部分，缺省会被去掉，存进去的就不是输入的密码（omp 实现审查第 5 条）。
        text = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(bytes);
    } catch {
        return null;
    }
    if (text.endsWith("\r\n")) text = text.slice(0, -2);
    else if (text.endsWith("\n")) text = text.slice(0, -1);
    for (const char of text) if (isControlCharacter(char.codePointAt(0)!)) return null;
    return text;
}

/** 读密码的来源；产品用 `processPasswordSource()`，包内测试注入自己送字节的来源。 */
export interface PasswordSource {
    /** 标准输入是不是终端。 */
    readonly isTerminal: boolean;
    /** 只在终端上调用。 */
    setRawMode(on: boolean): void;
    /** 提示写到标准错误：标准输出只放日志行。 */
    prompt(text: string): void;
    /** 开始送字节，返回停止的函数；停止之后不再回调。 */
    subscribe(handlers: {readonly data: (chunk: Uint8Array) => void; readonly end: () => void; readonly error: (error: unknown) => void}): () => void;
}

/** 进程的标准输入与标准错误。 */
export function processPasswordSource(): PasswordSource {
    const stdin = process.stdin;
    return {
        isTerminal: stdin.isTTY === true,
        setRawMode: (on) => {
            stdin.setRawMode(on);
        },
        prompt: (text) => {
            process.stderr.write(text);
        },
        subscribe: (handlers) => {
            // 没有调 `setEncoding`，`data` 给的是 Buffer；防万一给了字符串时按 UTF-8 还原成字节。
            const onData = (chunk: Buffer | string): void => handlers.data(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
            stdin.on("data", onData);
            stdin.on("end", handlers.end);
            stdin.on("error", handlers.error);
            stdin.resume();
            return () => {
                stdin.off("data", onData);
                stdin.off("end", handlers.end);
                stdin.off("error", handlers.error);
                stdin.pause();
            };
        },
    };
}

export type PasswordProblem = "missing" | "invalid" | "mismatch";

export type PasswordOutcome =
    | {readonly kind: "password"; readonly password: string}
    | {readonly kind: "invalid"; readonly problem: PasswordProblem}
    /** 用户取消（Ctrl-C，或空输入时 Ctrl-D；终端被关掉也算）：命令以 `interrupted` 结束。 */
    | {readonly kind: "cancelled"};

const PASSWORD_PATTERN = new RegExp(PASSWORD.pattern, "u");

/** 一次输入的长度是否合规则（`site.accounts` 字段规则：新设的密码 8 到 128 个码点）。 */
function judge(password: string): PasswordOutcome {
    if (password === "") return {kind: "invalid", problem: "missing"};
    return PASSWORD_PATTERN.test(password) ? {kind: "password", password} : {kind: "invalid", problem: "invalid"};
}

export const TERMINAL_PROMPT = "Password: ";
export const TERMINAL_REPEAT_PROMPT = "Repeat the password: ";
/** 管道模式也写一行提示（以换行结束：命令失败时那一行 JSON 要单独占最后一行，`site.operations` 输出 10）。 */
export const PIPE_PROMPT = "Reading the password from standard input\n";

/**
 * 读密码。`signal` abort 时停止读、恢复终端模式、reject 为 `signal.reason`；已经 abort 时直接 reject，不碰终端。
 */
export async function readPassword(source: PasswordSource, signal: AbortSignal): Promise<PasswordOutcome> {
    if (signal.aborted) throw signal.reason;
    return source.isTerminal ? readFromTerminal(source, signal) : readFromPipe(source, signal);
}

/**
 * 把来源的回调接成一个 Promise：`collect` 每收到一块字节被调用一次，返回非 undefined 就以它 resolve；`atEnd` 给流结束时的结果。
 * 收手（resolve、reject）之后停止订阅、摘掉挂在 `signal` 上的监听（它是进程级的长寿命信号）。
 */
function consume<T>(source: PasswordSource, signal: AbortSignal, collect: (chunk: Uint8Array) => T | undefined, atEnd: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        let stop: (() => void) | undefined;
        const finish = (settle: () => void): void => {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", onAbort);
            stop?.();
            settle();
        };
        const onAbort = (): void => finish(() => reject(signal.reason));
        signal.addEventListener("abort", onAbort, {once: true});
        stop = source.subscribe({
            data: (chunk) => {
                if (settled) return;
                const result = collect(chunk);
                if (result !== undefined) finish(() => resolve(result));
            },
            end: () => finish(() => resolve(atEnd())),
            error: (error) => finish(() => reject(error)),
        });
        // `subscribe` 里同步送完了字节（或送完前就 abort 了）时，`stop` 在 `finish` 那一刻还没赋值。
        if (settled) stop();
    });
}

async function readFromPipe(source: PasswordSource, signal: AbortSignal): Promise<PasswordOutcome> {
    source.prompt(PIPE_PROMPT);
    const chunks: Uint8Array[] = [];
    let size = 0;
    const overflow: PasswordOutcome = {kind: "invalid", problem: "invalid"};
    return consume<PasswordOutcome>(
        source,
        signal,
        (chunk) => {
            size += chunk.byteLength;
            if (size > PIPED_PASSWORD_MAX_BYTES) return overflow;
            chunks.push(chunk);
            return undefined;
        },
        () => {
            const password = decodePipedPassword(Buffer.concat(chunks));
            return password === null ? {kind: "invalid", problem: "invalid"} : judge(password);
        },
    );
}

async function readFromTerminal(source: PasswordSource, signal: AbortSignal): Promise<PasswordOutcome> {
    const decoder = new TerminalLineDecoder();
    /** 一块里可能有好几行（粘贴、打得快）：没用上的留给下一次。 */
    const queued: TerminalEvent[] = [];
    const nextEvent = (): Promise<TerminalEvent> => {
        const ready = queued.shift();
        if (ready !== undefined) return Promise.resolve(ready);
        return consume<TerminalEvent>(
            source,
            signal,
            (chunk) => {
                queued.push(...decoder.push(chunk));
                return queued.shift();
            },
            // 终端关掉了（例如 ssh 断开）：当作取消。
            () => ({kind: "eof"}),
        );
    };

    source.setRawMode(true);
    let lineOpen = false;
    try {
        source.prompt(TERMINAL_PROMPT);
        lineOpen = true;
        const first = await nextEvent();
        // 不回显，光标还停在提示后面：每次输完换一行。
        source.prompt("\n");
        lineOpen = false;
        if (first.kind === "interrupt" || first.kind === "eof") return {kind: "cancelled"};
        if (first.kind === "rejected") return {kind: "invalid", problem: "invalid"};
        const judged = judge(first.text);
        if (judged.kind !== "password") return judged;

        source.prompt(TERMINAL_REPEAT_PROMPT);
        lineOpen = true;
        const second = await nextEvent();
        source.prompt("\n");
        lineOpen = false;
        if (second.kind === "interrupt" || second.kind === "eof") return {kind: "cancelled"};
        if (second.kind === "rejected" || second.text !== first.text) return {kind: "invalid", problem: "mismatch"};
        return judged;
    } finally {
        // 被 abort 打断在提示后面时补一个换行，入口随后写的失败行才单独占一行。
        if (lineOpen) source.prompt("\n");
        source.setRawMode(false);
    }
}
