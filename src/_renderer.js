// Disable eval()
window.eval = function () {
    throw new Error("eval() is disabled for security reasons.");
};
// Security helper :)
window._escapeHtml = text => {
    let map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => {return map[m];});
};
window._encodePathURI = uri => {
    return encodeURI(uri).replace(/#/g, "%23");
};
window._purifyCSS = str => {
    if (typeof str === "undefined") return "";
    if (typeof str !== "string") {
        str = str.toString();
    }
    return str.replace(/[<]/g, "");
};
window._delay = ms => {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    });
};

// Initiate basic error handling
window.onerror = (msg, path, line, col, error) => {
    let bootScreen = document.getElementById("boot_screen");
    if (!bootScreen) return;
    let entry = document.createElement("div");
    entry.textContent = error + " : " + msg + " ==> at " + path + " " + line + ":" + col;
    bootScreen.appendChild(entry);
};

const pathSeparator = (window.vindex.platform === "win32") ? "\\" : "/";
const settingsDir = window.vindex.userDataPath;
const themesDir = settingsDir + pathSeparator + "themes";
const keyboardsDir = settingsDir + pathSeparator + "keyboards";
const fontsDir = settingsDir + pathSeparator + "fonts";

const themeColorKeys = ["bg", "grid", "panel", "raised", "line", "strong", "text", "text2", "text3", "accent", "ink", "green", "red"];
const themeTerminalKeys = ["background", "foreground", "cursor", "cursorAccent", "selection", "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white", "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"];

function isHexColor(value) {
    return typeof value === "string" && /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(value);
}

function isVindexThemeData(theme) {
    if (theme === null || typeof theme !== "object") return false;
    if (theme.vindex !== 1 || typeof theme.name !== "string" || theme.name === "") return false;
    if (theme.colors === null || typeof theme.colors !== "object" || theme.terminal === null || typeof theme.terminal !== "object") return false;
    return themeColorKeys.every(key => isHexColor(theme.colors[key])) && themeTerminalKeys.every(key => isHexColor(theme.terminal[key]));
}

window._loadTheme = theme => {
    let root = document.documentElement;
    let colors = theme.colors;
    themeColorKeys.forEach(key => {
        root.style.setProperty("--vx-" + key, colors[key]);
    });

    let accent = {
        r: parseInt(colors.accent.slice(1, 3), 16),
        g: parseInt(colors.accent.slice(3, 5), 16),
        b: parseInt(colors.accent.slice(5, 7), 16)
    };
    root.style.setProperty("--color_r", String(accent.r));
    root.style.setProperty("--color_g", String(accent.g));
    root.style.setProperty("--color_b", String(accent.b));
    root.style.setProperty("--color_black", colors.bg);
    root.style.setProperty("--color_light_black", colors.panel);
    root.style.setProperty("--color_grey", colors.text3);
    root.style.setProperty("--color_red", colors.red);
    root.style.setProperty("--color_yellow", "#F2C14E");
    root.style.setProperty("--font_main", "\"Barlow Semi Condensed\"");
    root.style.setProperty("--font_main_light", "\"Barlow Semi Condensed\"");
    root.style.setProperty("--font_mono", "\"JetBrains Mono\"");

    root.classList.toggle("vx-nocursor", Boolean(window.settings.nocursorOverride || window.settings.nocursor));

    window.theme = theme;
    window.theme.r = accent.r;
    window.theme.g = accent.g;
    window.theme.b = accent.b;
};

function initGraphicalErrorHandling() {
    window.vindexErrorModals = [];
    window.onerror = (msg, path, line, col, error) => {
        let errorModal = new Modal({
            type: "error",
            title: error,
            message: `${msg}<br/>        at ${path}  ${line}:${col}`
        });
        window.vindexErrorModals.push(errorModal);

        window.vindex.log("error", `${error}: ${msg}`);
        window.vindex.log("debug", `at ${path} ${line}:${col}`);
    };
}

async function waitForFonts() {
    if (document.readyState !== "complete") {
        await new Promise(resolve => {
            let listener = () => {
                if (document.readyState === "complete") {
                    document.removeEventListener("readystatechange", listener);
                    resolve();
                }
            };
            document.addEventListener("readystatechange", listener);
        });
    }
    await document.fonts.ready;
}

// A proxy function used to add multithreading to systeminformation calls - see backend process manager @ _multithread.js
function initSystemInformationProxy() {
    window.si = new Proxy({}, {
        apply: () => {throw new Error("Cannot use sysinfo proxy directly as a function")},
        set: () => {throw new Error("Cannot set a property on the sysinfo proxy")},
        get: (target, prop, receiver) => {
            return function(...args) {
                let callback = (typeof args[args.length - 1] === "function") ? true : false;

                return new Promise((resolve, reject) => {
                    window.vindex.systeminformation(prop, ...args).then(res => {
                        if (callback) {
                            args[args.length - 1](res);
                        }
                        resolve(res);
                    });
                });
            };
        }
    });
}

