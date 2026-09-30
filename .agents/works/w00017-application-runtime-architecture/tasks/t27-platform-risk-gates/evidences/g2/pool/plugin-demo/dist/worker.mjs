// src/ops.ts
var WASM_SPIN = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 7, 8, 1, 4, 115, 112, 105, 110, 0, 0, 10, 9, 1, 7, 0, 3, 64, 12, 0, 11, 11]);
function spin(ms, progress) {
  const end = ms < 0 ? Infinity : performance.now() + ms;
  let n = 0;
  while (performance.now() < end) {
    n++;
    if (n % 5000000 === 0)
      progress({ n });
  }
  return n;
}
function block(kind) {
  if (kind === "atomics-wait")
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  else if (kind === "sleep-sync")
    globalThis.Bun.sleepSync(60000);
  else if (kind === "regex")
    /^(a+)+$/.test(`${"a".repeat(40)}b`);
  else if (kind === "wasm-loop")
    new WebAssembly.Instance(new WebAssembly.Module(WASM_SPIN)).exports.spin();
  else if (kind === "sort") {
    const a = Array.from({ length: 30000000 }, () => Math.random());
    a.sort((x, y) => x - y);
  }
}

// src/worker.ts
async function run(input, { progress }) {
  switch (input.op) {
    case "echo":
      return input.payload;
    case "spin":
      return spin(input.ms, progress);
    case "block":
      block(input.kind);
      return "unreachable";
    case "progress":
      for (let i = 0;i < input.count; i++)
        progress(i);
      return input.count;
    case "throw": {
      const e = new RangeError(`bad input ${input.value}`);
      throw e;
    }
    case "bad-output":
      return () => 1;
    case "exit":
      globalThis.process?.exit(3);
      return null;
    case "bytes":
      return new Uint8Array(input.size).length;
    default:
      throw new Error(`unknown op ${input.op}`);
  }
}
export {
  run as default
};
