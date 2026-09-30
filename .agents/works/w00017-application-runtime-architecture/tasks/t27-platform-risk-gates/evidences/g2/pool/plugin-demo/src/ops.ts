// 插件自己的计算逻辑（示例）。只做纯计算：输入输出可结构化克隆，不访问宿主 API。
export type Progress = (value: unknown) => void;
const WASM_SPIN = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 7, 8, 1, 4, 115, 112, 105, 110, 0, 0, 10, 9, 1, 7, 0, 3, 64, 12, 0, 11, 11]);

export function spin(ms: number, progress: Progress): number {
    const end = ms < 0 ? Infinity : performance.now() + ms;
    let n = 0;
    while (performance.now() < end) {
        n++;
        if (n % 5_000_000 === 0) progress({n});
    }
    return n;
}

export function block(kind: string): void {
    if (kind === "atomics-wait") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    else if (kind === "sleep-sync") (globalThis as any).Bun.sleepSync(60_000);
    else if (kind === "regex") /^(a+)+$/.test(`${"a".repeat(40)}b`);
    else if (kind === "wasm-loop") (new WebAssembly.Instance(new WebAssembly.Module(WASM_SPIN)).exports.spin as () => void)();
    else if (kind === "sort") { const a = Array.from({length: 3e7}, () => Math.random()); a.sort((x, y) => x - y); }
}
