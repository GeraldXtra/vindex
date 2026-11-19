class Terminal {
    constructor(opts) {
        if (opts.role === "client") {
            if (!opts.parentId) throw "Missing options";

            this.xTerm = window.Terminal;
            const FitAddon = window.FitAddon.FitAddon;
            const WebglAddon = window.WebglAddon.WebglAddon;

            if (!Terminal.canvasFontTrimmed) {
                Terminal.canvasFontTrimmed = true;
                let fontProperty = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "font");
                if (fontProperty && fontProperty.get && fontProperty.set) {
                    Object.defineProperty(CanvasRenderingContext2D.prototype, "font", {
                        configurable: true,
                        enumerable: fontProperty.enumerable,
                        get: fontProperty.get,
                        set(value) {
                            fontProperty.set.call(this, (typeof value === "string") ? value.trim() : value);
                        }
                    });
                }
            }

            this.port = opts.port || 3000;
            this.cwd = "";
            this.oncwdchange = () => {};
            this.onsizechange = () => {};
            this.hookKind = null;
            this.atPrompt = false;
            this._pendingInput = false;
            this.onprompt = () => {};
            this.onuserinput = () => {};
            this.onoutput = () => {};
            this._noteInput = data => {
                if (Terminal.isTerminalReply(data)) return;
                this.atPrompt = false;
                this._pendingInput = !Terminal.isLineEnd(data);
                this.onuserinput(data);
            };

            this._sendSizeToServer = () => {
                let cols = Math.min(this.term.cols, 4000).toString();
                let rows = Math.min(this.term.rows, 2000).toString();
                while (cols.length < 3) {
                    cols = "0"+cols;
                }
                while (rows.length < 3) {
                    rows = "0"+rows;
                }
                window.vindex.terminalResize(this.port, cols, rows);
            };

            let palette = window.theme.terminal;

            this.term = new this.xTerm({
                cols: 80,
                rows: 24,
                cursorBlink: true,
                cursorStyle: "block",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: window.settings.termFontSize || 13,
                fontWeight: "normal",
                fontWeightBold: "bold",
                letterSpacing: 0,
                lineHeight: 1,
                scrollback: 1500,
                bellStyle: "none",
                theme: {
                    background: palette.background,
                    foreground: palette.foreground,
                    cursor: palette.cursor,
                    cursorAccent: palette.cursorAccent,
                    selection: palette.selection,
                    black: palette.black,
                    red: palette.red,
                    green: palette.green,
                    yellow: palette.yellow,
                    blue: palette.blue,
                    magenta: palette.magenta,
                    cyan: palette.cyan,
                    white: palette.white,
                    brightBlack: palette.brightBlack,
                    brightRed: palette.brightRed,
                    brightGreen: palette.brightGreen,
                    brightYellow: palette.brightYellow,
                    brightBlue: palette.brightBlue,
                    brightMagenta: palette.brightMagenta,
                    brightCyan: palette.brightCyan,
                    brightWhite: palette.brightWhite
                }
            });
            let fitAddon = new FitAddon();
            this.term.loadAddon(fitAddon);
            this.term.open(document.getElementById(opts.parentId));
            try {
                this.term.loadAddon(new WebglAddon());
                this.renderer = "webgl";
            } catch(err) {
                this.renderer = "canvas";
            }
            this.term.onResize(({cols, rows}) => {
                this.onsizechange(cols, rows);
            });
            // Prevent soft-keyboard on touch devices #733
            document.querySelectorAll('.xterm-helper-textarea').forEach(textarea => textarea.setAttribute('readonly', 'readonly'))
            this.term.focus();

            window.vindex.terminalStartup(this.port);
            this._ipcListener = (...args) => {
                switch(args[0]) {
                    case "Output":
                        this.term.write(args[1]);
                        this.onoutput(args[1]);

                        let d = Date.now();

                        if (d - this.lastSoundFX > 30) {
                            if(window.passwordMode == "false")
                                window.audioManager.stdout.play();
                            this.lastSoundFX = d;
                        }
                        if (d - this.lastRefit > 10000) {
                            this.fit();
                        }

                        // See #397
                        if (!window.settings.experimentalGlobeFeatures) return;
                        if (!window.mods || !window.mods.globe) return;
                        let ips = args[1].match(/((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);
                        if (ips !== null && ips.length >= 1) {
                            ips = ips.filter((val, index, self) => { return self.indexOf(val) === index; });
                            ips.forEach(ip => {
                                window.mods.globe.addTemporaryConnectedMarker(ip);
                            });
                        }
                        break;
                    case "Exit":
                        this._removeIpcListener();
                        if (this.onclose) {
                            this.onclose();
                        }
                        break;
                    case "New cwd":
                        this.cwd = args[1];
                        this.oncwdchange(this.cwd);
                        break;
                    case "Fallback cwd":
                        this.cwd = "FALLBACK |-- "+args[1];
                        this.oncwdchange(this.cwd);
                        break;
                    case "New process":
                        if (this.onprocesschange) {
                            this.onprocesschange(args[1]);
                        }
                        break;
                    case "Shell hook":
                        if (typeof args[1] !== "string") return;
                        this.hookKind = args[1];
                        if (this.cwd === "" && typeof args[2] === "string" && args[2] !== "") {
                            this.cwd = args[2];
                            this.oncwdchange(this.cwd);
                        }
                        break;
                    case "Prompt":
                        if (typeof args[1] !== "string" || typeof args[2] !== "string") return;
                        this.hookKind = args[2];
                        this.atPrompt = args[3] === true && !this._pendingInput;
                        this.onprompt(args[1]);
                        break;
                    default:
                        return;
                }
            };
            this._removeIpcListener = window.vindex.onTerminalMessage(this.port, this._ipcListener);
            this.resendCWD = () => {
                this.oncwdchange(this.cwd || null);
            };

            this.term.onData(data => {
                window.vindex.terminalWrite(this.port, data);
                this._noteInput(data);
            });
            this.term.onBinary(data => {
                let buffer = new Uint8Array(data.length);
                for (let i = 0; i < data.length; i++) {
                    buffer[i] = data.charCodeAt(i) & 255;
                }
                window.vindex.terminalWriteBinary(this.port, buffer);
                this.atPrompt = false;
                this._pendingInput = true;
            });

            this.lastSoundFX = Date.now();

            let parent = document.getElementById(opts.parentId);
            parent.addEventListener("wheel", e => {
                this.term.scrollLines(Math.round(e.deltaY/10));
            });
            this._lastTouchY = null;
            parent.addEventListener("touchstart", e => {
                this._lastTouchY = e.targetTouches[0].screenY;
            });
            parent.addEventListener("touchmove", e => {
                if (this._lastTouchY) {
                    let y = e.changedTouches[0].screenY;
                    let deltaY = y - this._lastTouchY;
                    this._lastTouchY = y;
                    this.term.scrollLines(-Math.round(deltaY/10));
                }
            });
            parent.addEventListener("touchend", e => {
                this._lastTouch = null;
            });
            parent.addEventListener("touchcancel", e => {
                this._lastTouch = null;
            });

            document.querySelector(".xterm-helper-textarea").addEventListener("keydown", e => {
                if (e.key === "F11" && window.settings.allowWindowed) {
                    e.preventDefault();
                    window.toggleFullScreen();
                }
            });

            this.fit = () => {
                this.lastRefit = Date.now();
                let dimensions = fitAddon.proposeDimensions();
                if (!dimensions) return;
                let {cols, rows} = dimensions;
                if (!(Number.isFinite(cols) && cols > 0 && Number.isFinite(rows) && rows > 0)) return;

                if (this.term.cols !== cols || this.term.rows !== rows) {
                    this.resize(cols, rows);
                }
            };

            this.resize = (cols, rows) => {
                this.term.resize(cols, rows);
                this._sendSizeToServer();
            };

            this.write = cmd => {
                window.vindex.terminalWrite(this.port, cmd);
                this._noteInput(cmd);
            };

            this.writelr = cmd => {
                window.vindex.terminalWrite(this.port, cmd+"\r");
                this._noteInput(cmd+"\r");
            };

            this.pasteText = text => {
                let clean = Terminal.cleanPaste(text);
                if (clean === "") return;
                let lines = clean.split("\n");
                let breaks = lines.length - 1;
                if (breaks === 0) {
                    this.term.paste(clean);
                    return;
                }
                let preview = lines.slice(0, 8).map(line => (line.length > 100) ? line.slice(0, 100) + "…" : line);
                if (lines.length > 8) preview.push("…");
                let done = false;
                let dialog = new Modal({
                    type: "custom",
                    title: "Paste",
                    html: `<h5>Pasting this runs ${breaks} ${(breaks === 1) ? "line" : "lines"} as soon as it lands.</h5><pre class="vx-paste-preview">${window._escapeHtml(preview.join("\n"))}</pre>`,
                    buttons: [
                        {label: "Paste", action: () => {
                            if (done) return;
                            done = true;
                            this.term.paste(clean);
                            dialog.close();
                        }}
                    ]
                }, () => {
                    done = true;
                    this.term.focus();
                });
            };

            this.clipboard = {
                copy: () => {
                    if (!this.term.hasSelection()) return false;
                    window.vindex.writeClipboardText(this.term.getSelection());
                    this.term.clearSelection();
                    this.clipboard.didCopy = true;
                },
                paste: () => {
                    window.vindex.readClipboardText().then(text => this.pasteText(text));
                    this.clipboard.didCopy = false;
                },
                didCopy: false
            };

            this.fit();

        } else if (opts.role === "server") {

            this.Pty = require("node-pty");
            this.Ipc = require("electron").ipcMain;
            const signale = require("signale");

            this.renderer = null;
            this.port = opts.port || 3000;

            this._closed = false;
            this._killed = false;
            this.onclosed = () => {};
            this.onopened = () => {};
            this.onresize = () => {};
            this.ondisconnected = () => {};

            this._promptToken = require("crypto").randomBytes(16).toString("hex");
            this._promptHook = null;
            try {
                this._promptHook = Terminal.promptHook(opts.shell, opts.params, opts.env || process.env, this._promptToken);
            } catch(err) {
                signale.warn("Could not set up folder tracking for the shell:", err);
                this._promptHook = null;
            }
            this._markHead = "\x1b]6973;" + this._promptToken + ";";
            this._markTail = "";
            this._promptPlace = null;
            this._atPrompt = false;
            this._pendingInput = false;
            this._readMarks = data => {
                let text = this._markTail + data;
                let head = this._markHead;
                let from = 0;
                let waiting = -1;
                let place = null;
                for (;;) {
                    let at = text.indexOf(head, from);
                    if (at === -1) break;
                    let start = at + head.length;
                    let bell = text.indexOf("\x07", start);
                    let st = text.indexOf("\x1b\\", start);
                    let end = (bell === -1) ? st : ((st === -1) ? bell : Math.min(bell, st));
                    if (end === -1) {
                        waiting = at;
                        break;
                    }
                    let found = text.slice(start, end);
                    if (Terminal.isPromptPlace(found)) place = found;
                    from = end + ((end === bell) ? 1 : 2);
                }
                if (waiting !== -1) {
                    this._markTail = (text.length - waiting > 70000) ? "" : text.slice(waiting);
                } else {
                    this._markTail = text.slice(Math.max(from, text.length - head.length + 1));
                }
                return place;
            };
            this._takePrompt = place => {
                this._promptPlace = place;
                this._atPrompt = !this._pendingInput;
                if (this.tty._cwd !== place) {
                    this.tty._cwd = place;
                    this._sendToRenderer("New cwd", place);
                }
                this._sendToRenderer("Prompt", place, this._promptHook.kind, this._atPrompt);
            };
            this._takeInput = data => {
                if (typeof data === "string" && Terminal.isTerminalReply(data)) return;
                this._atPrompt = false;
                this._pendingInput = !(typeof data === "string" && Terminal.isLineEnd(data));
            };

            this._disableCWDtracking = false;
            this._getTtyCWD = tty => {
                return new Promise((resolve, reject) => {
                    let pid = tty.pid;
                    switch(require("os").type()) {
                        case "Linux":
                            require("fs").readlink(`/proc/${pid}/cwd`, (e, cwd) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(cwd);
                                }
                            });
                            break;
                        case "Darwin":
                            require("child_process").exec(`lsof -a -d cwd -p ${pid} | tail -1 | awk '{ for (i=9; i<=NF; i++) printf "%s ", $i }'`, (e, cwd) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(cwd.trim());
                                }
                            });
                            break;
                        default:
                            reject("Unsupported OS");
                    }
                });
            };
            this._getTtyProcess = tty => {
                return new Promise((resolve, reject) => {
                    let pid = tty.pid;
                    switch(require("os").type()) {
                        case "Linux":
                        case "Darwin":
                            require("child_process").exec(`ps -o comm --no-headers --sort=+pid -g ${pid} | tail -1`, (e, proc) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(proc.trim());
                                }
                            });
                            break;
                        default:
                            reject("Unsupported OS");
                    }
                });
            };
            this._nextTickUpdateTtyCWD = false;
            this._nextTickUpdateProcess = false;
            this._tick = setInterval(() => {
                if (this._nextTickUpdateTtyCWD && this._disableCWDtracking === false && this._promptHook === null) {
                    this._nextTickUpdateTtyCWD = false;
                    this._getTtyCWD(this.tty).then(cwd => {
                        if (this.tty._cwd === cwd) return;
                        this.tty._cwd = cwd;
                        if (this.renderer && !this.renderer.isDestroyed()) {
                            this.renderer.send("terminal_channel-"+this.port, "New cwd", cwd);
                        }
                    }).catch(e => {
                        if (!this._closed) {
                            console.log("Error while tracking TTY working directory: ", e);
                            this._disableCWDtracking = true;
                            try {
                                this.renderer.send("terminal_channel-"+this.port, "Fallback cwd", opts.cwd || process.env.PWD);
                            } catch(e) {
                                // renderer closed
                            }
                        }
                    });
                }

                if (this.renderer && this._nextTickUpdateProcess) {
                    this._nextTickUpdateProcess = false;
                    this._getTtyProcess(this.tty).then(process => {
                        if (this.tty._process === process) return;
                        this.tty._process = process;
                        if (this.renderer && !this.renderer.isDestroyed()) {
                            this.renderer.send("terminal_channel-"+this.port, "New process", process);
                        }
                    }).catch(e => {
                        if (!this._closed) {
                            console.log("Error while retrieving TTY subprocess: ", e);
                            try {
                                this.renderer.send("terminal_channel-"+this.port, "New process", "");
                            } catch(e) {
                                // renderer closed
                            }
                        }
                    });
                }
            }, 1000);

            this.tty = this.Pty.spawn(opts.shell || "bash", (this._promptHook !== null) ? this._promptHook.args : (opts.params.length > 0 ? opts.params : (process.platform === "win32" ? [] : ["--login"])), {
                name: opts.env.TERM || "xterm-256color",
                cols: 80,
                rows: 24,
                cwd: opts.cwd || process.env.PWD,
                env: (this._promptHook !== null) ? this._promptHook.env : (opts.env || process.env)
            });
            if (this._promptHook !== null) {
                signale.info(`Folder tracking through the ${this._promptHook.kind} prompt on port ${this.port}`);
            }

            this.whenStopped = Promise.all([
                new Promise(resolve => {
                    this.tty.onExit(() => resolve());
                }),
                Terminal.outputThreadStopped(this.tty)
            ]);

            this.tty.onExit(({exitCode, signal}) => {
                this._closed = true;
                this._sendToRenderer("Exit");
                this._detach();
                this.onclosed(exitCode, signal);
            });

            this._rendererId = null;
            this._outputBuffer = [];
            this._watchedSenders = new Map();

            this._sendToRenderer = (...args) => {
                if (this.renderer !== null && !this.renderer.isDestroyed()) {
                    this.renderer.send("terminal_channel-"+this.port, ...args);
                }
            };

            this._disconnect = id => {
                if (this.renderer === null || this._rendererId !== id) return;
                this.renderer = null;
                this._rendererId = null;
                this.ondisconnected();
            };

            this._watchSender = sender => {
                let id = sender.id;
                if (this._watchedSenders.has(id)) return;
                let listeners = {
                    "did-start-navigation": e => {
                        if (e.isMainFrame && !e.isSameDocument && e.url === sender.getURL()) {
                            this._disconnect(id);
                        }
                    },
                    "render-process-gone": () => {
                        this._disconnect(id);
                    },
                    "destroyed": () => {
                        this._watchedSenders.delete(id);
                        this._disconnect(id);
                    }
                };
                Object.keys(listeners).forEach(event => {
                    sender.on(event, listeners[event]);
                });
                this._watchedSenders.set(id, {sender, listeners});
            };

            this._detach = () => {
                this.renderer = null;
                this._rendererId = null;
                this.Ipc.removeListener("terminal_channel-"+this.port, this._ipcGuard);
                this._watchedSenders.forEach(({sender, listeners}) => {
                    if (sender.isDestroyed()) return;
                    Object.keys(listeners).forEach(event => {
                        sender.removeListener(event, listeners[event]);
                    });
                });
                this._watchedSenders.clear();
            };

            this.tty.onData(data => {
                this._nextTickUpdateTtyCWD = true;
                this._nextTickUpdateProcess = true;
                if (this.renderer !== null) {
                    this._sendToRenderer("Output", data);
                } else {
                    this._outputBuffer.push(data);
                }
                if (this._promptHook !== null) {
                    let place = null;
                    try {
                        place = this._readMarks(data);
                    } catch(err) {
                        this._markTail = "";
                        signale.error("Could not read the shell's folder report:", err);
                    }
                    if (place !== null) this._takePrompt(place);
                }
            });

            this._ipcListener = (e, ...args) => {
                switch(args[0]) {
                    case "Renderer startup":
                        this.renderer = e.sender;
                        this._rendererId = e.sender.id;
                        this._watchSender(e.sender);
                        if (this._promptHook !== null) {
                            this._sendToRenderer("Shell hook", this._promptHook.kind, opts.cwd || process.env.PWD || "");
                        }
                        if (!this._disableCWDtracking && this.tty._cwd) {
                            this._sendToRenderer("New cwd", this.tty._cwd);
                        }
                        if (this._disableCWDtracking) {
                            this._sendToRenderer("Fallback cwd", opts.cwd || process.env.PWD);
                        }
                        if (this._promptHook !== null && this._promptPlace !== null) {
                            this._sendToRenderer("Prompt", this._promptPlace, this._promptHook.kind, this._atPrompt);
                        }
                        if (this._outputBuffer.length > 0) {
                            this._sendToRenderer("Output", this._outputBuffer.join(""));
                            this._outputBuffer = [];
                        }
                        this.onopened(this.tty.pid);
                        break;
                    case "Data":
                        if (this.renderer !== null && e.sender.id === this._rendererId) {
                            this.tty.write(args[1]);
                            this._takeInput(args[1]);
                        }
                        break;
                    case "Binary":
                        if (this.renderer !== null && e.sender.id === this._rendererId) {
                            this.tty.write(Buffer.from(args[1]));
                            this._takeInput(null);
                        }
                        break;
                    case "Resize":
                        let cols = args[1];
                        let rows = args[2];
                        try {
                            this.tty.resize(Number(cols), Number(rows));
                        } catch (error) {
                            //Keep going, it'll work anyways.
                        }
                        this.onresized(cols, rows);
                        break;
                    default:
                        return;
                }
            };
            this._isValidMessage = args => {
                switch(args[0]) {
                    case "Renderer startup":
                        return args.length === 1;
                    case "Data":
                        return args.length === 2 && typeof args[1] === "string";
                    case "Binary":
                        return args.length === 2 && args[1] instanceof Uint8Array;
                    case "Resize":
                        return args.length === 3 && Terminal.isSize(args[1], 4000) && Terminal.isSize(args[2], 2000);
                    default:
                        return false;
                }
            };
            this._ipcGuard = (e, ...args) => {
                try {
                    if (typeof opts.isAllowedSender !== "function" || !opts.isAllowedSender(e) || !this._isValidMessage(args)) {
                        signale.warn(`Rejected terminal_channel-${this.port} message from the window`);
                        return;
                    }
                    this._ipcListener(e, ...args);
                } catch(err) {
                    signale.error(`Could not handle terminal_channel-${this.port} message:`, err);
                }
            };
            this.Ipc.on("terminal_channel-"+this.port, this._ipcGuard);

            this.close = () => {
                this._detach();
                if (!this._killed) {
                    this._killed = true;
                    this.tty.kill();
                }
                this._closed = true;
            };
        } else {
            throw "Unknown purpose";
        }
    }

    static isTerminalReply(data) {
        return typeof data === "string" && /^(\x1b\[[IO]|\x1b\[[0-9;?>$]*[cnRty]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1bP[^\x1b]*\x1b\\)$/.test(data);
    }

    static cleanPaste(text) {
        if (typeof text !== "string") return "";
        return text.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
    }

    static isSize(value, max) {
        return typeof value === "string" && /^[0-9]{1,4}$/.test(value) && Number(value) >= 1 && Number(value) <= max;
    }

    static outputThreadStopped(pty) {
        let agent = (pty && pty._agent) ? pty._agent : null;
        let connection = (agent && agent._conoutSocketWorker) ? agent._conoutSocketWorker : null;
        let worker = (connection && connection._worker) ? connection._worker : null;
        if (worker === null || typeof worker.once !== "function") return Promise.resolve();
        return new Promise(resolve => {
            worker.once("exit", () => resolve());
        });
    }

    static isLineEnd(data) {
        return typeof data === "string" && (data.endsWith("\r") || data === "\x03");
    }

    static isPromptPlace(text) {
        return typeof text === "string" && text.length >= 3 && text.length <= 32767 && !/[\x00-\x1f\x7f]/.test(text) && /^([A-Za-z]:\\|\\\\[^\\])/.test(text);
    }

    static powershellHook(token) {
        return [
            "$global:VxPrompt=$function:prompt",
            "if(-not $global:VxPrompt){$global:VxPrompt={'PS '+$ExecutionContext.SessionState.Path.CurrentLocation+'> '}}",
            "function global:prompt{$vxText=& $global:VxPrompt;try{$vxPlace=$ExecutionContext.SessionState.Path.CurrentLocation;if($vxPlace.Provider.Name -eq 'FileSystem'){$Host.UI.Write([string][char]27+']6973;" + token + ";'+$vxPlace.ProviderPath+[string][char]7)}}catch{};$vxText}"
        ].join(";");
    }

    static promptHook(shell, params, env, token) {
        if (process.platform !== "win32") return null;
        if (params && params.length > 0) return null;
        if (typeof shell !== "string" || typeof token !== "string" || !/^[0-9a-f]{32}$/.test(token)) return null;
        let name = require("path").win32.basename(shell).toLowerCase();
        if (name === "powershell.exe" || name === "pwsh.exe") {
            return {kind: "powershell", args: ["-NoExit", "-Command", Terminal.powershellHook(token)], env};
        }
        if (name === "cmd.exe") {
            let next = Object.assign({}, env);
            let key = Object.keys(next).find(item => item.toUpperCase() === "PROMPT");
            let base = (key !== undefined && typeof next[key] === "string" && next[key] !== "") ? next[key] : "$P$G";
            if (key !== undefined) delete next[key];
            next.PROMPT = "$E]6973;" + token + ";$P$E\\" + base;
            return {kind: "cmd", args: [], env: next};
        }
        return null;
    }
}

if (typeof module !== "undefined") {
    module.exports = {
        Terminal
    };
}
