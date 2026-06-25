// VigilAgent docs site — small interactive touches, no build step.
// Types out a sample command in the hero terminal mockup, then reveals
// a canned response, looping on an interval.

(function () {
  const HERO_LINES = [
    { type: "command", text: "git diff | vigilagent" },
    { type: "output", text: "VigilAgent Security Audit" },
    { type: "dim", text: "Files scanned: 2" },
    { type: "blank" },
    { type: "redbold", text: "HIGH (3)" },
    { type: "rule", text: "  [hallucinated-package] package.json:7" },
    { type: "dim", text: "    > fastify-super-turbo-async-helper-totally-real" },
    { type: "rule", text: "  [swallowed-exception] src/payments.js:5" },
    { type: "dim", text: "    > } catch (e) {" },
    { type: "rule", text: "  [math-random-for-security-token] src/payments.js:10" },
    { type: "dim", text: "    > const token = Math.random().toString(36);" },
    { type: "blank" },
    { type: "redbold", text: "Summary: 3 finding(s) — 3 HIGH severity" },
  ];

  const el = document.getElementById("hero-typed");
  if (!el) return;

  function lineToHTML(line) {
    switch (line.type) {
      case "command":
        return `<span class="t-green">$</span> ${escapeHtml(line.text)}`;
      case "output":
        return `<span class="t-bold">${escapeHtml(line.text)}</span>`;
      case "dim":
        return `<span class="t-dim">${escapeHtml(line.text)}</span>`;
      case "redbold":
        return `<span class="t-bold t-red">${escapeHtml(line.text)}</span>`;
      case "rule":
        return escapeHtml(line.text).replace(
          /(\[[a-z0-9-]+\])/i,
          '<span class="t-red">$1</span>'
        );
      case "blank":
      default:
        return "";
    }
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  let cancelled = false;

  async function typeLine(commandText) {
    el.innerHTML = "";
    const cmdSpan = document.createElement("div");
    cmdSpan.innerHTML = '<span class="t-green">$</span> <span class="cmd-text"></span><span class="cursor-blink"></span>';
    el.appendChild(cmdSpan);
    const cmdTextEl = cmdSpan.querySelector(".cmd-text");

    for (let i = 0; i <= commandText.length; i++) {
      if (cancelled) return;
      cmdTextEl.textContent = commandText.slice(0, i);
      await sleep(28);
    }
    cmdSpan.querySelector(".cursor-blink")?.remove();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function revealOutput() {
    for (let i = 1; i < HERO_LINES.length; i++) {
      if (cancelled) return;
      const div = document.createElement("div");
      div.innerHTML = lineToHTML(HERO_LINES[i]);
      el.appendChild(div);
      await sleep(70);
    }
  }

  async function runLoop() {
    while (!cancelled) {
      await typeLine(HERO_LINES[0].text);
      await sleep(250);
      await revealOutput();
      await sleep(5000);
      if (cancelled) return;
      el.innerHTML = "";
      await sleep(600);
    }
  }

  // Respect reduced-motion preferences: just render the static final state.
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion) {
    el.innerHTML =
      '<span class="t-green">$</span> ' +
      escapeHtml(HERO_LINES[0].text) +
      "\n" +
      HERO_LINES.slice(1)
        .map((l) => lineToHTML(l))
        .join("\n");
  } else {
    runLoop();
  }

  window.addEventListener("beforeunload", () => {
    cancelled = true;
  });

  // Smooth-scroll active nav link highlighting (purely cosmetic).
  const navLinks = document.querySelectorAll(".nav-links a[href^='#']");
  const sections = Array.from(navLinks)
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);

  if (sections.length && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            navLinks.forEach((link) => {
              link.style.color = link.getAttribute("href") === `#${entry.target.id}` ? "var(--text)" : "";
            });
          }
        });
      },
      { rootMargin: "-40% 0px -50% 0px" }
    );
    sections.forEach((s) => observer.observe(s));
  }
})();
