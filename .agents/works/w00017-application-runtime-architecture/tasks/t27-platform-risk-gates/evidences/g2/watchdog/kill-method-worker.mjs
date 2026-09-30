import {workerData} from "node:worker_threads";
import {dlopen, FFIType} from "bun:ffi";
setTimeout(() => {
  const m = workerData.method;
  if (m === "sigkill") process.kill(process.pid, "SIGKILL");
  else if (m === "sigterm") process.kill(process.pid, "SIGTERM");
  else if (m === "exit") process.exit(76);
  else if (m === "abort") process.abort();
  else if (m === "reallyExit") process.reallyExit(76);
  else if (m === "ffi-exit") {
    // exit_group：结束全部线程，不运行任何 JS 退出钩子
    const libc = dlopen("libc.so.6", {_exit: {args: [FFIType.i32], returns: FFIType.void}});
    libc.symbols._exit(76);
  }
  setTimeout(() => { console.log(`worker: ${m} 返回后 worker 仍在运行`); }, 50);
}, 300);