// Returns the user's desired display name
async function getDisplayName() {
    let user = settings.username || null;
    if (user)
        return user;

    try {
        user = await window.vindex.getUsername();
    } catch (e) {}

    return user;
}

function shellFileName() {
    return String(window.settings.shell || "").split(/[\\/]/).pop();
}

function shellBaseName() {
    let name = shellFileName();
    let dot = name.lastIndexOf(".");
    return (dot > 0) ? name.slice(0, dot) : name;
}

function terminalFontSize() {
    return window.settings.termFontSize || 13;
}

function twoDigits(value) {
    return String(value).padStart(2, "0");
}

function showShellCwd(cwd) {
    let label = document.getElementById("vx-term-cwd");
    if (typeof cwd === "string" && cwd !== "" && !cwd.startsWith("FALLBACK |-- ")) {
        label.textContent = cwd;
        label.hidden = false;
    } else {
        label.textContent = "";
        label.hidden = true;
    }
}

function showShellSize(cols, rows) {
    document.getElementById("vx-term-size").textContent = cols + " × " + rows;
}

function showShellRenderer(renderer) {
    let webgl = renderer === "webgl";
    document.getElementById("vx-term-renderer").textContent = webgl ? "WEBGL" : "CANVAS";
    document.getElementById("vx-footer-renderer").textContent = webgl ? "WebGL" : "Canvas";
}

function wireShellTerminal(number) {
    let term = window.term[number];
    term.oncwdchange = cwd => {
        if (window.currentTerm === number) showShellCwd(cwd);
    };
    term.onsizechange = (cols, rows) => {
        if (window.currentTerm === number) showShellSize(cols, rows);
    };
}

function freeShellSlot() {
    for (let n = 1; n <= 4; n++) {
        if (window.term[n] !== null && typeof window.term[n] !== "object") return n;
    }
    return null;
}

function startClocks() {
    let local = document.getElementById("vx-clock-local");
    let utc = document.getElementById("vx-clock-utc");
    let uptime = document.getElementById("vx-uptime");
    let twelveHours = window.settings.clockHours === 12;
    let uptimeBase = null;
    let uptimeReadAt = performance.now();

    let update = () => {
        let now = new Date();
        let hours = now.getHours();
        if (twelveHours) {
            local.textContent = twoDigits(hours % 12 || 12) + ":" + twoDigits(now.getMinutes()) + ":" + twoDigits(now.getSeconds()) + ((hours < 12) ? " AM" : " PM");
        } else {
            local.textContent = twoDigits(hours) + ":" + twoDigits(now.getMinutes()) + ":" + twoDigits(now.getSeconds());
        }
        utc.textContent = twoDigits(now.getUTCHours()) + ":" + twoDigits(now.getUTCMinutes()) + ":" + twoDigits(now.getUTCSeconds());
        if (uptimeBase !== null) {
            let total = Math.floor(uptimeBase + (performance.now() - uptimeReadAt) / 1000);
            let days = Math.floor(total / 86400);
            let rest = total % 86400;
            uptime.textContent = days + "d " + twoDigits(Math.floor(rest / 3600)) + ":" + twoDigits(Math.floor(rest % 3600 / 60)) + ":" + twoDigits(rest % 60);
        }
    };

    window.vindex.getSystemUptime().then(seconds => {
        if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return;
        uptimeBase = seconds;
        uptimeReadAt = performance.now();
        update();
    }).catch(err => {
        window.vindex.log("error", "Could not read the system uptime: " + String((err && err.message) || err));
    });

    update();
    setInterval(update, 1000);
}

function startBattery() {
    if (typeof navigator.getBattery !== "function") return;
    let box = document.getElementById("vx-battery");
    let bars = document.querySelectorAll("#vx-battery-bars > .vx-battery-bar");
    let level = document.getElementById("vx-battery-level");
    let state = document.getElementById("vx-battery-state");

    let reading;
    try {
        reading = Promise.resolve(navigator.getBattery()).catch(() => null);
    } catch(err) {
        return;
    }
    let timeout = new Promise(resolve => {
        setTimeout(() => resolve(null), 1000);
    });

    Promise.race([reading, timeout]).then(battery => {
        if (!battery || typeof battery.addEventListener !== "function") return;
        let shown = false;
        let update = () => {
            let value = battery.level;
            if (typeof value !== "number" || !(value >= 0 && value <= 1)) return;
            if (!shown && (battery.charging === false || value < 1)) {
                shown = true;
                box.hidden = false;
            }
            let filled = Math.round(value * 5);
            bars.forEach((bar, i) => {
                bar.classList.toggle("vx-on", i < filled);
            });
            level.textContent = Math.round(value * 100) + "%";
            state.textContent = (battery.charging === true) ? "AC" : "BAT";
        };
        update();
        battery.addEventListener("levelchange", update);
        battery.addEventListener("chargingchange", update);
    });
}

