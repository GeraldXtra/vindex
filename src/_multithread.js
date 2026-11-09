const cluster = require("cluster");

if (cluster.isPrimary) {
    const electron = require("electron");
    const ipc = electron.ipcMain;
    const signale = require("signale");

    cluster.setupPrimary({
        exec: require("path").join(__dirname, "_multithread.js")
    });

    const jobs = ["network", "process", "general"];
    const jobCalls = new Map([
        ["networkInterfaces", "network"],
        ["networkStats", "network"],
        ["processes", "process"],
        ["cpuTemperature", "process"]
    ]);
    const maxRestarts = 3;
    const workers = new Map();
    const restarts = new Map();
    const workerStarts = [];
    const workerStartListeners = [];
    var quitting = false;

    electron.app.on("before-quit", () => {
        quitting = true;
    });

    function jobOf(type) {
        return jobCalls.get(type) || "general";
    }

    function notifyWorkerStart(listener, start) {
        try {
            listener(start.job, start.pid);
        } catch(err) {
            signale.error(`Could not report the start of the ${start.job} worker:`, err);
        }
    }

    function startWorker(job) {
        let worker = cluster.fork({SI_WORKER_JOB: job});
        workers.set(job, worker);

        worker.on("online", () => {
            let start = {job, pid: worker.process.pid};
            workerStarts.push(start);
            workerStartListeners.forEach(listener => notifyWorkerStart(listener, start));
        });
        worker.on("error", err => {
            signale.error(`Multithread worker (${job}) error:`, err);
        });
        worker.on("exit", (code, signal) => {
            if (workers.get(job) === worker) workers.delete(job);
            if (quitting) return;

            let count = restarts.get(job) || 0;
            if (count >= maxRestarts) {
                signale.error(`Multithread worker (${job}) exited (code ${code}, signal ${signal}), not restarting it again after ${maxRestarts} restarts`);
                return;
            }
            restarts.set(job, count+1);
            signale.error(`Multithread worker (${job}) exited (code ${code}, signal ${signal}), restarting it (${count+1}/${maxRestarts})`);
            try {
                startWorker(job);
            } catch(err) {
                signale.error(`Could not restart the multithread worker (${job}):`, err);
            }
        });
    }

    cluster.on("fork", worker => {
        if (workers.get(jobOf("networkInterfaces")) !== worker) return;
        try {
            request("networkInterfaces", [false]);
        } catch(err) {
            signale.error("Could not start the network interfaces scan:", err);
        }
    });

    jobs.forEach(startWorker);

    signale.success("Multithreaded controller ready");

    function dispatch(type, id, arg, onSendError) {
        let job = jobOf(type);
        let worker = workers.get(job);
        if (!worker || worker.isDead() || !worker.isConnected()) throw new Error(`the ${job} worker is not running`);

        worker.send(JSON.stringify({
            id,
            type,
            arg
        }), err => {
            if (err) onSendError(err);
        });
    }

    const allowedCalls = ["battery", "blockDevices", "chassis", "cpu", "cpuTemperature", "currentLoad", "fsSize", "mem", "networkConnections", "networkInterfaces", "networkStats", "processes", "system"];

    function isAllowedCall(type, args) {
        if (!allowedCalls.includes(type)) return false;
        if (args.length === 0) return true;
        if (type === "networkInterfaces") return args.length === 1 && typeof args[0] === "boolean";
        return type === "networkStats" && args.length === 1 && (typeof args[0] === "string" || args[0] === null);
    }

    const isFilled = value => typeof value === "string" && value !== "";
    const fixedChecks = new Map([
        ["cpu", res => isFilled(res.brand)],
        ["system", res => isFilled(res.manufacturer) || isFilled(res.model)],
        ["chassis", res => isFilled(res.manufacturer) || isFilled(res.type)]
    ]);
    const fixedResults = new Map();
    const pending = new Map();

    var queue = {};
    var lastCallID = 0;

    function ask(type, args) {
        return new Promise(resolve => {
            let id = ++lastCallID;
            let timer = setTimeout(() => {
                delete queue[id];
                signale.warn(`systeminformation ${type} call timed out after 90 seconds`);
                resolve(null);
            }, 90000);
            queue[id] = res => {
                clearTimeout(timer);
                resolve(res);
            };
            let fail = (message, err) => {
                clearTimeout(timer);
                delete queue[id];
                signale.error(message, err);
                resolve(null);
            };
            try {
                dispatch(type, id, args[0], err => fail(`Could not send systeminformation ${type} call:`, err));
            } catch(err) {
                fail(`Could not dispatch systeminformation ${type} call:`, err);
            }
        });
    }

    function request(type, args) {
        if (fixedResults.has(type)) return Promise.resolve(fixedResults.get(type));

        let key = JSON.stringify([type, ...args]);
        if (pending.has(key)) return pending.get(key);

        let promise = ask(type, args).then(res => {
            let isGood = fixedChecks.get(type);
            if (isGood && res && isGood(res) && !fixedResults.has(type)) fixedResults.set(type, res);
            return res;
        });
        pending.set(key, promise);
        let settle = () => {
            pending.delete(key);
        };
        promise.then(settle, settle);
        return promise;
    }

    module.exports = (isAllowedSender, onWorkerOnline) => {
        if (typeof onWorkerOnline === "function") {
            workerStarts.forEach(start => notifyWorkerStart(onWorkerOnline, start));
            workerStartListeners.push(onWorkerOnline);
        }

        ipc.handle("systeminformation-call", (e, type, ...args) => {
            try {
                if (!isAllowedSender(e) || !isAllowedCall(type, args)) {
                    signale.warn("Illegal request for systeminformation");
                    return null;
                }

                return request(type, args);
            } catch(err) {
                signale.error("Could not handle systeminformation call:", err);
                return null;
            }
        });
    };

    cluster.on("message", (worker, msg) => {
        try {
            msg = JSON.parse(msg);
            if (queue[msg.id]) {
                queue[msg.id](msg.res);
                delete queue[msg.id];
            }
        } catch(e) {
            signale.error("Could not handle a systeminformation reply:", e);
        }
    });
} else if (cluster.isWorker) {
    const signale = require("signale");
    const si = require("systeminformation");
    const job = process.env.SI_WORKER_JOB;

    signale.info("Multithread worker ("+job+") started at "+process.pid);

    var sharedShell = false;
    if (process.platform === "win32" && (job === "network" || job === "general")) {
        si.powerShellStart();
        sharedShell = true;
        process.prependListener("disconnect", releaseShell);
    }

    function releaseShell() {
        if (!sharedShell) return;
        sharedShell = false;
        si.powerShellRelease();
    }

    const isClosedChannel = err => Boolean(err) && (err.code === "EPIPE" || err.code === "ERR_IPC_CHANNEL_CLOSED");

    function reply(id, res) {
        if (!process.connected) return;
        try {
            process.send(JSON.stringify({
                id,
                res
            }), err => {
                if (err && !isClosedChannel(err)) signale.error("Could not send a systeminformation reply:", err);
            });
        } catch(e) {
            if (!isClosedChannel(e)) signale.error("Could not send a systeminformation reply:", e);
        }
    }

    process.on("message", msg => {
        let id;
        try {
            msg = JSON.parse(msg);
            id = msg.id;
            if (!Object.prototype.hasOwnProperty.call(si, msg.type) || typeof si[msg.type] !== "function") {
                signale.warn("Unknown systeminformation function requested");
                reply(id, null);
                return;
            }
            let call = Promise.resolve(si[msg.type](msg.arg));
            let timer = sharedShell ? setTimeout(() => {
                if (!sharedShell) return;
                releaseShell();
                signale.warn(`systeminformation ${msg.type} call still running after 60 seconds, released the persistent PowerShell: every call in this worker now starts its own`);
            }, 60000) : null;
            call.then(res => {
                clearTimeout(timer);
                reply(id, res);
            }).catch(e => {
                clearTimeout(timer);
                signale.error(`systeminformation ${msg.type} call failed:`, e);
                reply(id, null);
            });
        } catch(e) {
            signale.error("Could not handle a systeminformation request:", e);
            if (id !== undefined) reply(id, null);
        }
    });
}
