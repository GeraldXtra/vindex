const {contextBridge, ipcRenderer, webFrame} = require("electron");

const logLevels = ["error", "debug", "note", "info"];

function readArgument(name) {
    let prefix = `--vindex-${name}=`;
    let matches = process.argv.filter(arg => typeof arg === "string" && arg.startsWith(prefix));
    if (matches.length === 0) return null;
    try {
        return decodeURIComponent(matches[matches.length - 1].slice(prefix.length));
    } catch(e) {
        return null;
    }
}

function requireValid(condition, message) {
    if (!condition) throw new TypeError(message);
}

function isDigits(value) {
    return typeof value === "string" && /^[0-9]+$/.test(value);
}

function isWindowSize(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function terminalChannel(port) {
    requireValid(Number.isSafeInteger(port) && port >= 0, "Terminal port must be a whole number");
    return "terminal_channel-"+port;
}

function listen(channel, callback) {
    requireValid(typeof callback === "function", "Callback must be a function");
    let listener = (e, ...args) => {
        callback(...args);
    };
    ipcRenderer.on(channel, listener);
    return () => {
        ipcRenderer.removeListener(channel, listener);
    };
}

const vindex = Object.freeze({
    userDataPath: readArgument("userdata"),
    appVersion: readArgument("version"),
    nointro: readArgument("nointro") === "true",
    nocursor: readArgument("nocursor") === "true",
    log: (level, message) => {
        requireValid(logLevels.includes(level), "Unknown log level");
        requireValid(typeof message === "string", "Log message must be a string");
        ipcRenderer.send("log", level, message);
    },
    systeminformation: (name, ...args) => {
        requireValid(typeof name === "string", "systeminformation function name must be a string");
        return ipcRenderer.invoke("systeminformation-call", name, ...args);
    },
    getThemeOverride: () => {
        return ipcRenderer.invoke("getThemeOverride");
    },
    setThemeOverride: theme => {
        requireValid(typeof theme === "string", "Theme name must be a string");
        ipcRenderer.send("setThemeOverride", theme);
    },
    getKbOverride: () => {
        return ipcRenderer.invoke("getKbOverride");
    },
    setKbOverride: layout => {
        requireValid(typeof layout === "string", "Keyboard layout name must be a string");
        ipcRenderer.send("setKbOverride", layout);
    },
    ttySpawn: () => {
        return ipcRenderer.invoke("ttyspawn", "true");
    },
    terminalStartup: port => {
        ipcRenderer.send(terminalChannel(port), "Renderer startup");
    },
    terminalWrite: (port, data) => {
        let channel = terminalChannel(port);
        requireValid(typeof data === "string", "Terminal data must be a string");
        ipcRenderer.send(channel, "Data", data);
    },
    terminalWriteBinary: (port, data) => {
        let channel = terminalChannel(port);
        requireValid(data instanceof Uint8Array, "Terminal binary data must be a Uint8Array");
        ipcRenderer.send(channel, "Binary", data);
    },
    terminalResize: (port, cols, rows) => {
        let channel = terminalChannel(port);
        requireValid(isDigits(cols) && isDigits(rows), "Terminal size must be made of digits");
        ipcRenderer.send(channel, "Resize", cols, rows);
    },
    onTerminalMessage: (port, callback) => {
        return listen(terminalChannel(port), callback);
    },
    readClipboardText: () => {
        return ipcRenderer.invoke("clipboard-read-text");
    },
    getDisplayCount: () => {
        return ipcRenderer.invoke("screen-display-count");
    },
    focusApp: () => {
        ipcRenderer.send("app-focus");
    },
    relaunchApp: () => {
        ipcRenderer.send("app-relaunch");
    },
    quitApp: () => {
        ipcRenderer.send("app-quit");
    },
    openPath: target => {
        requireValid(typeof target === "string", "Path must be a string");
        ipcRenderer.send("shell-open-path", target);
    },
    openSettingsFile: () => {
        ipcRenderer.send("shell-open-config", "settings.json");
    },
    openShortcutsFile: () => {
        ipcRenderer.send("shell-open-config", "shortcuts.json");
    },
    openExternal: link => {
        requireValid(typeof link === "string", "Link must be a string");
        ipcRenderer.send("shell-open-external", link);
    },
    minimize: () => {
        ipcRenderer.send("window-minimize");
    },
    isFullScreen: () => {
        return ipcRenderer.invoke("window-is-fullscreen");
    },
    setFullScreen: flag => {
        requireValid(typeof flag === "boolean", "Fullscreen flag must be a boolean");
        ipcRenderer.send("window-set-fullscreen", flag);
    },
    isMaximized: () => {
        return ipcRenderer.invoke("window-is-maximized");
    },
    unmaximize: () => {
        ipcRenderer.send("window-unmaximize");
    },
    getSize: () => {
        return ipcRenderer.invoke("window-get-size");
    },
    setSize: (width, height) => {
        requireValid(isWindowSize(width) && isWindowSize(height), "Window size must be made of positive whole numbers");
        ipcRenderer.send("window-set-size", width, height);
    },
    toggleDevTools: () => {
        ipcRenderer.send("window-toggle-devtools");
    },
    onResize: callback => {
        return listen("window-resize", callback);
    },
    onLeaveFullScreen: callback => {
        return listen("window-leave-full-screen", callback);
    },
    onAppShortcut: callback => {
        return listen("shortcut-app", callback);
    },
    onShellShortcut: callback => {
        return listen("shortcut-shell", callback);
    }
});

try {
    contextBridge.exposeInMainWorld("vindex", vindex);
} catch(e) {
    window.vindex = vindex;
}

webFrame.setVisualZoomLevelLimits(1, 1);