async function initUI() {
    let settings = window.settings;

    document.getElementById("vx-version").textContent = window.vindex.appVersion || "";
    document.getElementById("vx-theme-name").textContent = window.theme.name.toUpperCase();
    document.getElementById("vx-kb-layout").textContent = settings.keyboard;
    document.getElementById("vx-term-input").textContent = "INPUT " + settings.keyboard;
    document.getElementById("vx-term-shell").textContent = shellFileName();
    document.getElementById("vx-term-badge").textContent = shellBaseName().toUpperCase();
    let chrome = navigator.userAgent.match(/Chrome\/(\d+)/);
    document.getElementById("vx-footer-versions").textContent = "Electron " + window.vindex.electronVersion + (chrome ? " · Chromium " + chrome[1] : "");
    let volume = Number.isFinite(settings.audioVolume) ? settings.audioVolume : 1;
    document.getElementById("vx-footer-sfx").textContent = (settings.audio === true) ? "SFX " + Math.round(volume * 100) + "%" : "SFX OFF";

    startClocks();
    startBattery();

    let layout = await window.vindex.readKeyboardLayout(settings.keyboard);
    if (layout === null) throw new Error("Could not load the keyboard layout " + settings.keyboard + ".");
    window.keyboard = new Keyboard({
        layout,
        container: "keyboard"
    });

    let fontSize = terminalFontSize();
    await Promise.all([
        document.fonts.load("400 " + fontSize + "px 'JetBrains Mono'"),
        document.fonts.load("700 " + fontSize + "px 'JetBrains Mono'")
    ]);

    document.getElementById("terminal0").classList.add("active");
    window.term = {
        0: new Terminal({
            role: "client",
            parentId: "terminal0",
            port: settings.port || 3000
        })
    };
    window.currentTerm = 0;
    window.shellProcess = {};

    window.term[0].onprocesschange = p => {
        window.shellProcess[0] = p;
        window.renderShellTabs();
    };
    wireShellTerminal(0);
    showShellSize(window.term[0].term.cols, window.term[0].term.rows);
    showShellRenderer(window.term[0].renderer);

    window.renderShellTabs();

    window.onmouseup = e => {
        if (window.keyboard.linkedToTerm) window.term[window.currentTerm].term.focus();
    };

    if (window.performance.navigation.type === 1) {
        window.term[window.currentTerm].resendCWD();
    }

    document.getElementById("vx-app").classList.add("vx-ready");
    requestAnimationFrame(() => {
        let active = window.term[window.currentTerm];
        active.fit();
        active.term.focus();
    });
}

function showInterfaceError(err) {
    try {
        window.vindex.log("error", "Could not build the interface: " + String((err && (err.stack || err.message)) || err));
        new Modal({
            type: "error",
            title: "Interface",
            message: window._escapeHtml(String((err && err.message) || err))
        });
    } finally {
        document.getElementById("vx-app").classList.add("vx-ready");
    }
}

window.renderShellTabs = () => {
    let nav = document.getElementById("vx-tabs");
    let newTab = document.getElementById("vx-new-tab");
    nav.querySelectorAll(".vx-tab").forEach(tab => tab.remove());

    for (let n = 0; n <= 4; n++) {
        let term = window.term[n];
        let starting = term === null;
        let open = term !== null && typeof term === "object";
        if (!starting && !open) continue;

        let active = n === window.currentTerm;
        let tab = document.createElement("button");
        tab.type = "button";
        tab.className = "vx-tab " + (starting ? "vx-tab-starting" : (active ? "vx-tab-active" : "vx-tab-open"));
        tab.setAttribute("aria-pressed", active ? "true" : "false");

        let mark = document.createElement("span");
        mark.className = "vx-tab-mark";
        mark.setAttribute("aria-hidden", "true");
        let number = document.createElement("span");
        number.className = "vx-tab-number";
        number.textContent = twoDigits(n + 1);
        let name = document.createElement("span");
        name.className = "vx-tab-name";
        name.textContent = (n === 0) ? "MAIN" : "SHELL";
        let meta = document.createElement("span");
        meta.className = "vx-tab-meta";
        meta.textContent = starting ? "starting" : (window.shellProcess[n] || shellBaseName());
        tab.append(mark, number, name, meta);

        tab.addEventListener("click", () => {
            window.focusShellTab(n);
        });
        nav.insertBefore(tab, newTab);
    }

    newTab.hidden = freeShellSlot() === null;
    newTab.onclick = () => {
        let slot = freeShellSlot();
        if (slot !== null) window.focusShellTab(slot);
    };
};

window.themeChanger = theme => {
    window.vindex.setThemeOverride(theme);
    setTimeout(() => {
        window.location.reload(true);
    }, 100);
};

window.remakeKeyboard = async layout => {
    let layoutData = await window.vindex.readKeyboardLayout(layout);
    if (layoutData === null) throw new Error(`Could not load the keyboard layout "${layout}".`);
    document.getElementById("keyboard").textContent = "";
    window.keyboard = new Keyboard({
        layout: layoutData,
        container: "keyboard"
    });
    window.vindex.setKbOverride(layout);
    document.getElementById("vx-kb-layout").textContent = layout;
    document.getElementById("vx-term-input").textContent = "INPUT " + layout;
};

