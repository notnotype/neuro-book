import {block, spin, type Progress} from "./ops";

type Input = {op: string; [key: string]: any};

export default async function run(input: Input, {progress}: {progress: Progress}): Promise<unknown> {
    switch (input.op) {
        case "echo": return input.payload;
        case "spin": return spin(input.ms, progress);
        case "block": block(input.kind); return "unreachable";
        case "progress": for (let i = 0; i < input.count; i++) progress(i); return input.count;
        case "throw": { const e = new RangeError(`bad input ${input.value}`); throw e; }
        case "bad-output": return () => 1;
        case "exit": (globalThis as any).process?.exit(3); return null;
        case "bytes": return new Uint8Array(input.size).length;
        default: throw new Error(`unknown op ${input.op}`);
    }
}
