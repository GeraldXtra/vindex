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
        ["netTraffic", "network"],
        ["netConnections", "network"],
        ["netNames", "network"],
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

    const allowedCalls = ["battery", "blockDevices", "chassis", "cpu", "cpuTemperature", "currentLoad", "fsSize", "mem", "netConnections", "netNames", "netTraffic", "networkConnections", "networkInterfaces", "networkStats", "processes", "system"];

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

    const path = require("path");
    const net = require("net");
    const childProcess = require("child_process");
    const shellTools = require("systeminformation/lib/util");
    const netstatFile = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "netstat.exe");
    const trafficScript = "&{$ProgressPreference='SilentlyContinue';try{$f=[Diagnostics.Stopwatch]::Frequency;$t=[Diagnostics.Stopwatch]::GetTimestamp();$all=[Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces();'T|'+$t+'|'+$f;foreach($n in $all){try{if($n.OperationalStatus -eq 'Up' -and $n.NetworkInterfaceType -ne 'Loopback'){try{$s=$n.GetIPStatistics()}catch{$s=$n.GetIPv4Statistics()};$p=$n.GetIPProperties();$g=0;foreach($a in $p.GatewayAddresses){if(-not $a.Address.Equals([Net.IPAddress]::Any) -and -not $a.Address.Equals([Net.IPAddress]::IPv6Any)){$g=1}};$v=@();foreach($u in $p.UnicastAddresses){if($u.Address.AddressFamily -eq 'InterNetwork'){$v+=$u.Address.ToString()}};'N|'+[int]$n.NetworkInterfaceType+'|'+$n.Speed+'|'+$s.BytesReceived+'|'+$s.BytesSent+'|'+$g+'|'+($v -join ',')+'|'+$n.Name}}catch{}}}catch{}}";
    const connectionScript = "&{$ProgressPreference='SilentlyContinue';try{$g=[Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties();foreach($c in $g.GetActiveTcpConnections()){if($c.State -eq 'Established'){'E|'+$c.LocalEndPoint.Address+'|'+$c.LocalEndPoint.Port+'|'+$c.RemoteEndPoint.Address+'|'+$c.RemoteEndPoint.Port}};foreach($l in $g.GetActiveTcpListeners()){'L|'+$l.Address+'|'+$l.Port};'OK'}catch{}}";
    const nameScript = "&{$ProgressPreference='SilentlyContinue';try{foreach($r in (Get-DnsClientCache -ErrorAction Stop)){$k=[string]$r.Type;if($k -eq '1' -or $k -eq '28' -or $k -eq 'A' -or $k -eq 'AAAA'){'D|'+$r.Data+'|'+$r.Entry}};'OK'}catch{}}";
    const route = {address: "", checkedAt: -Infinity, reading: null};
    const ownCalls = {
        netTraffic: readTraffic,
        netConnections: readConnections,
        netNames: readNames
    };

    function runShell(script) {
        if (!sharedShell) return Promise.resolve(null);
        return Promise.resolve(shellTools.powerShell(script)).then(text => (typeof text === "string") ? text : null, () => null);
    }

    function runNetstat(args) {
        return new Promise(resolve => {
            try {
                childProcess.execFile(netstatFile, args, {windowsHide: true, timeout: 20000, maxBuffer: 16777216}, (err, stdout) => {
                    resolve(err ? null : String(stdout));
                });
            } catch(err) {
                resolve(null);
            }
        });
    }

    function lines(text) {
        return text.split(/\r?\n/).map(line => line.trim()).filter(line => line !== "");
    }

    function canonicalAddress(text) {
        if (!net.isIPv6(text)) return text;
        try {
            return new URL("http://[" + text + "]/").hostname.slice(1, -1);
        } catch(err) {
            return text.toLowerCase();
        }
    }

    function endpoint(address, port) {
        let text = String(address).replace(/%.*$/, "");
        let number = Number(port);
        if (net.isIP(text) === 0 || !Number.isInteger(number) || number < 0 || number > 65535) return null;
        return {address: canonicalAddress(text), port: number};
    }

    function splitEndpoint(text) {
        let parts = text.match(/^\[([^\]]+)\]:(\d+)$/) || text.match(/^([^:\[\]]+):(\d+)$/);
        return parts ? endpoint(parts[1], parts[2]) : null;
    }

    function endpointKey(local, remote) {
        return local.address + "|" + local.port + "|" + remote.address + "|" + remote.port;
    }

    function isLoopback(address) {
        return /^127\./.test(address) || address === "::1";
    }

    function routeAddress() {
        if (process.platform !== "win32") return Promise.resolve("");
        if (route.reading !== null) return route.reading;
        if (Date.now() - route.checkedAt < 30000) return Promise.resolve(route.address);
        route.reading = runNetstat(["-rn"]).then(text => {
            let best = null;
            if (text !== null) lines(text).forEach(line => {
                let parts = line.match(/^0\.0\.0\.0\s+0\.0\.0\.0\s+\S+\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)$/);
                if (parts && net.isIPv4(parts[1]) && (best === null || Number(parts[2]) < best.metric)) best = {address: parts[1], metric: Number(parts[2])};
            });
            route.address = (best === null) ? "" : best.address;
            route.checkedAt = Date.now();
            route.reading = null;
            return route.address;
        });
        return route.reading;
    }

    function readTraffic() {
        return Promise.all([runShell(trafficScript), routeAddress()]).then(([text, address]) => {
            if (text === null) return null;
            let at = null;
            let list = [];
            lines(text).forEach(line => {
                let parts = line.split("|");
                if (parts[0] === "T" && parts.length === 3) {
                    let ticks = Number(parts[1]);
                    let frequency = Number(parts[2]);
                    if (Number.isFinite(ticks) && Number.isFinite(frequency) && frequency > 0) at = ticks / frequency;
                } else if (parts[0] === "N" && parts.length >= 8 && list.length < 64) {
                    let item = {
                        name: parts.slice(7).join("|").slice(0, 256),
                        type: Number(parts[1]),
                        speed: Number(parts[2]),
                        rx: Number(parts[3]),
                        tx: Number(parts[4]),
                        gateway: parts[5] === "1",
                        ipv4: parts[6].split(",").filter(value => net.isIPv4(value))
                    };
                    if (item.name !== "" && Number.isFinite(item.rx) && Number.isFinite(item.tx) && item.rx >= 0 && item.tx >= 0) list.push(item);
                }
            });
            return (at === null) ? null : {at, route: address, list};
        });
    }

    function readConnections() {
        return Promise.all([runShell(connectionScript), runNetstat(["-ano"])]).then(([text, table]) => {
            if (text === null || !lines(text).includes("OK")) return null;
            let owners = new Map();
            if (table !== null) lines(table).forEach(line => {
                let parts = line.match(/^TCP\s+(\S+)\s+(\S+)\s.*?(\d+)$/);
                if (!parts) return;
                let local = splitEndpoint(parts[1]);
                let remote = splitEndpoint(parts[2]);
                if (local && remote) owners.set(endpointKey(local, remote), Number(parts[3]));
            });
            let established = [];
            let listening = new Set();
            lines(text).forEach(line => {
                let parts = line.split("|");
                if (parts[0] === "E" && parts.length === 5 && established.length < 4096) {
                    let local = endpoint(parts[1], parts[2]);
                    let remote = endpoint(parts[3], parts[4]);
                    if (local && remote) established.push({local: local.address, localPort: local.port, remote: remote.address, remotePort: remote.port, pid: owners.get(endpointKey(local, remote)) || 0});
                } else if (parts[0] === "L" && parts.length === 3) {
                    let local = endpoint(parts[1], parts[2]);
                    if (local && !isLoopback(local.address)) listening.add(local.port);
                }
            });
            return {established, listen: listening.size, owners: table !== null};
        });
    }

    function readNames() {
        return runShell(nameScript).then(text => {
            if (text === null || !lines(text).includes("OK")) return null;
            let found = new Map();
            lines(text).forEach(line => {
                let parts = line.split("|");
                if (parts[0] !== "D" || parts.length !== 3 || found.size >= 4096) return;
                let address = parts[1].trim();
                let name = parts[2].trim().toLowerCase().replace(/\.$/, "");
                if (net.isIP(address) === 0 || name.length > 253 || !/^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/.test(name)) return;
                address = canonicalAddress(address);
                if (!found.has(address)) found.set(address, []);
                let names = found.get(address);
                if (!names.includes(name) && names.length < 8) names.push(name);
            });
            return Array.from(found.entries());
        });
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
            let own = Object.prototype.hasOwnProperty.call(ownCalls, msg.type);
            if (!own && (!Object.prototype.hasOwnProperty.call(si, msg.type) || typeof si[msg.type] !== "function")) {
                signale.warn("Unknown systeminformation function requested");
                reply(id, null);
                return;
            }
            let call = Promise.resolve(own ? ownCalls[msg.type]() : si[msg.type](msg.arg));
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