function failShellTab(number) {
    delete window.term[number];
    window.renderShellTabs();
    new Modal({
        type: "warning",
        title: "Terminal",
        message: "Could not open a new terminal tab."
    });
}

function closeShellTab(number) {
    let wasActive = window.currentTerm === number;
    document.getElementById("terminal"+number).textContent = "";
    window.term[number].term.dispose();
    delete window.term[number];
    delete window.shellProcess[number];
    window.renderShellTabs();
    if (!wasActive) return;
    for (let n = number - 1; n >= 0; n--) {
        if (window.term[n]) {
            window.focusShellTab(n);
            return;
        }
    }
}

function openShellTab(number, port) {
    let term;
    try {
        term = new Terminal({
            role: "client",
            parentId: "terminal"+number,
            port
        });
    } catch(err) {
        window.vindex.log("error", `Could not start terminal tab ${number+1}: ` + String((err && err.message) || err));
        failShellTab(number);
        return;
    }
    window.term[number] = term;
    term.onclose = () => {
        closeShellTab(number);
    };
    term.onprocesschange = p => {
        window.shellProcess[number] = p;
        window.renderShellTabs();
    };
    wireShellTerminal(number);
    window.renderShellTabs();
    setTimeout(() => {
        window.focusShellTab(number);
    }, 500);
}

window.focusShellTab = number => {
    window.audioManager.folder.play();

    if (number !== window.currentTerm && window.term[number]) {
        window.currentTerm = number;

        for (let n = 0; n <= 4; n++) {
            document.getElementById("terminal"+n).classList.toggle("active", n === number);
        }

        let term = window.term[number];
        term.fit();
        term.term.focus();
        term.resendCWD();
        showShellSize(term.term.cols, term.term.rows);
        showShellRenderer(term.renderer);

        if (window.fsDisp) window.fsDisp.followTab();
        window.renderShellTabs();
    } else if (number > 0 && number <= 4 && window.term[number] !== null && typeof window.term[number] !== "object") {
        window.term[number] = null;
        window.renderShellTabs();

        window.vindex.ttySpawn().then(r => {
            if (typeof r === "string" && r.startsWith("SUCCESS")) {
                openShellTab(number, Number(r.substr(9)));
            } else {
                failShellTab(number);
            }
        }, () => {
            failShellTab(number);
        });
    }
};

