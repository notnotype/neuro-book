import {parentPort} from "node:worker_threads";
parentPort.postMessage("ready");
parentPort.on("message", (m) => parentPort.postMessage(m));
