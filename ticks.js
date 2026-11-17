"use strict";
/* Replaces the ✓ / ✓✓ text in message footers with rounded SVG ticks.
   Works on whatever app.js renders, so no changes to app.js are needed. */
(function () {
  var NS = "http://www.w3.org/2000/svg";
  var CHECK = /[\u2713\u2714\u2705]/g;
  var ONLY_CHECKS = /^[\s\u2713\u2714\u2705]+$/;

  function path(d) {
    var p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    return p;
  }

  function build(double) {
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", double ? "tick dl" : "tick");
    svg.setAttribute("width", double ? "20" : "14");
    svg.setAttribute("height", "11");
    svg.setAttribute("viewBox", double ? "0 0 20 11" : "0 0 14 11");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", double ? "Delivered" : "Sent");
    svg.appendChild(path("M1.8 5.8 5.2 9.2 12.2 1.8"));
    if (double) svg.appendChild(path("M8.6 8.4 9.2 9.2 18.2 1.8"));
    return svg;
  }

  function upgrade(el) {
    if (el.querySelector("svg.tick")) return;
    var txt = el.textContent || "";
    if (!ONLY_CHECKS.test(txt)) return;
    var n = (txt.match(CHECK) || []).length;
    if (!n) return;
    el.textContent = "";
    el.appendChild(build(n > 1));
  }

  var busy = false;
  function scan() {
    if (busy) return;
    busy = true;
    var list = document.querySelectorAll(".message-ticks");
    for (var i = 0; i < list.length; i++) upgrade(list[i]);
    busy = false;
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; scan(); });
  }

  function start() {
    scan();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