// Settings editor
window.openSettings = async () => {
    if (document.getElementById("settingsEditor")) return;

    // Build lists of available keyboards, themes, monitors
    let keyboards, themes, monitors, ifaces;
    let keyboardLayouts = await window.vindex.listKeyboardLayouts();
    keyboardLayouts.forEach(kb => {
        if (kb === window.settings.keyboard) return;
        keyboards += `<option>${kb}</option>`;
    });
    let themeNames = await window.vindex.listThemes();
    themeNames.forEach(th => {
        if (th === window.settings.theme) return;
        themes += `<option>${th}</option>`;
    });
    let displayCount = await window.vindex.getDisplayCount();
    for (let i = 0; i < displayCount; i++) {
        if (i !== window.settings.monitor) monitors += `<option>${i}</option>`;
    }
    let nets = await window.si.networkInterfaces(false);
    if (!Array.isArray(nets)) nets = [];
    nets.forEach(net => {
        if (net.iface !== (window.settings.iface || "")) ifaces += `<option>${net.iface}</option>`;
    });

    // Unlink the tactile keyboard from the terminal emulator to allow filling in the settings fields
    window.keyboard.detach();

    new Modal({
        type: "custom",
        title: `Settings <i>(v${window.vindex.appVersion})</i>`,
        html: `<table id="settingsEditor">
                    <tr>
                        <th>Key</th>
                        <th>Description</th>
                        <th>Value</th>
                    </tr>
                    <tr>
                        <td>shell</td>
                        <td>The program to run as a terminal emulator</td>
                        <td><input type="text" id="settingsEditor-shell" value="${window.settings.shell}"></td>
                    </tr>
                    <tr>
                        <td>shellArgs</td>
                        <td>Arguments to pass to the shell</td>
                        <td><input type="text" id="settingsEditor-shellArgs" value="${window.settings.shellArgs || ''}"></td>
                    </tr>
                    <tr>
                        <td>cwd</td>
                        <td>Working Directory to start in</td>
                        <td><input type="text" id="settingsEditor-cwd" value="${window.settings.cwd}"></td>
                    </tr>
                    <tr>
                        <td>env</td>
                        <td>Custom shell environment override</td>
                        <td><input type="text" id="settingsEditor-env" value="${window.settings.env}"></td>
                    </tr>
                    <tr>
                        <td>username</td>
                        <td>Custom username to display at boot</td>
                        <td><input type="text" id="settingsEditor-username" value="${window.settings.username}"></td>
                    </tr>
                    <tr>
                        <td>keyboard</td>
                        <td>On-screen keyboard layout code</td>
                        <td><select id="settingsEditor-keyboard">
                            <option>${window.settings.keyboard}</option>
                            ${keyboards}
                        </select></td>
                    </tr>
                    <tr>
                        <td>theme</td>
                        <td>Name of the theme to load</td>
                        <td><select id="settingsEditor-theme">
                            <option>${window.settings.theme}</option>
                            ${themes}
                        </select></td>
                    </tr>
                    <tr>
                        <td>termFontSize</td>
                        <td>Size of the terminal text in pixels</td>
                        <td><input type="number" id="settingsEditor-termFontSize" value="${window.settings.termFontSize}"></td>
                    </tr>
                    <tr>
                        <td>audio</td>
                        <td>Activate audio sound effects</td>
                        <td><select id="settingsEditor-audio">
                            <option>${window.settings.audio}</option>
                            <option>${!window.settings.audio}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>audioVolume</td>
                        <td>Set default volume for sound effects (0.0 - 1.0)</td>
                        <td><input type="number" id="settingsEditor-audioVolume" value="${window.settings.audioVolume || '1.0'}"></td>
                    </tr>
                    <tr>
                        <td>disableFeedbackAudio</td>
                        <td>Disable recurring feedback sound FX (input/output, mostly)</td>
                        <td><select id="settingsEditor-disableFeedbackAudio">
                            <option>${window.settings.disableFeedbackAudio}</option>
                            <option>${!window.settings.disableFeedbackAudio}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>port</td>
                        <td>Local port to use for UI-shell connection</td>
                        <td><input type="number" id="settingsEditor-port" value="${window.settings.port}"></td>
                    </tr>
                    <tr>
                        <td>pingAddr</td>
                        <td>IPv4 address to test Internet connectivity</td>
                        <td><input type="text" id="settingsEditor-pingAddr" value="${window.settings.pingAddr || "1.1.1.1"}"></td>
                    </tr>
                    <tr>
                        <td>clockHours</td>
                        <td>Clock format (12/24 hours)</td>
                        <td><select id="settingsEditor-clockHours">
                            <option>${(window.settings.clockHours === 12) ? "12" : "24"}</option>
                            <option>${(window.settings.clockHours === 12) ? "24" : "12"}</option>
                        </select></td>
                    <tr>
                        <td>monitor</td>
                        <td>Which monitor to spawn the UI in (defaults to primary display)</td>
                        <td><select id="settingsEditor-monitor">
                            ${(typeof window.settings.monitor !== "undefined") ? "<option>"+window.settings.monitor+"</option>" : ""}
                            ${monitors}
                        </select></td>
                    </tr>
                    <tr>
                        <td>nointro</td>
                        <td>Skip the intro boot log and logo${(window.settings.nointroOverride) ? " (Currently overridden by CLI flag)" : ""}</td>
                        <td><select id="settingsEditor-nointro">
                            <option>${window.settings.nointro}</option>
                            <option>${!window.settings.nointro}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>nocursor</td>
                        <td>Hide the mouse cursor${(window.settings.nocursorOverride) ? " (Currently overridden by CLI flag)" : ""}</td>
                        <td><select id="settingsEditor-nocursor">
                            <option>${window.settings.nocursor}</option>
                            <option>${!window.settings.nocursor}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>iface</td>
                        <td>Override the interface used for network monitoring</td>
                        <td><select id="settingsEditor-iface">
                            <option>${(window.settings.iface || "")}</option>
                            ${ifaces}
                        </select></td>
                    </tr>
                    <tr>
                        <td>allowWindowed</td>
                        <td>Allow using F11 key to set the UI in windowed mode</td>
                        <td><select id="settingsEditor-allowWindowed">
                            <option>${window.settings.allowWindowed}</option>
                            <option>${!window.settings.allowWindowed}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>keepGeometry</td>
                        <td>Try to keep a 16:9 aspect ratio in windowed mode</td>
                        <td><select id="settingsEditor-keepGeometry">
                            <option>${(window.settings.keepGeometry === false) ? 'false' : 'true'}</option>
                            <option>${(window.settings.keepGeometry === false) ? 'true' : 'false'}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>excludeThreadsFromToplist</td>
                        <td>Display threads in the top processes list</td>
                        <td><select id="settingsEditor-excludeThreadsFromToplist">
                            <option>${window.settings.excludeThreadsFromToplist}</option>
                            <option>${!window.settings.excludeThreadsFromToplist}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>hideDotfiles</td>
                        <td>Hide files and directories starting with a dot in file display</td>
                        <td><select id="settingsEditor-hideDotfiles">
                            <option>${window.settings.hideDotfiles}</option>
                            <option>${!window.settings.hideDotfiles}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>fsListView</td>
                        <td>Show files in a more detailed list instead of an icon grid</td>
                        <td><select id="settingsEditor-fsListView">
                            <option>${window.settings.fsListView}</option>
                            <option>${!window.settings.fsListView}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>experimentalGlobeFeatures</td>
                        <td>Toggle experimental features for the network globe</td>
                        <td><select id="settingsEditor-experimentalGlobeFeatures">
                            <option>${window.settings.experimentalGlobeFeatures}</option>
                            <option>${!window.settings.experimentalGlobeFeatures}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>experimentalFeatures</td>
                        <td>Toggle Chrome's experimental web features (DANGEROUS)</td>
                        <td><select id="settingsEditor-experimentalFeatures">
                            <option>${window.settings.experimentalFeatures}</option>
                            <option>${!window.settings.experimentalFeatures}</option>
                        </select></td>
                    </tr>
                </table>
                <h6 id="settingsEditorStatus">Loaded values from memory</h6>
                <br>`,
        buttons: [
            {label: "Open in External Editor", action:`window.vindex.openSettingsFile();window.vindex.minimize();`},
            {label: "Save to Disk", action: "window.writeSettingsFile()"},
            {label: "Reload UI", action: "window.location.reload(true);"},
            {label: "Restart Vindex", action: "window.vindex.relaunchApp();window.vindex.quitApp();"}
        ]
    }, () => {
        // Link the keyboard back to the terminal
        window.keyboard.attach();

        // Focus back on the term
        window.term[window.currentTerm].term.focus();
    });
};

