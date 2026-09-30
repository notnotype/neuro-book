import {parentPort, workerData} from "node:worker_threads";
for (const url of workerData.urls) await import(url);
parentPort.postMessage("ready");
