/*!
 * WVNCP bio page  https://github.com/joshdodd/wvncp-directory
 * Turns a Biography Directory blog post into the approved bio layout. Loaded through the blog's
 * Post Blog Item Code Injection. Reads the post's "Bio details" paragraph (Label: value lines),
 * builds the header and service record, turns "Photo" links into styled figures, and adds
 * related-bio tags, the PDF button and Back to Biography Directory links.
 * Squarespace hooks (Custom Code Specification): data-sqsp-section="blog-item",
 * data-sqsp-text-block-content. Without JavaScript the post still reads as plain text.
 */
(function () {
  "use strict";

  var STORE_KEY = "wvncp:directoryUrl";
  var LABELS = { "Air Force": "Air Force (or Army Air Corps)", "Coast Guard": "Coast Guard / Merchant Marine" };
  var SERVICE = {
    "Army": "U.S. Army", "Navy": "U.S. Navy", "Marine Corps": "U.S. Marine Corps",
    "Coast Guard": "U.S. Coast Guard", "Air Force": "U.S. Army Air Corps / Air Force"
  };
  var DETAIL_KEYS = ["Years", "Branch", "Conflict", "Cemetery", "Rank", "Written by", "School", "Instructed by",
    "Section", "Site", "Grave", "Interment date", "PDF"];
  var PHOTO_RE = /^\s*Photo(\s*\(beside text\))?\s*$/i;

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v; // static strings only
      else n.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function vals(v) { return String(v || "").split(/\s*[,;]\s*/).filter(Boolean); }
  function lines(p) {
    var html = p.innerHTML.replace(/<br\s*\/?>/gi, "\n");
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    return { text: tmp.textContent.split("\n").map(function (s) { return s.trim(); }).filter(Boolean), node: tmp };
  }

  // ---------- Bio details ----------
  function readDetails(p) {
    var r = lines(p), d = {};
    r.text.forEach(function (line) {
      var i = line.indexOf(":");
      if (i < 1) return;
      var k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
      if (DETAIL_KEYS.indexOf(k) >= 0) d[k] = v;
    });
    var a = p.querySelector("a[href]");
    if (a && /PDF:/.test(p.textContent)) {
      // the link on the PDF line (not a photo link)
      Array.prototype.forEach.call(p.querySelectorAll("a[href]"), function (x) { if (!PHOTO_RE.test(x.textContent)) d.pdfHref = x.getAttribute("href"); });
    }
    return d;
  }
  function isDetails(p) {
    var t = (p.textContent || "").trim();
    return /^(Years|Branch|Conflict|Cemetery):/.test(t) && /\n|Branch:|Conflict:/.test(p.innerHTML.replace(/<br\s*\/?>/gi, "\n"));
  }

  // ---------- helpers for links back to the directory ----------
  function directoryPath() {
    var seg = location.pathname.split("/").filter(Boolean);
    return "/" + (seg[0] || "biography-directory");
  }
  function directoryUrl() {
    var base = directoryPath();
    try {
      var saved = sessionStorage.getItem(STORE_KEY);
      if (saved) {
        var u = new URL(saved, location.href);
        if (u.origin === location.origin && u.pathname.replace(/\/$/, "") === base) return u.pathname + u.search;
      }
    } catch (e) { /* storage off or bad URL */ }
    return base;
  }
  function facetUrl(key, v) { return directoryPath() + "?" + key + "=" + encodeURIComponent(v).replace(/%20/g, "+"); }
  function backLink(cls) {
    return el("a", { class: "wb-back " + (cls || ""), href: directoryUrl() }, [el("span", { "aria-hidden": "true", text: "← " }), "Back to Biography Directory"]);
  }

  // ---------- figures ----------
  function imgUrl(href, w) {
    if (!/squarespace-cdn\.com|static1\.squarespace\.com/.test(href)) return href;
    return href.split("?")[0] + "?format=" + w + "w";
  }
  function photoFigure(p, a, index) {
    var beside = /beside/i.test(a.textContent);
    var variant = beside ? "inset" : (index === 0 ? "lead" : "band");
    // caption = paragraph HTML after the link and its ": "
    var cap = p.cloneNode(true);
    cap.removeChild(cap.querySelector("a"));
    var capHtml = cap.innerHTML.replace(/^\s*:\s*/, "").trim();
    var tmp = el("div", { html: capHtml });
    var m = tmp.textContent.trim().match(/^.*?[.!?](?=\s|$)/);
    var alt = (m ? m[0] : tmp.textContent.trim()) || "Photograph";
    var href = a.getAttribute("href");
    var img = el("img", {
      src: imgUrl(href, beside ? 750 : 1500),
      srcset: beside ? null : imgUrl(href, 750) + " 750w, " + imgUrl(href, 1500) + " 1500w",
      sizes: beside ? null : "(max-width: 960px) 100vw, 880px",
      alt: alt, loading: index === 0 ? "eager" : "lazy", decoding: "async"
    });
    var frame = el("div", { class: "wb-fig-frame" }, [el("a", { href: href, class: "wb-fig-link", "aria-label": "Open full-size photo" }, [img])]);
    var fig = el("figure", { class: "wb-fig wb-fig--" + variant });
    var capEl = capHtml ? el("figcaption", { class: "wb-cap", html: capHtml }) : null;
    if (variant === "band" && capEl) { fig.appendChild(capEl); fig.appendChild(frame); }
    else { fig.appendChild(frame); if (capEl) fig.appendChild(capEl); }
    return fig;
  }

  // ---------- build ----------
  function run() {
    var sec = document.querySelector('[data-sqsp-section="blog-item"]');
    if (!sec || sec.getAttribute("data-wb-done")) return;
    var texts = sec.querySelectorAll("[data-sqsp-text-block-content]");
    if (!texts.length) return;
    var detailsP = null;
    for (var t = 0; t < texts.length && !detailsP; t++) {
      var ps = texts[t].querySelectorAll("p");
      for (var i = 0; i < ps.length; i++) if (isDetails(ps[i])) { detailsP = ps[i]; break; }
    }
    if (!detailsP) return; // not a bio post
    sec.setAttribute("data-wb-done", "1");
    var d = readDetails(detailsP);
    var h1 = sec.querySelector("h1");
    var name = h1 ? h1.textContent.trim() : document.title;
    var branches = vals(d.Branch), conflicts = vals(d.Conflict), cems = vals(d.Cemetery);

    // header
    var years = (d.Years || "").replace(/\s*[–-]\s*/g, " – ");
    var line1 = [years, conflicts.join(" & ")].filter(Boolean).join(", ");
    var line2 = [branches.map(function (b) { return SERVICE[b] || b; }).join(" & "), (d.Rank || "").replace(/\s*;\s*/g, " / ")]
      .filter(Boolean).join(", ");
    var credits = el("div", { class: "wb-credits" });
    [["Written by", d["Written by"]], ["", d.School], ["Instructed by", d["Instructed by"]]].forEach(function (c) {
      if (!c[1]) return;
      credits.appendChild(el("p", null, c[0] ? [el("strong", { text: c[0] + " " }), c[1]] : [c[1]]));
    });
    var header = el("header", { class: "wb-header" }, [
      el("p", { class: "wb-eyebrow", text: "West Virginia National Cemeteries Project" }),
      h1 || el("h1", { text: name }),
      line1 ? el("p", { class: "wb-sub", text: line1 }) : null,
      line2 ? el("p", { class: "wb-sub", text: line2 }) : null,
      el("div", { class: "wb-rule", "aria-hidden": "true" }),
      credits.children.length ? credits : null
    ]);
    if (h1) h1.classList.add("wb-name");

    // service record
    var fields = el("dl", { class: "wb-record" });
    function field(label, content) {
      if (!content || (content.length !== undefined && !content.length)) return;
      fields.appendChild(el("div", { class: "wb-record-item" }, [el("dt", { text: label }), el("dd", null, [].concat(content))]));
    }
    function links(list, key) {
      var out = [];
      list.forEach(function (v, i) {
        if (i) out.push(", ");
        out.push(el("a", { href: facetUrl(key, v), text: LABELS[v] || v }));
      });
      return out;
    }
    field("Branch", links(branches, "branch"));
    field("Conflict", links(conflicts, "conflict"));
    field("Rank", d.Rank ? [d.Rank.replace(/\s*;\s*/g, "; ")] : null);
    var where = d.Grave || [d.Section ? "Section " + d.Section : "", d.Site ? "Site " + d.Site : ""].filter(Boolean).join(", ");
    var interment = cems.length ? [cems.join(", ")].concat(where ? [el("br"), where] : []) : (where ? [where] : null);
    if (d["Interment date"] && interment) interment = interment.concat([el("br"), d["Interment date"]]);
    field("Interment", interment);

    // body: photo links -> figures, Sources heading
    var figIndex = 0;
    Array.prototype.forEach.call(texts, function (tb) {
      Array.prototype.forEach.call(tb.querySelectorAll("p"), function (p) {
        if (p === detailsP) return;
        var a = p.firstElementChild;
        if (a && a.tagName === "A" && PHOTO_RE.test(a.textContent) && p.textContent.trim().indexOf(a.textContent.trim()) === 0) {
          p.parentNode.replaceChild(photoFigure(p, a, figIndex++), p);
        }
      });
      Array.prototype.forEach.call(tb.querySelectorAll("h1,h2,h3,h4"), function (h) {
        if (/^\s*Sources\s*$/i.test(h.textContent)) {
          h.classList.add("wb-sources-title");
          var list = h.nextElementSibling;
          if (list && /^(UL|OL)$/.test(list.tagName)) list.classList.add("wb-sources");
        }
      });
    });
    // first body paragraph: bold lead-in is authored; mark it for spacing
    detailsP.classList.add("wb-details-source");
    detailsP.setAttribute("hidden", "");

    // related + PDF box
    var tags = el("ul", { class: "wb-tags" });
    branches.forEach(function (v) { tags.appendChild(el("li", null, [el("a", { href: facetUrl("branch", v), text: LABELS[v] || v })])); });
    conflicts.forEach(function (v) { tags.appendChild(el("li", null, [el("a", { href: facetUrl("conflict", v), text: v })])); });
    cems.forEach(function (v) { tags.appendChild(el("li", null, [el("a", { href: facetUrl("cemetery", v), text: v })])); });
    var related = el("aside", { class: "wb-related", "aria-label": "Related biographies and downloads" }, [
      tags.children.length ? el("p", { class: "wb-label", text: "Find related biographies" }) : null,
      tags.children.length ? tags : null,
      d.pdfHref ? el("a", { class: "wb-btn", href: d.pdfHref, text: "Download the original PDF" }) : null
    ]);

    // assemble around the existing content
    var top = el("div", { class: "wb-topbar" }, [backLink(), d.pdfHref ? el("a", { class: "wb-pdf-link", href: d.pdfHref, text: "Download printable PDF" }) : null]);
    var titleWrap = sec.querySelector(".blog-item-top-wrapper") || (h1 && h1.parentNode);
    var content = texts[0].closest(".blog-item-content-wrapper") || texts[0].parentNode;
    var lead = el("div", { class: "wb-lead" }, [header, fields.children.length ? fields : null]);
    if (titleWrap && titleWrap.parentNode) {
      titleWrap.parentNode.insertBefore(top, titleWrap);
      titleWrap.parentNode.insertBefore(lead, titleWrap);
    } else {
      content.parentNode.insertBefore(top, content);
      content.parentNode.insertBefore(lead, content);
    }
    var bottom = el("div", { class: "wb-bottom" }, [related.children.length ? related : null, backLink("wb-back--bottom")]);
    content.parentNode.insertBefore(bottom, content.nextSibling);
    document.documentElement.classList.add("wvncp-bio-on");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
  window.WVNCPBio = { run: run };
})();