window.writeFile = async (path) => {
    let saved = await window.vindex.writeTextFile(path, document.getElementById("fileEdit").value);
    if (saved === true) {
        document.getElementById("fedit-status").innerHTML = "<i>File saved.</i>";
    } else {
        document.getElementById("fedit-status").innerHTML = "<i>Could not save the file.</i>";
    }
};

window.writeSettingsFile = async () => {
    window.settings = {
        shell: document.getElementById("settingsEditor-shell").value,
        shellArgs: document.getElementById("settingsEditor-shellArgs").value,
        cwd: document.getElementById("settingsEditor-cwd").value,
        env: document.getElementById("settingsEditor-env").value,
        username: document.getElementById("settingsEditor-username").value,
        keyboard: document.getElementById("settingsEditor-keyboard").value,
        theme: document.getElementById("settingsEditor-theme").value,
        termFontSize: Number(document.getElementById("settingsEditor-termFontSize").value),
        audio: (document.getElementById("settingsEditor-audio").value === "true"),
        audioVolume: Number(document.getElementById("settingsEditor-audioVolume").value),
        disableFeedbackAudio: (document.getElementById("settingsEditor-disableFeedbackAudio").value === "true"),
        pingAddr: document.getElementById("settingsEditor-pingAddr").value,
        clockHours: Number(document.getElementById("settingsEditor-clockHours").value),
        port: Number(document.getElementById("settingsEditor-port").value),
        monitor: Number(document.getElementById("settingsEditor-monitor").value),
        nointro: (document.getElementById("settingsEditor-nointro").value === "true"),
        nocursor: (document.getElementById("settingsEditor-nocursor").value === "true"),
        iface: document.getElementById("settingsEditor-iface").value,
        allowWindowed: (document.getElementById("settingsEditor-allowWindowed").value === "true"),
        forceFullscreen: window.settings.forceFullscreen,
        keepGeometry: (document.getElementById("settingsEditor-keepGeometry").value === "true"),
        excludeThreadsFromToplist: (document.getElementById("settingsEditor-excludeThreadsFromToplist").value === "true"),
        hideDotfiles: (document.getElementById("settingsEditor-hideDotfiles").value === "true"),
        fsListView: (document.getElementById("settingsEditor-fsListView").value === "true"),
        experimentalGlobeFeatures: (document.getElementById("settingsEditor-experimentalGlobeFeatures").value === "true"),
        experimentalFeatures: (document.getElementById("settingsEditor-experimentalFeatures").value === "true")
    };

    Object.keys(window.settings).forEach(key => {
        if (window.settings[key] === "undefined") {
            delete window.settings[key];
        }
    });

    let saved = await window.vindex.writeSettings(window.settings);
    if (saved === true) {
        document.getElementById("settingsEditorStatus").innerText = "New values written to settings.json file at "+new Date().toTimeString();
    } else {
        document.getElementById("settingsEditorStatus").innerText = "Could not write settings.json.";
    }
};

window.toggleFullScreen = async () => {
    let useFullscreen = (await window.vindex.isFullScreen() ? false : true);
    window.vindex.setFullScreen(useFullscreen);

    //Update settings
    window.lastWindowState["useFullscreen"] = useFullscreen;

    await window.vindex.saveFullscreenState(useFullscreen);
};

