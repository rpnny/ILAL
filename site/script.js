/* ─── ILAL site — script.js ──────────────────────────────────────────────── */
(function () {
  'use strict';

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function qs(s) { return document.querySelector(s); }
  function qsa(s) { return [...document.querySelectorAll(s)]; }

  /* ════════════════════════════════════════════
     ASCII CANVAS
  ════════════════════════════════════════════ */
  const canvas = document.getElementById('asciiCanvas');
  const ctx    = canvas.getContext('2d');
  const hero   = qs('.hero-section');
  let W, H, cols, rows;
  const CW = 10, CH = 18;
  const CHARS = ' .:-=+*#%@';
  let t = 0;
  let mouseX = 0, mouseY = 0, targetMX = 0, targetMY = 0;

  function resizeCanvas() {
    W = canvas.width  = hero.offsetWidth;
    H = canvas.height = hero.offsetHeight;
    cols = Math.ceil(W / CW);
    rows = Math.ceil(H / CH);
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function waveVal(c, r, time) {
    const nx = c / cols, ny = r / rows;
    const ridge =
      .55 +
      Math.sin(nx * 6.2 + time * .78) * .08 +
      Math.sin(nx * 13.4 - time * 1.05) * .055 +
      Math.sin(nx * 29.0 + time * 1.45) * .035 +
      Math.sin(Math.floor(nx * 22) * .9 + time * .62) * .04;
    const skyline = clamp(ridge, .38, .78);
    const distance = ny - skyline;
    const below = 1 / (1 + Math.exp(-distance * 38));
    const edge = Math.exp(-Math.abs(distance) * 34);
    const facade =
      Math.sin(nx * 80 + time * 2.1) * .08 +
      Math.cos(ny * 46 - time * 2.4) * .07 +
      Math.sin((nx - ny) * 34 + time * 1.8) * .06;
    const fullGrid =
      .11 +
      Math.sin(nx * 14 + time * 1.3) * .035 +
      Math.cos(ny * 12 - time * 1.15) * .03;

    return clamp(fullGrid + below * .46 + edge * .34 + facade, 0, 1);
  }

  function mouseDist(c, r) {
    const dx = c * CW + CW / 2 - mouseX;
    const dy = r * CH + CH / 2 - mouseY;
    const d  = Math.sqrt(dx * dx + dy * dy);
    return d < 180 ? Math.pow(1 - d / 180, 2) : 0;
  }

  function drawCanvas() {
    const light = document.documentElement.dataset.theme === 'light';
    const pinkBase = light ? 'rgba(192,0,204,' : 'rgba(252,114,255,';
    const roseBase = light ? 'rgba(148,0,170,' : 'rgba(255,160,255,';

    ctx.clearRect(0, 0, W, H);
    ctx.font = `${CH - 4}px "Fragment Mono", monospace`;
    ctx.textBaseline = 'top';

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let v = waveVal(c, r, t);
        const md = mouseDist(c, r);
        v = clamp(v + md * .6, 0, 1);
        const skylineBoost = v > .54 ? .18 : 0;
        const ci = Math.floor(clamp(v + skylineBoost, 0, 1) * (CHARS.length - 1));
        const ch = CHARS[ci];
        if (!ch || ch === ' ') continue;
        const alpha = (.06 + v * .48 + md * .2).toFixed(2);
        ctx.fillStyle = (v > .62 || md > .25 ? roseBase : pinkBase) + Math.min(alpha, .7).toFixed(2) + ')';
        ctx.fillText(ch, c * CW, r * CH);
      }
    }

    t += .026;
    mouseX = lerp(mouseX, targetMX, .06);
    mouseY = lerp(mouseY, targetMY, .06);
    requestAnimationFrame(drawCanvas);
  }
  drawCanvas();

  document.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    targetMX = e.clientX - r.left;
    targetMY = e.clientY - r.top;
  }, { passive: true });

  /* ════════════════════════════════════════════
     NAV OVERLAY
  ════════════════════════════════════════════ */
  const overlay = qs('#navOverlay');
  let navOpen   = false;

  function openNav()   { navOpen = true;  overlay.classList.add('is-open');    overlay.setAttribute('aria-hidden','false'); }
  function closeNav()  { navOpen = false; overlay.classList.remove('is-open'); overlay.setAttribute('aria-hidden','true');  }
  function toggleNav() { navOpen ? closeNav() : openNav(); }

  qsa('.corner').forEach(c => c.addEventListener('click', toggleNav));
  qsa('[data-close]').forEach(el => {
    el.addEventListener('click', e => {
      closeNav();
      const href = el.getAttribute('href');
      if (href && href.startsWith('#')) {
        e.preventDefault();
        const target = qs(href);
        if (target) target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === 'Escape' && navOpen) closeNav();
    if (e.key === 't' || e.key === 'T') toggleTheme();
    if (e.key === 'n' || e.key === 'N') toggleNav();
  });

  const heroH1 = qs('#heroH1');
  if (heroH1) {
    heroH1.addEventListener('mouseenter', () => { heroH1.style.filter='url(#pixel-mosh)'; });
    heroH1.addEventListener('mouseleave', () => { heroH1.style.filter=''; });
  }

  /* ════════════════════════════════════════════
     LIVE CLOCK
  ════════════════════════════════════════════ */
  const clockEl = qs('#liveClock');
  function tickClock() {
    const n = new Date();
    if (clockEl) clockEl.textContent =
      `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`;
  }
  tickClock();
  setInterval(tickClock, 1000);

  /* ════════════════════════════════════════════
     THEME TOGGLE
  ════════════════════════════════════════════ */
  function toggleTheme() {
    document.documentElement.dataset.theme =
      document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  }
  qs('#themeToggle')?.addEventListener('click', toggleTheme);

  /* ════════════════════════════════════════════
     CARD MAGNETIC HOVER
  ════════════════════════════════════════════ */
  function addMagnetic(selector, strength) {
    qsa(selector).forEach(card => {
      card.addEventListener('mousemove', e => {
        const r  = card.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top  + r.height / 2;
        const dx = (e.clientX - cx) / (r.width  / 2);
        const dy = (e.clientY - cy) / (r.height / 2);
        card.style.transform = `translate(${dx * strength}px, ${dy * strength * .6}px)`;
      });
      card.addEventListener('mouseleave', () => {
        card.style.transition = 'transform .4s cubic-bezier(.22,.61,.36,1)';
        card.style.transform  = '';
        setTimeout(() => { card.style.transition = ''; }, 400);
      });
    });
  }
  addMagnetic('.deploy-card', 5);
  addMagnetic('.problem-card', 4);
  addMagnetic('.proof-card', 3);
  addMagnetic('.customer-card', 4);
  addMagnetic('.product-card', 4);
  addMagnetic('.flow-step', 3);

  /* ════════════════════════════════════════════
     NUMBER COUNTER ANIMATION
  ════════════════════════════════════════════ */
  function animateCount(el) {
    const raw     = el.dataset.count;
    const isFloat = raw && raw.includes('.');
    const target  = parseFloat(raw || el.textContent.replace(/[^0-9.]/g, '')) || 0;
    const prefix  = el.dataset.prefix || '';
    const suffix  = el.dataset.suffix || '';
    const dur     = 1400;
    const start   = performance.now();

    function step(now) {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const val   = target * eased;
      el.textContent = prefix + (isFloat ? val.toFixed(2) : Math.round(val)) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ════════════════════════════════════════════
     TYPEWRITER for .step__cmd
  ════════════════════════════════════════════ */
  function typewriterEl(el) {
    if (el.dataset.typed) return;
    el.dataset.typed = '1';
    const prompt = el.querySelector('.prompt');
    const text   = el.textContent.replace(/^\s*[✓$]\s*/, '').trim();
    const promptChar = prompt ? prompt.textContent : '';

    el.innerHTML = '';
    if (prompt) {
      const sp = document.createElement('span');
      sp.className = 'prompt';
      sp.textContent = promptChar;
      el.appendChild(sp);
    }

    const span   = document.createElement('span');
    const cursor = document.createElement('span');
    cursor.className = 'typed-cursor';
    el.appendChild(span);
    el.appendChild(cursor);

    let i = 0;
    const delay = 18;
    function type() {
      if (i < text.length) {
        span.textContent += text[i++];
        setTimeout(type, delay + Math.random() * 20);
      } else {
        setTimeout(() => { cursor.style.display = 'none'; }, 1800);
      }
    }
    setTimeout(type, 200);
  }

  /* ════════════════════════════════════════════
     H2 WORD SPLIT REVEAL
  ════════════════════════════════════════════ */
  function splitH2(h2) {
    if (h2.dataset.split) return;
    h2.dataset.split = '1';
    // Process text nodes and <em> only
    const children = [...h2.childNodes];
    h2.innerHTML = '';
    children.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        node.textContent.split(/(\s+)/).forEach(part => {
          if (!part.trim()) { h2.appendChild(document.createTextNode(part)); return; }
          const w = document.createElement('span');
          w.className = 'split-word';
          const inner = document.createElement('span');
          inner.className = 'split-word__inner';
          inner.textContent = part;
          w.appendChild(inner);
          h2.appendChild(w);
        });
      } else if (node.nodeName === 'EM' || node.nodeName === 'BR') {
        if (node.nodeName === 'BR') { h2.appendChild(document.createElement('br')); return; }
        const w = document.createElement('span');
        w.className = 'split-word';
        const inner = document.createElement('span');
        inner.className = 'split-word__inner';
        inner.textContent = node.textContent;
        inner.style.fontStyle = 'italic';
        w.appendChild(inner);
        h2.appendChild(w);
      }
    });
  }

  function revealH2(h2) {
    splitH2(h2);
    qsa('.split-word__inner', h2).forEach((w, i) => {
      setTimeout(() => { w.closest('.split-word').classList.add('split-word--visible'); }, i * 70);
    });
  }

  // Patch querySelectorAll to work on element
  HTMLElement.prototype.querySelectorAll = function(s) { return this.querySelectorAll ? Element.prototype.querySelectorAll.call(this,s) : []; };

  /* ════════════════════════════════════════════
     INTERSECTION OBSERVER — master scroll engine
  ════════════════════════════════════════════ */
  const revealTargets = qsa([
    '.step',
    '.problem-card',
    '.deploy-card',
    '.cli-step',
    '.flow-step',
    '.fee-callout',
    '.problem-solution',
    '.issuer-cmd-block',
    '.cli-ref',
    '.tx-list',
    '.pool-info',
    '.section-head',
    '.section-lead',
    '.ticker-strip',
  ].join(','));

  revealTargets.forEach((el, i) => {
    el.style.opacity    = '0';
    el.style.transform  = 'translateY(20px)';
    el.style.transition = `opacity .5s ease ${(i % 4) * 0.04}s, transform .5s ease ${(i % 4) * 0.04}s`;
  });

  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target;

      // Reveal
      el.style.opacity   = '1';
      el.style.transform = 'translateY(0)';

      // Special per-element animations
      if (el.classList.contains('section-head')) {
        const h2 = el.querySelector('h2');
        if (h2) setTimeout(() => revealH2(h2), 120);
      }

      if (el.classList.contains('step')) {
        const cmd = el.querySelector('.step__cmd');
        if (cmd) setTimeout(() => typewriterEl(cmd), 350);
      }

      if (el.classList.contains('cli-step')) {
        const pre = el.querySelector('.cli-step__pre');
        if (pre) { pre.classList.add('just-entered'); setTimeout(() => pre.classList.remove('just-entered'), 500); }
      }

      // Counters on deploy/footer fstats
      el.querySelectorAll('[data-count]').forEach(c => animateCount(c));

      io.unobserve(el);
    });
  }, { threshold: 0.07, rootMargin: '0px 0px -30px 0px' });

  revealTargets.forEach(el => io.observe(el));

  // Step connector line — draw when #how section enters view
  const howSection = qs('#how');
  const stepsEl    = qs('.steps');
  if (howSection && stepsEl) {
    const lineIO = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { stepsEl.classList.add('line-drawn'); lineIO.disconnect(); }
      });
    }, { threshold: 0.1 });
    lineIO.observe(howSection);
  }

  // Footer fstat counters
  const fstatIO = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.querySelectorAll('.fstat__val').forEach(v => {
        const n = parseFloat(v.textContent);
        if (!isNaN(n) && n > 0) {
          const isFloat = v.textContent.includes('.');
          const orig = v.textContent;
          const dur = 1000, start = performance.now();
          const suffix = v.textContent.replace(/[\d.]/g, '');
          function step(now) {
            const p = Math.min((now-start)/dur,1);
            const eased = 1-Math.pow(1-p,3);
            v.textContent = (isFloat ? (n*eased).toFixed(2) : Math.round(n*eased)) + suffix;
            if (p < 1) requestAnimationFrame(step); else v.textContent = orig;
          }
          requestAnimationFrame(step);
        }
      });
      fstatIO.unobserve(e.target);
    });
  }, { threshold: 0.3 });
  qs('.site-footer') && fstatIO.observe(qs('.site-footer'));

  // Fee bars animation
  const feeBarStd  = document.getElementById('feeBarStd');
  const feeBarIlal = document.getElementById('feeBarIlal');
  if (feeBarStd && feeBarIlal) {
    const barIO = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        setTimeout(() => { feeBarStd.style.width  = '100%'; }, 100);
        setTimeout(() => { feeBarIlal.style.width = '18.3%'; }, 400); // 0.055/0.30 = 18.3%
        barIO.disconnect();
      });
    }, { threshold: 0.3 });
    barIO.observe(feeBarStd.closest('.fee-callout') || feeBarStd);
  }

  // Fee callout counter
  const feeIO = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.querySelectorAll('.fee-callout__val, .fee-callout__total strong').forEach(v => {
        const n = parseFloat(v.textContent);
        if (!isNaN(n) && n > 0) {
          const suffix = v.textContent.replace(/[\d.]/g,'');
          const dur = 900, start = performance.now();
          const orig = v.textContent;
          function step(now) {
            const p = Math.min((now-start)/dur,1);
            const eased = 1-Math.pow(1-p,3);
            v.textContent = (n*eased).toFixed(v.textContent.includes('.')?3:0) + suffix;
            if (p < 1) requestAnimationFrame(step); else v.textContent = orig;
          }
          requestAnimationFrame(step);
        }
      });
      feeIO.unobserve(e.target);
    });
  }, { threshold: 0.2 });
  qs('.fee-callout') && feeIO.observe(qs('.fee-callout'));

})();
