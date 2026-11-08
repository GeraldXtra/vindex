class Netstat {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        // Create DOM
        this.parent = document.getElementById(parentId);
        this.parent.innerHTML += `<div id="mod_netstat">
            <div id="mod_netstat_inner">
                <h1>NETWORK STATUS<i id="mod_netstat_iname"></i></h1>
                <div id="mod_netstat_innercontainer">
                    <div>
                        <h1>STATE</h1>
                        <h2>UNKNOWN</h2>
                    </div>
                    <div>
                        <h1>IPv4</h1>
                        <h2>--.--.--.--</h2>
                    </div>
                    <div>
                        <h1>PING</h1>
                        <h2>--ms</h2>
                    </div>
                </div>
            </div>
        </div>`;

        this.offline = false;
        this.iface = null;
        this.runsBeforeGeoIPUpdate = 0;
        this.geoIPReady = false;
        this.publicIPLookupRunning = false;

        // Init updaters
        this.updateInfo();
        this.infoUpdater = setInterval(() => {
            this.updateInfo();
        }, 2000);

        // Init GeoIP integrated backend
        window.vindex.startGeoIP().then(ready => {
            if (ready === true) this.geoIPReady = true;
        });
    }
    updateInfo() {
        window.si.networkInterfaces(false).then(async data => {
            let offline = false;

            if (!Array.isArray(data) || data.length === 0) return;

            let net;

            if (typeof window.settings.iface === "string") {
                net = data.find(iface => iface.iface === window.settings.iface);
                if (!net) {
                    window.settings.iface = false;
                    return false;
                }
            } else {
                let usable = data.filter(iface => iface.operstate === "up" && iface.internal !== true && iface.ip4 !== "" && iface.mac !== "");
                net = usable.find(iface => iface.default === true) || usable[0];
                if (!net) {
                    this.iface = null;
                    document.getElementById("mod_netstat_iname").innerText = "Interface: (offline)";

                    this.offline = true;
                    document.querySelector("#mod_netstat_innercontainer > div:first-child > h2").innerHTML = "OFFLINE";
                    document.querySelector("#mod_netstat_innercontainer > div:nth-child(2) > h2").innerHTML = "--.--.--.--";
                    document.querySelector("#mod_netstat_innercontainer > div:nth-child(3) > h2").innerHTML = "--ms";
                    return;
                }
            }

            if (net.ip4 !== this.internalIPv4) this.runsBeforeGeoIPUpdate = 0;

            this.iface = net.iface;
            this.internalIPv4 = net.ip4;
            document.getElementById("mod_netstat_iname").innerText = "Interface: "+net.iface;

            if (net.ip4 === "127.0.0.1") {
                offline = true;
            } else {
                if (this.runsBeforeGeoIPUpdate === 0 && this.geoIPReady && !this.publicIPLookupRunning) {
                    this.publicIPLookupRunning = true;
                    this.updatePublicIP(net.ip4);
                } else if (this.runsBeforeGeoIPUpdate !== 0) {
                    this.runsBeforeGeoIPUpdate = this.runsBeforeGeoIPUpdate - 1;
                }

                let p = null;
                try {
                    p = await window.vindex.ping(window.settings.pingAddr || "1.1.1.1", net.ip4);
                } catch(e) {}
                if (p === null) offline = true;

                this.offline = offline;
                if (offline) {
                    document.querySelector("#mod_netstat_innercontainer > div:first-child > h2").innerHTML = "OFFLINE";
                    document.querySelector("#mod_netstat_innercontainer > div:nth-child(2) > h2").innerHTML = "--.--.--.--";
                    document.querySelector("#mod_netstat_innercontainer > div:nth-child(3) > h2").innerHTML = "--ms";
                } else {
                    document.querySelector("#mod_netstat_innercontainer > div:first-child > h2").innerHTML = "ONLINE";
                    document.querySelector("#mod_netstat_innercontainer > div:nth-child(3) > h2").innerHTML = Math.round(p)+"ms";
                }
            }
        });
    }
    async updatePublicIP(localAddress) {
        try {
            let result = await window.vindex.lookupPublicIP(localAddress);
            if (result !== null) {
                this.ipinfo = {
                    ip: result.ip,
                    geo: result.location
                };
                document.querySelector("#mod_netstat_innercontainer > div:nth-child(2) > h2").innerHTML = window._escapeHtml(result.ip);
                this.runsBeforeGeoIPUpdate = 10;
            }
        } finally {
            this.publicIPLookupRunning = false;
        }
    }
}
