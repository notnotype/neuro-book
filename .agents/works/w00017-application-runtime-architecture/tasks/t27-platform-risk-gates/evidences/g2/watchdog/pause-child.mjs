import {startMainThreadWatchdog} from "./watchdog-host.mjs";
const pauseGapMs = process.argv[2] === "naive" ? 1e12 : 2000;
startMainThreadWatchdog({thresholdMs: 3000, beatMs: 1000, checkMs: 500, pauseGapMs, reportPath: `${process.env.OUT_DIR}/pause-${process.pid}.json`, exitMethod: "ffi-exit", exitCode: 76});
setInterval(() => {}, 1000);