// Display available keyboard shortcuts and custom shortcuts helper
window.openShortcutsHelp = () => {
    if (document.getElementById("settingsEditor")) return;

    const shortcutsDefinition = {
        "COPY": "Copy selected buffer from the terminal.",
        "PASTE": "Paste system clipboard to the terminal.",
        "NEXT_TAB": "Switch to the next opened terminal tab (left to right order).",
        "PREVIOUS_TAB": "Switch to the previous opened terminal tab (right to left order).",
        "TAB_X": "Switch to terminal tab <strong>X</strong>, or create it if it hasn't been opened yet.",
        "SETTINGS": "Open the settings editor.",
        "SHORTCUTS": "List and edit available keyboard shortcuts.",
        "FUZZY_SEARCH": "Search for entries in the current working directory.",
        "FS_LIST_VIEW": "Toggle between list and grid view in the file browser.",
        "FS_DOTFILES": "Toggle hidden files and directories in the file browser.",
        "KB_PASSMODE": "Toggle the on-screen keyboard's \"Password Mode\", which allows you to safely<br>type sensitive information even if your screen might be recorded (disable visual input feedback).",
        "DEV_DEBUG": "Open Chromium Dev Tools, for debugging purposes.",
        "DEV_RELOAD": "Trigger front-end hot reload."
    };

    let appList = "";
    window.shortcuts.filter(e => e.type === "app").forEach(cut => {
        let action = (cut.action.startsWith("TAB_")) ? "TAB_X" : cut.action;

        appList += `<tr>
                        <td>${(cut.enabled) ? 'YES' : 'NO'}</td>
                        <td><input disabled type="text" maxlength=25 value="${cut.trigger}"></td>
                        <td>${shortcutsDefinition[action]}</td>
                    </tr>`;
    });

    let customList = "";
    window.shortcuts.filter(e => e.type === "shell").forEach(cut => {
        customList += `<tr>
                            <td>${(cut.enabled) ? 'YES' : 'NO'}</td>
                            <td><input disabled type="text" maxlength=25 value="${cut.trigger}"></td>
                            <td>
                                <input disabled type="text" placeholder="Run terminal command..." value="${cut.action}">
                                <input disabled type="checkbox" name="shortcutsHelpNew_Enter" ${(cut.linebreak) ? 'checked' : ''}>
                                <label for="shortcutsHelpNew_Enter">Enter</label>
                            </td>
                        </tr>`;
    });

    window.keyboard.detach();
    new Modal({
        type: "custom",
        title: `Available Keyboard Shortcuts <i>(v${window.vindex.appVersion})</i>`,
        html: `<h5>Using either the on-screen or a physical keyboard, you can use the following shortcuts:</h5>
                <details open id="shortcutsHelpAccordeon1">
                    <summary>Emulator shortcuts</summary>
                    <table class="shortcutsHelp">
                        <tr>
                            <th>Enabled</th>
                            <th>Trigger</th>
                            <th>Action</th>
                        </tr>
                        ${appList}
                    </table>
                </details>
                <br>
                <details id="shortcutsHelpAccordeon2">
                    <summary>Custom command shortcuts</summary>
                    <table class="shortcutsHelp">
                        <tr>
                            <th>Enabled</th>
                            <th>Trigger</th>
                            <th>Command</th>
                        <tr>
                       ${customList}
                    </table>
                </details>
                <br>`,
        buttons: [
            {label: "Open Shortcuts File", action:`window.vindex.openShortcutsFile();window.vindex.minimize();`},
            {label: "Reload UI", action: "window.location.reload(true);"},
        ]
    }, () => {
        window.keyboard.attach();
        window.term[window.currentTerm].term.focus();
    });

    let wrap1 = document.getElementById('shortcutsHelpAccordeon1');
    let wrap2 = document.getElementById('shortcutsHelpAccordeon2');

    wrap1.addEventListener('toggle', e => {
        wrap2.open = !wrap1.open;
    });

    wrap2.addEventListener('toggle', e => {
        wrap1.open = !wrap2.open;
    });
};

window.useAppShortcut = action => {
    switch(action) {
        case "COPY":
            window.term[window.currentTerm].clipboard.copy();
            return true;
        case "PASTE":
            window.term[window.currentTerm].clipboard.paste();
            return true;
        case "NEXT_TAB":
                if (window.term[window.currentTerm+1]) {
                    window.focusShellTab(window.currentTerm+1);
                } else if (window.term[window.currentTerm+2]) {
                    window.focusShellTab(window.currentTerm+2);
                } else if (window.term[window.currentTerm+3]) {
                    window.focusShellTab(window.currentTerm+3);
                } else if (window.term[window.currentTerm+4]) {
                    window.focusShellTab(window.currentTerm+4);
                } else {
                    window.focusShellTab(0);
                }
            return true;
        case "PREVIOUS_TAB":
                let i = window.currentTerm || 4;
                if (window.term[i] && i !== window.currentTerm) {
                    window.focusShellTab(i);
                } else if (window.term[i-1]) {
                    window.focusShellTab(i-1);
                } else if (window.term[i-2]) {
                    window.focusShellTab(i-2);
                } else if (window.term[i-3]) {
                    window.focusShellTab(i-3);
                } else if (window.term[i-4]) {
                    window.focusShellTab(i-4);
                }
            return true;
        case "TAB_1":
            window.focusShellTab(0);
            return true;
        case "TAB_2":
            window.focusShellTab(1);
            return true;
        case "TAB_3":
            window.focusShellTab(2);
            return true;
        case "TAB_4":
            window.focusShellTab(3);
            return true;
        case "TAB_5":
            window.focusShellTab(4);
            return true;
        case "SETTINGS":
            window.openSettings();
            return true;
        case "SHORTCUTS":
            window.openShortcutsHelp();
            return true;
        case "FUZZY_SEARCH":
            if (!window.fsDisp) return false;
            window.activeFuzzyFinder = new FuzzyFinder();
            return true;
        case "FS_LIST_VIEW":
            if (!window.fsDisp) return false;
            window.fsDisp.toggleListview();
            return true;
        case "FS_DOTFILES":
            if (!window.fsDisp) return false;
            window.fsDisp.toggleHidedotfiles();
            return true;
        case "KB_PASSMODE":
            window.keyboard.togglePasswordMode();
            return true;
        case "DEV_DEBUG":
            window.vindex.toggleDevTools();
            return true;
        case "DEV_RELOAD":
            window.location.reload(true);
            return true;
        default:
            console.warn(`Unknown "${action}" app shortcut action`);
            return false;
    }
};

