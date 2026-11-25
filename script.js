(() => {
  "use strict";

  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ue = (window.__ue = window.__ue || { scene: "index", velocity: 0, hover: 0, pointer: { x: 0, y: 0 } });

  /* Year + local time ------------------------------------------------------ */

  $$("[data-year]").forEach((el) => (el.textContent = String(new Date().getFullYear())));

  const clocks = $$("[data-clock]");
  let fmt = null;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    });
  } catch (e) {
    fmt = null;
  }
  const tick = () => {
    if (!fmt) return;
    const parts = fmt.formatToParts(new Date());
    const get = (type) => (parts.find((p) => p.type === type) || {}).value || "";
    const h = get("hour") === "24" ? "00" : get("hour");
    clocks.forEach((el) => (el.textContent = `${h}:${get("minute")} ${get("timeZoneName")}`));
  };
  tick();
  setInterval(tick, 15000);

  /* Word splitting ---------------------------------------------------------- */

  // About statement: words brighten as it is read past.
  const statement = $("[data-scrub]");
  const scrubWords = [];
  if (statement && !reduce) {
    const text = statement.textContent.replace(/\s+/g, " ").trim();
    statement.setAttribute("aria-label", text);
    statement.textContent = "";
    text.split(" ").forEach((word, idx, arr) => {
      const s = document.createElement("span");
      s.className = "sw";
      s.setAttribute("aria-hidden", "true");
      s.textContent = word;
      statement.appendChild(s);
      if (idx < arr.length - 1) statement.appendChild(document.createTextNode(" "));
      scrubWords.push(s);
    });
  }

  /* Counters ---------------------------------------------------------------- */

  const counters = $$("[data-count]")
    .map((el) => {
      const raw = el.dataset.count;
      const m = raw.match(/^([^0-9]*)([0-9][0-9.]*)(.*)$/);
      if (!m) return null;
      return { el, raw, prefix: m[1], num: parseFloat(m[2]), dec: (m[2].split(".")[1] || "").length, suffix: m[3] };
    })
    .filter(Boolean);

  const paint = (c, v) => (c.el.textContent = `${c.prefix}${v.toFixed(c.dec)}${c.suffix}`);
  if (!reduce) counters.forEach((c) => paint(c, 0));

  const count = (scope) => {
    counters
      .filter((c) => scope.contains(c.el))
      .forEach((c, i) => {
        if (reduce) return (c.el.textContent = c.raw);
        const t0 = performance.now() + 250 + i * 110;
        const step = (now) => {
          const t = clamp((now - t0) / 1800);
          paint(c, c.num * (1 - Math.pow(1 - t, 4)));
          if (t < 1) requestAnimationFrame(step);
          else c.el.textContent = c.raw;
        };
        requestAnimationFrame(step);
      });
  };

  /* Reveal ------------------------------------------------------------------ */

  $$(".rv").forEach((el) => {
    const group = Array.from(el.parentElement.children).filter((n) => n.classList.contains("rv"));
    el.style.setProperty("--d", `${group.indexOf(el) * 80}ms`);
  });

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        if (e.target.matches(".metrics")) count(e.target);
        io.unobserve(e.target);
      });
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
  );
  $$(".rv").forEach((el) => io.observe(el));

  /* Smooth scroll ----------------------------------------------------------- */

  let lenis = null;
  if (!reduce && typeof window.Lenis === "function") {
    try {
      lenis = new window.Lenis({ lerp: 0.09, smoothWheel: true });
      lenis.on("scroll", (e) => (ue.velocity = e.velocity));
      ue.lenis = lenis;
    } catch (e) {
      lenis = null;
    }
  }
  if (!lenis && !reduce) root.style.scrollBehavior = "smooth";

  /* Menu -------------------------------------------------------------------- */

  const menu = $("#menu");
  const toggle = $(".menu-toggle");

  const setMenu = (open) => {
    if (!menu || !toggle) return;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Close" : "Menu";
    if (open) {
      menu.hidden = false;
      requestAnimationFrame(() => menu.classList.add("is-open"));
    } else if (!menu.hidden) {
      menu.classList.remove("is-open");
      setTimeout(() => {
        if (!menu.classList.contains("is-open")) menu.hidden = true;
      }, 800);
    }
    if (lenis) open ? lenis.stop() : lenis.start();
  };
  toggle?.addEventListener("click", () => setMenu(toggle.getAttribute("aria-expanded") !== "true"));
  window.addEventListener("keydown", (e) => e.key === "Escape" && setMenu(false));

  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute("href");
    if (id === "#main") return;
    const target = id === "#top" ? 0 : $(id);
    if (target === null) return;
    e.preventDefault();
    setMenu(false);
    const offset = typeof target === "number" || target.matches(".sec") ? 0 : -110;
    if (lenis) lenis.scrollTo(target, { offset, duration: 1.8, easing: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2) });
    else if (typeof target === "number") window.scrollTo({ top: 0 });
    else window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY + offset });
    history.replaceState(null, "", id === "#top" ? location.pathname : id);
  });

  /* Pointer + hover --------------------------------------------------------- */

  window.addEventListener(
    "pointermove",
    (e) => {
      ue.pointer = { x: (e.clientX / window.innerWidth) * 2 - 1, y: (e.clientY / window.innerHeight) * 2 - 1 };
    },
    { passive: true },
  );
  $$(".role, .links a, .title a, .idx-row a").forEach((el) => {
    el.addEventListener("pointerenter", () => (ue.hover = 1));
    el.addEventListener("pointerleave", () => (ue.hover = 0));
  });

  /* Chapters, scenes, theme ------------------------------------------------- */

  const chapters = $$("[data-chapter]");
  const scenes = $$("[data-scene]");
  const navLinks = $$("[data-nav]");
  const chapterNum = $("[data-chapter-num]");
  const chapterName = $("[data-chapter-name]");
  const rail = $("[data-rail]");
  const hint = $(".hint");
  let activeChapter = null;

  const at = (list, y) => {
    let found = list[0];
    for (const el of list) if (el.getBoundingClientRect().top <= y) found = el;
    return found;
  };

  const update = () => {
    const vh = window.innerHeight;
    const max = document.documentElement.scrollHeight - vh;
    rail?.style.setProperty("--progress", String(max > 0 ? clamp(window.scrollY / max) : 0));
    hint?.classList.toggle("is-gone", window.scrollY > vh * 0.2);

    const sceneEl = at(scenes, vh * 0.55);
    if (sceneEl) {
      ue.scene = sceneEl.dataset.scene;
      if (root.dataset.scene !== ue.scene) root.dataset.scene = ue.scene;
    }

    const theme = at(chapters, vh * 0.5)?.dataset.theme === "dark" ? "dark" : "light";
    if ((root.dataset.theme || "light") !== theme) root.dataset.theme = theme;

    const ch = at(chapters, vh * 0.5);
    if (ch && ch !== activeChapter) {
      activeChapter = ch;
      root.dataset.chapter = ch.dataset.chapter;
      chapterNum.textContent = ch.dataset.chapter;
      chapterName.textContent = ch.dataset.name;
      chapterName.classList.remove("is-swap");
      void chapterName.offsetWidth;
      chapterName.classList.add("is-swap");
      navLinks.forEach((a) => a.classList.toggle("is-active", a.dataset.nav === ch.id));
    }

    if (scrubWords.length) {
      const r = statement.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) {
        const p = clamp((vh * 0.85 - r.top) / (r.height + vh * 0.35));
        const n = scrubWords.length;
        scrubWords.forEach((w, i) => w.style.setProperty("--o", (0.16 + 0.84 * clamp(p * (n + 5) - i)).toFixed(3)));
      }
    }
  };

  const loop = (now) => {
    lenis?.raf(now);
    if (!lenis) ue.velocity *= 0.9;
    update();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  window.addEventListener("resize", () => window.innerWidth > 760 && setMenu(false));

  /* Ready ------------------------------------------------------------------- */

  const ready = () => {
    if (root.classList.contains("is-ready")) return;
    root.classList.add("is-ready");
    window.dispatchEvent(new Event("ue:ready"));
  };
  const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
  Promise.race([fonts, new Promise((r) => setTimeout(r, 1400))]).then(() => requestAnimationFrame(ready));

  // If the 3D module never arrives (offline CDN, no WebGL), show the static form.
  setTimeout(() => {
    if (!ue.sceneReady) root.classList.add("no-webgl");
  }, 5000);
})();
