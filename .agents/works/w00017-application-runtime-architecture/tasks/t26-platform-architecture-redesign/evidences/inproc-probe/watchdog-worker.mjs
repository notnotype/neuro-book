import {workerData} from "node:worker_threads";
import {writeFileSync} from "node:fs";
const beat = new Int32Array(workerData.sab, 0, 1);
const inflight = new Int32Array(workerData.sab, 4, 1);          // 主线程登记的在途插件编号
let last = Atomics.load(beat, 0), stalledSince = Date.now();
setInterval(() => {
  const now = Atomics.load(beat, 0);
  if (now !== last) { last = now; stalledSince = Date.now(); return; }
  if (Date.now() - stalledSince > workerData.limitMs) {
    writeFileSync(workerData.report, JSON.stringify({stalledMs: Date.now() - stalledSince, inflightPlugin: Atomics.load(inflight, 0)}));
    process.kill(process.pid, "SIGKILL");                          // 主线程被占，只能从 worker 结束整个进程
  }
}, 100);