// Global keyboard shortcuts
window.vindex.onAppShortcut(action => {
    window.useAppShortcut(action);
});
window.vindex.onShellShortcut((action, linebreak) => {
    let fn = (linebreak) ? "writelr" : "write";
    window.term[window.currentTerm][fn](action);
});

// Prevent showing menu, exiting fullscreen or app with keyboard shortcuts
document.addEventListener("keydown", e => {
    if (e.key === "Alt") {
        e.preventDefault();
    }
    if (e.code.startsWith("Alt") && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
    }
    if (e.key === "F11" && !(window.settings && window.settings.allowWindowed)) {
        e.preventDefault();
    }
    if (e.code === "KeyD" && e.ctrlKey) {
        e.preventDefault();
    }
    if (e.code === "KeyA" && e.ctrlKey) {
        e.preventDefault();
    }
});

// Fix #265
window.addEventListener("keyup", e => {
    if (window.vindex.platform === "win32" && e.key === "F4" && e.altKey === true) {
        window.vindex.quitApp();
    }
});

// Resize terminal with window
window.onresize = () => {
    if (typeof window.currentTerm !== "undefined") {
        if (typeof window.term[window.currentTerm] !== "undefined") {
            window.term[window.currentTerm].fit();
        }
    }
};

// See #413
window.resizeTimeout = null;
window.vindex.onResize(() => {
    if (!window.settings || window.settings.keepGeometry === false) return;
    clearTimeout(window.resizeTimeout);
    window.resizeTimeout = setTimeout(async () => {
        if (await window.vindex.isFullScreen()) return false;
        if (await window.vindex.isMaximized()) {
            window.vindex.unmaximize();
            window.vindex.setFullScreen(true);
            return false;
        }

        let size = await window.vindex.getSize();

        if (size[0] >= size[1]) {
            window.vindex.setSize(size[0], parseInt(size[0] * 9 / 16));
        } else {
            window.vindex.setSize(size[1], parseInt(size[1] * 9 / 16));
        }
    }, 100);
});

window.vindex.onLeaveFullScreen(() => {
    window.vindex.setSize(960, 540);
});

async function startup() {
    try {
        let config = await window.vindex.readConfig();
        if (config === null) throw new Error("Could not load settings.json, shortcuts.json or lastWindowState.json.");
        window.settings = config.settings;
        window.shortcuts = config.shortcuts;
        window.lastWindowState = config.lastWindowState;

        if (window.vindex.nointro) {
            window.settings.nointroOverride = true;
        } else {
            window.settings.nointroOverride = false;
        }
        if (window.vindex.nocursor) {
            window.settings.nocursorOverride = true;
        } else {
            window.settings.nocursorOverride = false;
        }

        let skipIntro = (window.settings.nointro || window.settings.nointroOverride);

        let theme = await window.vindex.getThemeOverride();
        if (theme !== null) {
            window.settings.theme = theme;
            window.settings.nointroOverride = true;
        }
        let themeData = (typeof window.settings.theme === "string") ? await window.vindex.readTheme(window.settings.theme) : null;
        if (!isVindexThemeData(themeData)) {
            themeData = await window.vindex.readTheme("signal");
            window.settings.theme = "signal";
            if (!isVindexThemeData(themeData)) throw new Error("Could not load the theme.");
        }
        _loadTheme(themeData);

        let layout = await window.vindex.getKbOverride();
        if (layout !== null) {
            window.settings.keyboard = layout;
            window.settings.nointroOverride = true;
        }

        window.audioManager = new AudioManager();
        window.vindex.focusApp();

        if (skipIntro) {
            initGraphicalErrorHandling();
            initSystemInformationProxy();
            document.getElementById("boot_screen").remove();
            document.body.setAttribute("class", "");
            waitForFonts().then(initUI).catch(showInterfaceError);
        } else {
            initSystemInformationProxy();
            await new BootScreen({container: document.getElementById("boot_screen"), settings: window.settings}).run();
            initGraphicalErrorHandling();
            document.body.setAttribute("class", "");
            waitForFonts().then(initUI).catch(showInterfaceError);
        }
    } catch(error) {
        let bootScreen = document.getElementById("boot_screen");
        if (bootScreen) bootScreen.innerHTML += window._escapeHtml(String((error && error.message) || error));
    }
}

startup();
