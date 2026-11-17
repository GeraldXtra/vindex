class Explorer {
    constructor() {
        this.tree = document.getElementById("vx-files-tree");
        this.crumbs = document.getElementById("vx-files-crumbs");
        this.count = document.getElementById("vx-files-count");
        this.state = document.getElementById("vx-files-state");
        this.stateText = document.getElementById("vx-files-state-text");
        this.term = null;
        this.root = null;
        this.mode = "waiting";
        this.folders = new Map();
        this.selected = null;
        this.rowList = [];
        this.crumbList = [];
        this.hideDotfiles = window.settings.hideDotfiles === true;
        this.reads = 0;
        this.listCalls = 0;

        this.tree.addEventListener("mousedown", e => {
            if (e.button !== 0) return;
            let row = this.rowFor(e.target);
            if (!row) return;
            e.preventDefault();
            if (e.detail >= 2 && e.detail % 2 === 0) {
                this.open(row);
            } else {
                this.pick(row);
            }
        });
        this.crumbs.addEventListener("mousedown", e => {
            if (e.button !== 0) return;
            let button = e.target.closest(".vx-crumb");
            if (!button || !this.crumbs.contains(button)) return;
            e.preventDefault();
            let crumb = this.crumbList[Number(button.dataset.index)];
            if (crumb && !crumb.here) this.go(crumb.path);
        });
        new ResizeObserver(() => this.renderCrumbs()).observe(this.crumbs.parentElement);
        this.render();
    }

    static element(tag, className, text) {
        let node = document.createElement(tag);
        if (className) node.className = className;
        if (typeof text === "string") node.textContent = text;
        return node;
    }

    static icon(className, size, box, d) {
        let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", className);
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("width", String(size));
        svg.setAttribute("height", String(size));
        svg.setAttribute("viewBox", "0 0 " + box + " " + box);
        let path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
        return svg;
    }

    static isPosix(place) {
        return place.startsWith("/");
    }

    static key(place) {
        return Explorer.isPosix(place) ? place : place.toLowerCase();
    }

    static join(base, name) {
        let sep = Explorer.isPosix(base) ? "/" : "\\";
        return base.endsWith(sep) ? base + name : base + sep + name;
    }

    static baseName(place) {
        let parts = Explorer.segments(place);
        return (parts.length > 0) ? parts[parts.length - 1].name : place;
    }

    static segments(place) {
        let list = [];
        if (Explorer.isPosix(place)) {
            list.push({name: "/", path: "/"});
            let current = "";
            place.split("/").filter(part => part !== "").forEach(part => {
                current += "/" + part;
                list.push({name: part, path: current});
            });
            return list;
        }
        let rest = place;
        let base;
        let unc = /^\\\\[^\\]+\\[^\\]+/.exec(place);
        if (unc) {
            base = unc[0];
            rest = place.slice(base.length);
            list.push({name: base, path: base + "\\"});
        } else {
            base = place.slice(0, 2);
            rest = place.slice(2);
            list.push({name: base, path: base + "\\"});
        }
        let current = base;
        rest.split("\\").filter(part => part !== "").forEach(part => {
            current += "\\" + part;
            list.push({name: part, path: current});
        });
        return list;
    }

    static typeTag(item) {
        if (item.kind === "network") return "NET";
        if (item.kind === "dir") return item.link ? "LINK" : "";
        if (item.link) return "LINK";
        let name = item.name;
        if (/^(license|licence|readme|notice|authors|changelog|copying)$/i.test(name)) return "TXT";
        let dot = name.lastIndexOf(".");
        if (dot === 0) return "CFG";
        if (dot < 0 || dot === name.length - 1) return "";
        let ext = name.slice(dot + 1);
        if (!/^[A-Za-z0-9]+$/.test(ext)) return "";
        if (/^(mjs|cjs)$/i.test(ext)) return "JS";
        if (/^(htm)$/i.test(ext)) return "HTML";
        if (/^(markdown)$/i.test(ext)) return "MD";
        if (/^(yaml)$/i.test(ext)) return "YML";
        if (/^(jpeg)$/i.test(ext)) return "JPG";
        return ext.slice(0, 4).toUpperCase();
    }

    static quote(kind, place) {
        if (kind === "powershell") return "'" + place.replace(/['‘’‚‛]/g, "$&$&") + "'";
        if (kind === "cmd") return "\"" + place + "\"";
        return /\s/.test(place) ? "\"" + place + "\"" : place;
    }

    static moveCommand(kind, place) {
        if (kind === "powershell") return "Set-Location -LiteralPath " + Explorer.quote(kind, place);
        if (kind === "cmd" && !/["%!]/.test(place)) return "cd /d " + Explorer.quote(kind, place);
        return null;
    }

    static itemsText(count, more) {
        return count.toLocaleString("en-US") + (more ? "+" : "") + ((count === 1 && !more) ? " item" : " items");
    }

    follow(term) {
        this.term = term || null;
        let cwd = (term && typeof term.cwd === "string") ? term.cwd : "";
        let fallback = cwd.startsWith("FALLBACK |-- ");
        let place = fallback ? cwd.slice(13) : cwd;
        if (place === "undefined" || place === "null") place = "";
        if (place === "") {
            this.mode = "waiting";
        } else if (fallback) {
            this.mode = "start";
        } else {
            this.mode = "following";
        }
        if (place === "") {
            this.root = null;
            this.folders = new Map();
            this.selected = null;
        } else if (this.root === null || Explorer.key(place) !== Explorer.key(this.root)) {
            this.root = place;
            this.folders = new Map();
            this.selected = Explorer.key(place);
            this.folders.set(Explorer.key(place), {path: place, open: true, result: null, reading: false, again: false});
            this.read(Explorer.key(place));
        } else {
            this.refresh();
        }
        this.render();
    }

    refresh() {
        this.folders.forEach((folder, key) => {
            if (folder.open && !folder.reading) this.read(key);
        });
    }

    toggleDotfiles() {
        this.hideDotfiles = !this.hideDotfiles;
        window.settings.hideDotfiles = this.hideDotfiles;
        this.render();
    }

    read(key) {
        let folder = this.folders.get(key);
        if (!folder) return;
        if (folder.reading) {
            folder.again = true;
            return;
        }
        folder.reading = true;
        folder.again = false;
        let folders = this.folders;
        this.reads++;
        Promise.resolve().then(() => {
            if (folder.path.startsWith("\\\\")) return {error: "NETWORK FOLDER · NOT LISTED"};
            this.listCalls++;
            return window.vindex.listFolder(folder.path);
        }).then(result => {
            folder.result = (result && typeof result === "object") ? result : {error: "UNREADABLE"};
        }, () => {
            folder.result = {error: "UNREADABLE"};
        }).then(() => {
            folder.reading = false;
            if (this.folders !== folders) return;
            if (folder.again) {
                this.read(key);
            }
            this.render();
        });
    }

    visible(items) {
        if (!Array.isArray(items)) return [];
        return items.filter(item => item && typeof item.name === "string" && item.name !== "" && !(this.hideDotfiles && item.name.startsWith(".")));
    }

    rows() {
        let list = [];
        if (this.root === null) return list;
        let rootKey = Explorer.key(this.root);
        let rootFolder = this.folders.get(rootKey);
        list.push({key: rootKey, path: this.root, name: Explorer.baseName(this.root), level: 0, dir: true, open: Boolean(rootFolder && rootFolder.open), tag: "", root: true});
        let walk = (folder, level) => {
            if (!folder || !folder.open) return;
            let result = folder.result;
            if (!result) return;
            if (result.error) {
                list.push({note: result.error, level});
                return;
            }
            let items = this.visible(result.items);
            if (items.length === 0 && !result.truncated) {
                list.push({note: "EMPTY", level});
                return;
            }
            items.forEach(item => {
                let path = Explorer.join(folder.path, item.name);
                let key = Explorer.key(path);
                let dir = item.kind === "dir";
                let child = dir ? this.folders.get(key) : null;
                list.push({key, path, name: item.name, level, dir, open: Boolean(child && child.open), tag: Explorer.typeTag(item), root: false});
                if (dir && child) walk(child, level + 1);
            });
            if (result.truncated && Number.isFinite(result.total)) {
                list.push({note: "+ " + (result.total - result.items.length).toLocaleString("en-US") + " MORE", level});
            }
        };
        walk(rootFolder, 1);
        return list;
    }

    render() {
        this.renderState();
        this.renderCrumbs();
        this.renderTree();
    }

    renderState() {
        let following = this.mode === "following";
        this.state.classList.toggle("vx-on", following);
        this.stateText.textContent = following ? "FOLLOWING 04" : ((this.mode === "start") ? "START FOLDER" : "WAITING");
        let rootFolder = (this.root === null) ? null : this.folders.get(Explorer.key(this.root));
        let result = rootFolder ? rootFolder.result : null;
        if (result && !result.error && Array.isArray(result.items)) {
            this.count.textContent = Explorer.itemsText(this.visible(result.items).length, result.truncated === true);
        } else {
            this.count.textContent = "";
        }
    }

    renderCrumbs() {
        this.crumbs.textContent = "";
        this.crumbList = (this.root === null) ? [] : Explorer.segments(this.root);
        this.crumbList.forEach((crumb, i) => {
            crumb.here = i === this.crumbList.length - 1;
            if (i > 0) this.crumbs.appendChild(Explorer.element("span", "vx-crumb-sep", "›"));
            let button = Explorer.element("button", "vx-crumb" + (crumb.here ? " vx-crumb-here" : ""), crumb.name);
            button.type = "button";
            button.tabIndex = -1;
            button.dataset.index = String(i);
            this.crumbs.appendChild(button);
        });
        let hidden = 0;
        while (this.crumbs.scrollWidth > this.crumbs.clientWidth + 1 && hidden < this.crumbList.length - 1) {
            let first = this.crumbs.querySelector(".vx-crumb:not(.vx-crumb-gone)");
            if (!first) break;
            first.classList.add("vx-crumb-gone");
            hidden++;
            if (hidden === 1) {
                first.nextElementSibling.before(Explorer.element("span", "vx-crumb-sep vx-crumb-more", "…"));
            } else {
                let sep = first.nextElementSibling;
                if (sep && sep.classList.contains("vx-crumb-sep")) sep.classList.add("vx-crumb-gone");
            }
        }
    }

    renderTree() {
        let top = this.tree.scrollTop;
        this.rowList = this.rows();
        let fragment = document.createDocumentFragment();
        this.rowList.forEach((row, i) => {
            if (row.note) {
                let note = Explorer.element("div", "vx-file-note", row.note);
                note.style.paddingLeft = (8 + row.level * 12) + "px";
                fragment.appendChild(note);
                return;
            }
            let button = Explorer.element("button", "vx-file-row" + (row.dir ? " vx-dir" : "") + ((row.key === this.selected) ? " vx-selected" : ""));
            button.type = "button";
            button.tabIndex = -1;
            button.dataset.index = String(i);
            button.style.paddingLeft = (8 + row.level * 12) + "px";
            button.title = row.path;
            let chevron = Explorer.element("span", "vx-file-chev");
            if (row.dir) chevron.appendChild(Explorer.icon("vx-file-chev-icon", 10, 10, row.open ? "M2 3.5l3 3 3-3" : "M3.5 2l3 3-3 3"));
            button.appendChild(chevron);
            button.appendChild(Explorer.icon("vx-file-icon", 13, 14, row.dir ? "M1.5 3.5h4l1.5 1.5h5.5v6.5h-11z" : "M3.5 1.5h4.5l2.5 2.5v8.5h-7zM8 1.5v2.5h2.5"));
            button.appendChild(Explorer.element("span", "vx-file-name", row.name));
            button.appendChild(Explorer.element("span", "vx-file-type", row.tag));
            fragment.appendChild(button);
        });
        this.tree.textContent = "";
        if (this.root === null) {
            this.tree.appendChild(Explorer.element("div", "vx-file-note vx-file-wait", "WAITING FOR THE SHELL"));
        } else {
            this.tree.appendChild(fragment);
        }
        this.tree.scrollTop = top;
    }

    rowFor(target) {
        let button = target.closest(".vx-file-row");
        if (!button || !this.tree.contains(button)) return null;
        return this.rowList[Number(button.dataset.index)] || null;
    }

    pick(row) {
        this.selected = row.key;
        if (row.dir) {
            let folder = this.folders.get(row.key);
            if (folder && folder.open) {
                folder.open = false;
            } else if (folder) {
                folder.open = true;
                this.read(row.key);
            } else {
                this.folders.set(row.key, {path: row.path, open: true, result: null, reading: false, again: false});
                this.read(row.key);
            }
        }
        this.render();
    }

    open(row) {
        if (row.root) {
            this.pick(row);
            return;
        }
        if (row.dir) {
            this.go(row.path);
        } else {
            this.type(row.path);
        }
    }

    go(place) {
        let term = this.term;
        if (!term) return;
        let command = (term.hookKind && term.atPrompt) ? Explorer.moveCommand(term.hookKind, place) : null;
        if (command !== null) {
            term.writelr(command);
            term.term.focus();
        } else {
            this.type(place);
        }
    }

    type(place) {
        let term = this.term;
        if (!term) return;
        term.term.paste(Explorer.quote(term.hookKind, place));
        term.term.focus();
    }
}
