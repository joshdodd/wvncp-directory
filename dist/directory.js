/*!
 * WVNCP Biography Directory  https://github.com/joshdodd/wvncp-directory
 * Searchable, filterable list of West Virginia National Cemeteries Project biographies
 * for a Squarespace 7.1 blog page. Mount point (in a Code Block):
 *   <div id="wvncp-directory" data-collection="/biography-directory"></div>
 * Uses only Custom Code Specification hooks on the Squarespace side
 * (data-sqsp-section="blog-list" is hidden once the directory has rendered).
 */
(function () {
  "use strict";

  var ROOT_ID = "wvncp-directory";
  var DEFAULT_DATA = "https://cdn.jsdelivr.net/gh/joshdodd/wvncp-directory@main/dist/";
  var STORE_KEY = "wvncp:directoryUrl";

  var LABELS = {
    "Air Force": "Air Force (or Army Air Corps)",
    "Coast Guard": "Coast Guard / Merchant Marine"
  };
  var GROUPS = [
    { key: "branch", field: "b", title: "Branch",
      order: ["Army", "Navy", "Marine Corps", "Air Force", "Coast Guard"] },
    { key: "conflict", field: "c", title: "Conflict",
      order: ["World War I", "World War II", "Korean War", "Vietnam War", "Persian Gulf War", "War on Terror", "Iraq War"] },
    { key: "cemetery", field: "m", title: "Cemetery",
      order: ["West Virginia National Cemetery", "Grafton National Cemetery"] }
  ];
  var SORTS = [
    { key: "name", label: "Last name, A–Z", col: "Name" },
    { key: "-name", label: "Last name, Z–A", col: "Name" },
    { key: "years", label: "Birth year, earliest", col: "Years" },
    { key: "-years", label: "Birth year, latest", col: "Years" },
    { key: "branch", label: "Branch", col: "Branch" },
    { key: "conflict", label: "Conflict", col: "Conflict" },
    { key: "cemetery", label: "Cemetery", col: "Cemetery" }
  ];

  // ---------- small helpers ----------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v; // only used with static strings
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function label(v) { return LABELS[v] || v; }
  function shortCemetery(v) { return v.replace(/\s+Cemetery$/, ""); }
  function fold(s) {
    s = String(s || "").toLowerCase();
    return s.normalize ? s.normalize("NFKD").replace(/[̀-ͯ]/g, "") : s;
  }
  function terms(q) { return fold(q).split(/[^a-z0-9]+/).filter(function (t) { return t.length > 0; }); }
  function birthYear(y) { var m = String(y || "").match(/\d{4}/); return m ? +m[0] : 9999; }
  function orderOf(group, v) { var i = group.order.indexOf(v); return i < 0 ? 100 : i; }
  var ICON_SEARCH = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="2"/><path d="m15.5 15.5 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var ICON_CHEV = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_X = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var ICON_FILTER = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  // ---------- state ----------
  function Directory(root) {
    this.root = root;
    this.base = (root.getAttribute("data-collection") || "/biography-directory").replace(/\/$/, "");
    this.data = (root.getAttribute("data-index") || DEFAULT_DATA).replace(/\/?$/, "/");
    this.bios = [];
    this.words = null;          // slug -> " word word ..." once search-index.json loads
    this.wordsLoading = null;
    this.state = { q: "", sel: { branch: [], conflict: [], cemetery: [] }, sort: "name" };
    this.uid = "wd" + Math.random().toString(36).slice(2, 7);
  }

  Directory.prototype.start = function () {
    var self = this;
    this.root.classList.add("wd");
    this.root.setAttribute("aria-busy", "true");
    fetch(this.data + "directory-index.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        self.bios = j.bios || [];
        self.readUrl();
        self.build();
        self.render();
        document.documentElement.classList.add("wvncp-dir-on"); // hides the default blog list
        self.root.removeAttribute("aria-busy");
        if (self.state.q) self.loadWords();
        else if ("requestIdleCallback" in window) requestIdleCallback(function () { self.loadWords(); });
        window.addEventListener("popstate", function () { self.readUrl(); self.syncControls(); self.render(true); });
      })
      .catch(function () {
        // Leave Squarespace's own post list visible as the fallback.
        self.root.removeAttribute("aria-busy");
        self.root.textContent = "";
      });
  };

  Directory.prototype.loadWords = function () {
    var self = this;
    if (this.words || this.wordsLoading) return this.wordsLoading;
    this.wordsLoading = fetch(this.data + "search-index.json", { cache: "no-cache" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var w = {};
        Object.keys(j.words || {}).forEach(function (s) { w[s] = " " + j.words[s]; });
        self.words = w;
        if (self.state.q) self.render(true);
      })
      .catch(function () { self.wordsLoading = null; });
    return this.wordsLoading;
  };

  // ---------- URL state ----------
  Directory.prototype.readUrl = function () {
    var p = new URLSearchParams(location.search);
    var s = this.state;
    s.q = p.get("q") || "";
    GROUPS.forEach(function (g) { s.sel[g.key] = p.getAll(g.key); });
    var sort = p.get("sort");
    s.sort = SORTS.some(function (x) { return x.key === sort; }) ? sort : "name";
  };
  Directory.prototype.writeUrl = function (push) {
    var p = new URLSearchParams();
    var s = this.state;
    if (s.q) p.set("q", s.q);
    GROUPS.forEach(function (g) { s.sel[g.key].forEach(function (v) { p.append(g.key, v); }); });
    if (s.sort !== "name") p.set("sort", s.sort);
    var qs = p.toString();
    var url = location.pathname + (qs ? "?" + qs : "") + location.hash;
    if (url !== location.pathname + location.search + location.hash) {
      history[push ? "pushState" : "replaceState"](null, "", url);
    }
    try { sessionStorage.setItem(STORE_KEY, location.href); } catch (e) { /* storage off */ }
  };

  // ---------- filtering ----------
  Directory.prototype.matchesSearch = function (b, ts) {
    if (!ts.length) return true;
    var hay = this.words && this.words[b.s];
    if (!hay) hay = " " + fold([b.n, b.y, b.b.join(" "), b.c.join(" "), b.m.join(" ")].join(" ")).replace(/[^a-z0-9]+/g, " ");
    for (var i = 0; i < ts.length; i++) if (hay.indexOf(" " + ts[i]) < 0) return false;
    return true;
  };
  Directory.prototype.matchesGroups = function (b, except) {
    var sel = this.state.sel;
    for (var i = 0; i < GROUPS.length; i++) {
      var g = GROUPS[i];
      if (g.key === except || !sel[g.key].length) continue;
      var vals = b[g.field], ok = false;
      for (var j = 0; j < sel[g.key].length; j++) if (vals.indexOf(sel[g.key][j]) >= 0) { ok = true; break; }
      if (!ok) return false;
    }
    return true;
  };
  Directory.prototype.results = function () {
    var self = this, ts = terms(this.state.q);
    var rows = this.bios.filter(function (b) { return self.matchesSearch(b, ts) && self.matchesGroups(b); });
    var key = this.state.sort.replace(/^-/, ""), dir = this.state.sort.charAt(0) === "-" ? -1 : 1;
    var g = function (k) { return GROUPS.filter(function (x) { return x.key === k; })[0]; };
    rows.sort(function (a, b) {
      var x, y;
      if (key === "years") { x = birthYear(a.y); y = birthYear(b.y); }
      else if (key === "branch" || key === "conflict") {
        var gr = g(key); x = a[gr.field].length ? orderOf(gr, a[gr.field][0]) : 999; y = b[gr.field].length ? orderOf(gr, b[gr.field][0]) : 999;
      } else if (key === "cemetery") { x = a.m[0] || "￿"; y = b.m[0] || "￿"; }
      else { x = a.k; y = b.k; }
      if (x < y) return -dir; if (x > y) return dir;
      return a.k < b.k ? -1 : a.k > b.k ? 1 : 0;
    });
    return rows;
  };
  Directory.prototype.counts = function (group) {
    var self = this, ts = terms(this.state.q), c = {};
    this.bios.forEach(function (b) {
      if (!self.matchesSearch(b, ts) || !self.matchesGroups(b, group.key)) return;
      b[group.field].forEach(function (v) { c[v] = (c[v] || 0) + 1; });
    });
    return c;
  };
  Directory.prototype.values = function (group) {
    var seen = {};
    this.bios.forEach(function (b) { b[group.field].forEach(function (v) { seen[v] = 1; }); });
    return Object.keys(seen).sort(function (a, b) { return orderOf(group, a) - orderOf(group, b) || (a < b ? -1 : 1); });
  };
  Directory.prototype.activeCount = function () {
    var s = this.state.sel; return s.branch.length + s.conflict.length + s.cemetery.length;
  };

  // ---------- building the UI ----------
  Directory.prototype.build = function () {
    var self = this, id = this.uid;
    this.root.textContent = "";

    // search + mobile controls
    this.input = el("input", { type: "search", id: id + "-q", class: "wd-input", autocomplete: "off",
      placeholder: "Search by name, hometown, unit or ship…", value: this.state.q });
    if (window.matchMedia && window.matchMedia("(max-width: 640px)").matches) this.input.placeholder = "Search names, places, units";
    this.input.addEventListener("input", function () {
      self.state.q = self.input.value;
      self.loadWords();
      clearTimeout(self._t);
      self._t = setTimeout(function () { self.render(); }, 120);
    });
    this.input.addEventListener("focus", function () { self.loadWords(); });
    this.filtersBtn = el("button", { type: "button", class: "wd-filters-btn", "aria-controls": id + "-panel", "aria-expanded": "false",
      onclick: function () { self.openDrawer(); } });
    this.sortSelect = el("select", { class: "wd-sort-select", id: id + "-sort", onchange: function () { self.setSort(this.value); } },
      SORTS.map(function (s) { return el("option", { value: s.key, text: s.label }); }));
    var search = el("div", { class: "wd-searchbar" }, [
      el("div", { class: "wd-search" }, [
        el("label", { class: "wd-sr", for: id + "-q", text: "Search biographies" }),
        el("span", { class: "wd-search-icon", html: ICON_SEARCH }),
        this.input
      ]),
      el("div", { class: "wd-mobile-controls" }, [
        this.filtersBtn,
        el("label", { class: "wd-sr", for: id + "-sort", text: "Sort" }),
        el("span", { class: "wd-select" }, [this.sortSelect, el("span", { class: "wd-select-icon", html: ICON_CHEV })])
      ])
    ]);

    // filter panel (sidebar on desktop, dropdowns on tablet, drawer on mobile)
    this.groupEls = {};
    var groups = GROUPS.map(function (g) {
      var body = el("div", { class: "wd-group-body", id: id + "-" + g.key });
      var toggle = el("button", { type: "button", class: "wd-group-toggle", "aria-expanded": "false", "aria-controls": id + "-" + g.key,
        onclick: function (e) { e.stopPropagation(); self.toggleGroup(g.key); } }, [el("span", { class: "wd-group-toggle-label", text: g.title }), el("span", { html: ICON_CHEV })]);
      var box = el("fieldset", { class: "wd-group", "data-group": g.key }, [
        el("legend", { class: "wd-sr", text: g.title }),
        toggle,
        el("div", { class: "wd-group-pop" }, [el("p", { class: "wd-group-title", "aria-hidden": "true", text: g.title }), body])
      ]);
      self.groupEls[g.key] = { box: box, body: body, toggle: toggle };
      return box;
    });
    this.clearBtn = el("button", { type: "button", class: "wd-clear", text: "Clear all", onclick: function () { self.clearAll(); } });
    this.headClear = el("button", { type: "button", class: "wd-clear wd-head-clear", text: "Clear all", onclick: function () { self.clearAll(); } });
    this.showBtn = el("button", { type: "button", class: "wd-btn wd-show", onclick: function () { self.closeDrawer(); } });
    this.panel = el("div", { class: "wd-panel", id: id + "-panel", role: "group", "aria-label": "Filter biographies" }, [
      el("div", { class: "wd-panel-head" }, [
        el("p", { class: "wd-panel-title", text: "Filter" }),
        this.headClear,
        el("button", { type: "button", class: "wd-close", "aria-label": "Close filters", html: ICON_X, onclick: function () { self.closeDrawer(); } })
      ]),
      el("div", { class: "wd-groups" }, groups),
      el("div", { class: "wd-panel-foot" }, [this.clearBtn, this.showBtn])
    ]);
    this.scrim = el("div", { class: "wd-scrim", hidden: true, onclick: function () { self.closeDrawer(); } });

    // results
    this.count = el("p", { class: "wd-count", "aria-live": "polite" });
    this.chips = el("ul", { class: "wd-chips", "aria-label": "Active filters" });
    this.thead = el("tr", null, ["Name", "Years", "Branch", "Conflict", "Cemetery"].map(function (col) {
      var b = el("button", { type: "button", class: "wd-th-btn", onclick: function () { self.toggleSortCol(col); } },
        [col, el("span", { class: "wd-sort-icon", "aria-hidden": "true" })]);
      return el("th", { scope: "col", class: "wd-c-" + col.toLowerCase(), "data-col": col }, [b]);
    }));
    this.tbody = el("tbody");
    this.table = el("table", { class: "wd-table" }, [el("caption", { class: "wd-sr", text: "Biographies" }), el("thead", null, [this.thead]), this.tbody]);
    this.empty = el("div", { class: "wd-empty", hidden: true }, [
      el("p", { text: "No biographies match your search and filters." }),
      el("button", { type: "button", class: "wd-clear", text: "Clear search and filters", onclick: function () { self.input.value = ""; self.state.q = ""; self.clearAll(); } })
    ]);
    var results = el("div", { class: "wd-results" }, [
      el("div", { class: "wd-results-head" }, [this.count, this.chips]),
      this.table, this.empty
    ]);

    this.root.appendChild(search);
    this.root.appendChild(el("div", { class: "wd-main" }, [this.panel, results]));
    this.root.appendChild(this.scrim);

    document.addEventListener("click", function (e) { if (!self.panel.contains(e.target)) self.toggleGroup(null); });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (self.root.classList.contains("wd-drawer-open")) self.closeDrawer();
      else self.toggleGroup(null);
    });
    this.syncControls();
  };

  Directory.prototype.syncControls = function () {
    this.input.value = this.state.q;
    this.sortSelect.value = this.state.sort;
  };

  Directory.prototype.renderGroups = function () {
    var self = this;
    GROUPS.forEach(function (g) {
      var counts = self.counts(g), sel = self.state.sel[g.key], body = self.groupEls[g.key].body;
      body.textContent = "";
      self.values(g).forEach(function (v) {
        var cid = self.uid + "-" + g.key + "-" + v.replace(/[^a-z0-9]+/gi, "-");
        var checked = sel.indexOf(v) >= 0, n = counts[v] || 0;
        var cb = el("input", { type: "checkbox", id: cid, class: "wd-check", value: v, checked: checked,
          onchange: function () { self.toggleValue(g.key, v, this.checked); } });
        body.appendChild(el("div", { class: "wd-option" + (n || checked ? "" : " wd-option-empty") }, [
          cb, el("label", { for: cid }, [el("span", { class: "wd-option-label", text: label(v) }), el("span", { class: "wd-option-count", text: String(n) })])
        ]));
      });
      var on = sel.length;
      self.groupEls[g.key].toggle.querySelector(".wd-group-toggle-label").textContent = g.title + (on ? " (" + on + ")" : "");
    });
    var a = this.activeCount();
    this.filtersBtn.innerHTML = ICON_FILTER;
    this.filtersBtn.appendChild(document.createTextNode(a ? "Filters (" + a + ")" : "Filters"));
    this.clearBtn.hidden = !a;
    this.headClear.disabled = !a;
  };

  Directory.prototype.renderChips = function () {
    var self = this;
    this.chips.textContent = "";
    if (this.state.q) this.chips.appendChild(this.chip("Search: “" + this.state.q + "”", function () { self.input.value = ""; self.state.q = ""; self.render(); }));
    GROUPS.forEach(function (g) {
      self.state.sel[g.key].forEach(function (v) {
        self.chips.appendChild(self.chip(label(v), function () { self.toggleValue(g.key, v, false); }));
      });
    });
  };
  Directory.prototype.chip = function (text, onRemove) {
    return el("li", null, [el("button", { type: "button", class: "wd-chip", "aria-label": "Remove filter: " + text, onclick: onRemove },
      [el("span", { text: text }), el("span", { html: ICON_X })])]);
  };

  Directory.prototype.renderRows = function (rows) {
    var self = this, frag = document.createDocumentFragment();
    rows.forEach(function (b) {
      frag.appendChild(el("tr", null, [
        el("td", { class: "wd-c-name" }, [el("a", { href: self.base + "/" + encodeURIComponent(b.s), text: b.n })]),
        el("td", { class: "wd-c-years", text: b.y }),
        el("td", { class: "wd-c-branch", text: b.b.map(label).join(", ") }),
        el("td", { class: "wd-c-conflict", "data-branch": b.b.map(label).join(", "), text: b.c.join(", ") }),
        el("td", { class: "wd-c-cemetery", text: b.m.map(shortCemetery).join(", ") })
      ]));
    });
    this.tbody.textContent = "";
    this.tbody.appendChild(frag);
  };

  Directory.prototype.renderSortHeads = function () {
    var cur = SORTS.filter(function (s) { return s.key === this.state.sort; }, this)[0];
    var dir = this.state.sort.charAt(0) === "-" ? "descending" : "ascending";
    Array.prototype.forEach.call(this.thead.children, function (th) {
      var on = cur && th.getAttribute("data-col") === cur.col;
      if (on) th.setAttribute("aria-sort", dir); else th.removeAttribute("aria-sort");
    });
  };

  Directory.prototype.render = function (fromHistory) {
    var rows = this.results();
    var total = this.bios.length, filtered = this.state.q || this.activeCount();
    this.count.textContent = filtered ? rows.length + " of " + total + " biographies" : total + " biographies";
    this.renderRows(rows);
    this.table.hidden = !rows.length;
    this.empty.hidden = !!rows.length;
    this.showBtn.textContent = "Show " + rows.length + (rows.length === 1 ? " biography" : " biographies");
    this.renderGroups();
    this.renderChips();
    this.renderSortHeads();
    if (!fromHistory) this.writeUrl(false);
    else { try { sessionStorage.setItem(STORE_KEY, location.href); } catch (e) { /* ignore */ } }
  };

  // ---------- actions ----------
  Directory.prototype.toggleValue = function (key, v, on) {
    var sel = this.state.sel[key], i = sel.indexOf(v);
    if (on && i < 0) sel.push(v);
    if (!on && i >= 0) sel.splice(i, 1);
    this.render();
  };
  Directory.prototype.clearAll = function () {
    GROUPS.forEach(function (g) { this.state.sel[g.key] = []; }, this);
    this.render();
  };
  Directory.prototype.setSort = function (key) { this.state.sort = key; this.syncControls(); this.render(); };
  Directory.prototype.toggleSortCol = function (col) {
    var asc = SORTS.filter(function (s) { return s.col === col && s.key.charAt(0) !== "-"; })[0];
    var desc = SORTS.filter(function (s) { return s.col === col && s.key.charAt(0) === "-"; })[0];
    if (this.state.sort === asc.key && desc) this.setSort(desc.key);
    else this.setSort(asc.key);
  };
  Directory.prototype.toggleGroup = function (key) {
    var self = this;
    GROUPS.forEach(function (g) {
      var open = g.key === key && !self.groupEls[g.key].box.classList.contains("wd-open");
      self.groupEls[g.key].box.classList.toggle("wd-open", open);
      self.groupEls[g.key].toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  };
  Directory.prototype.openDrawer = function () {
    this._lastFocus = document.activeElement;
    this.root.classList.add("wd-drawer-open");
    this.scrim.hidden = false;
    this.filtersBtn.setAttribute("aria-expanded", "true");
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-modal", "true");
    document.documentElement.classList.add("wd-noscroll");
    var close = this.panel.querySelector(".wd-close");
    if (close) close.focus();
  };
  Directory.prototype.closeDrawer = function () {
    if (!this.root.classList.contains("wd-drawer-open")) return;
    this.root.classList.remove("wd-drawer-open");
    this.scrim.hidden = true;
    this.filtersBtn.setAttribute("aria-expanded", "false");
    this.panel.setAttribute("role", "group");
    this.panel.removeAttribute("aria-modal");
    document.documentElement.classList.remove("wd-noscroll");
    if (this._lastFocus && this._lastFocus.focus) this._lastFocus.focus();
  };

  // ---------- boot ----------
  function boot() {
    var root = document.getElementById(ROOT_ID);
    if (!root || root.getAttribute("data-wd-started")) return;
    root.setAttribute("data-wd-started", "1");
    new Directory(root).start();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.WVNCPDirectory = { boot: boot, _Directory: Directory, _GROUPS: GROUPS };
})();
