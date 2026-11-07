const cluster = require("cluster");

if (cluster.isMaster) {
    const electron = require("electron");
    const ipc = electron.ipcMain;
    const signale = require("signale");
    // Also, leave a core available for the renderer process
    const osCPUs = require("os").cpus().length - 1;
    // See #904
    const numCPUs = (osCPUs > 7) ? 7 : osCPUs;

    const si = require("systeminformation");

    cluster.setupMaster({
        exec: require("path").join(__dirname, "_multithread.js")
    });

    let workers = [];
    cluster.on("fork", worker => {
        workers.push(worker.id);
    });

    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    signale.success("Multithreaded controller ready");

    var lastID = 0;

    function dispatch(type, id, arg) {
        let selectedID = lastID+1;
        if (selectedID > numCPUs-1) selectedID = 0;

        cluster.workers[workers[selectedID]].send(JSON.stringify({
            id,
            type,
            arg
        }));

        lastID = selectedID;
    }

    const allowedCalls = ["battery", "blockDevices", "chassis", "cpu", "cpuTemperature", "currentLoad", "fsSize", "mem", "networkConnections", "networkInterfaces", "networkStats", "processes", "system"];

    function isAllowedCall(type, args) {
        if (!allowedCalls.includes(type)) return false;
        if (args.length === 0) return true;
        return type === "networkStats" && args.length === 1 && (typeof args[0] === "string" || args[0] === null);
    }

    var queue = {};
    var lastCallID = 0;
    module.exports = isAllowedSender => {
        ipc.handle("systeminformation-call", (e, type, ...args) => {
            try {
                if (!isAllowedSender(e) || !isAllowedCall(type, args)) {
                    signale.warn("Illegal request for systeminformation");
                    return null;
                }

                if (args.length > 1 || workers.length <= 0) {
                    return si[type](...args).catch(err => {
                        signale.error(`systeminformation ${type} call failed:`, err);
                        return null;
                    });
                }

                return new Promise(resolve => {
                    let id = ++lastCallID;
                    queue[id] = resolve;
                    try {
                        dispatch(type, id, args[0]);
                    } catch(err) {
                        delete queue[id];
                        signale.error(`Could not dispatch systeminformation ${type} call:`, err);
                        resolve(null);
                    }
                });
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

    signale.info("Multithread worker started at "+process.pid);

    process.on("message", msg => {
        msg = JSON.parse(msg);
        si[msg.type](msg.arg).then(res => {
            process.send(JSON.stringify({
                id: msg.id,
                res
            }));
        });
    });
}
