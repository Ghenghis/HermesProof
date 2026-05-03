// HermesProof site interactivity
// - IntersectionObserver scroll reveals
// - Terminal typewriter (multi-line, looped)
// - Copy-to-clipboard buttons
// - Tab switcher (OS install instructions)
// - Stats count-up
// - Smooth scroll for in-page anchors (already via CSS, but offset for sticky nav)

(() => {
  'use strict';

  // ---------- 1. Reveal on scroll ----------
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && reveals.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-visible'));
  }

  // ---------- 2. Copy-to-clipboard ----------
  document.querySelectorAll('.codeblock').forEach((block) => {
    const btn = document.createElement('button');
    btn.className = 'codeblock__copy';
    btn.type = 'button';
    btn.textContent = 'COPY';
    btn.setAttribute('aria-label', 'Copy code');
    block.appendChild(btn);
    btn.addEventListener('click', async () => {
      const pre = block.querySelector('pre');
      if (!pre) return;
      const text = pre.innerText;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Fallback for older browsers
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch { /* ignore */ }
        document.body.removeChild(ta);
      }
      btn.textContent = 'COPIED';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'COPY'; btn.classList.remove('copied'); }, 1600);
    });
  });

  // ---------- 3. Tab switcher ----------
  document.querySelectorAll('[data-tabs]').forEach((root) => {
    const tabs = root.querySelectorAll('.tab');
    const panels = root.querySelectorAll('.tab-panel');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-target');
        tabs.forEach((t) => t.classList.toggle('is-active', t === tab));
        panels.forEach((p) => p.classList.toggle('is-active', p.getAttribute('data-panel') === target));
      });
    });
  });

  // ---------- 4. Stats count-up ----------
  const numEls = document.querySelectorAll('[data-count-to]');
  if ('IntersectionObserver' in window && numEls.length) {
    const counted = new WeakSet();
    const countUp = (el) => {
      if (counted.has(el)) return;
      counted.add(el);
      const target = parseFloat(el.getAttribute('data-count-to'));
      const suffix = el.getAttribute('data-suffix') || '';
      const decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
      const duration = 1400;
      const start = performance.now();
      const easeOut = (t) => 1 - Math.pow(1 - t, 3);
      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const v = target * easeOut(t);
        el.textContent = v.toFixed(decimals) + suffix;
        if (t < 1) requestAnimationFrame(tick);
        else el.textContent = target.toFixed(decimals) + suffix;
      };
      requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) countUp(e.target); });
    }, { threshold: 0.6 });
    numEls.forEach((el) => io.observe(el));
  } else {
    numEls.forEach((el) => {
      const v = parseFloat(el.getAttribute('data-count-to'));
      const suffix = el.getAttribute('data-suffix') || '';
      const decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
      el.textContent = v.toFixed(decimals) + suffix;
    });
  }

  // ---------- 5. Terminal typewriter (looped E2E demo) ----------
  const term = document.querySelector('[data-terminal]');
  if (term) {
    const lines = [
      { c: 'c-cmd',    t: '$ npm run truth-gates' },
      { c: 'c-dim',    t: '' },
      { c: 'c-purple', t: '┌─ source.integrity_manifest' },
      { c: 'c-dim',    t: '│  hashing src/ + scripts/ ...' },
      { c: 'c-ok',     t: '└─ [PASS] 25 files hashed' },
      { c: 'c-dim',    t: '' },
      { c: 'c-purple', t: '┌─ deps.parity' },
      { c: 'c-ok',     t: '└─ [PASS] 2 / 2 deps installed' },
      { c: 'c-dim',    t: '' },
      { c: 'c-purple', t: '┌─ tests.unit' },
      { c: 'c-dim',    t: '│  spawning  node --test ...' },
      { c: 'c-ok',     t: '└─ [PASS] 47 tests pass · 0 fail' },
      { c: 'c-dim',    t: '' },
      { c: 'c-purple', t: '┌─ server.stdio_handshake' },
      { c: 'c-dim',    t: '│  MCP initialize → tools/list' },
      { c: 'c-ok',     t: '└─ [PASS] 24 tools surfaced' },
      { c: 'c-dim',    t: '' },
      { c: 'c-purple', t: '┌─ doctor.hermes3d' },
      { c: 'c-ok',     t: '└─ [PASS] ok=true · 0 finding(s)' },
      { c: 'c-dim',    t: '' },
      { c: 'c-pink',   t: '┌─ e2e.multi_agent_flow' },
      { c: 'c-dim',    t: '│  spawning real stdio probe ...' },
      { c: 'c-dim',    t: '│  claim_task → lock_files → block → handoff → gate → release' },
      { c: 'c-ok',     t: '└─ [PASS] 14 / 14 assertions' },
      { c: 'c-dim',    t: '' },
      { c: 'c-purple', t: '┌─ workspace.integrity' },
      { c: 'c-ok',     t: '└─ [PASS] no probe leaks' },
      { c: 'c-dim',    t: '' },
      { c: 'c-purple', t: '┌─ clients.config_presence' },
      { c: 'c-ok',     t: '└─ [PASS] all 4 clients wired' },
      { c: 'c-dim',    t: '' },
      { c: 'c-purple', t: '┌─ clients.claude_code_live' },
      { c: 'c-ok',     t: '└─ [PASS] ✓ Connected' },
      { c: 'c-dim',    t: '' },
      { c: 'c-dim',    t: 'PROOF/latest.json     written (5.0 KB)' },
      { c: 'c-dim',    t: 'PROOF_E2E_REPORT.md   written' },
      { c: 'c-dim',    t: '' },
      { c: 'c-ok',     t: 'Pass: 17  Fail: 0   Warn: 0   Skip: 0   Duration: 15.7s' },
    ];
    term.innerHTML = '';
    let lineIdx = 0;
    let charIdx = 0;
    let currentSpan = null;
    let currentLine = null;
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    term.appendChild(cursor);

    const writeChar = () => {
      const line = lines[lineIdx];
      if (!currentLine) {
        currentLine = document.createElement('div');
        currentSpan = document.createElement('span');
        currentSpan.className = line.c;
        currentLine.appendChild(currentSpan);
        term.insertBefore(currentLine, cursor);
      }
      if (charIdx < line.t.length) {
        currentSpan.textContent += line.t[charIdx];
        charIdx += 1;
        // varied speed per char
        const ch = line.t[charIdx - 1];
        const delay = ch === ' ' ? 8 : (line.c === 'c-ok' || line.c === 'c-pink' ? 14 : 8) + Math.random() * 16;
        setTimeout(writeChar, delay);
      } else {
        // line done
        currentLine = null;
        currentSpan = null;
        charIdx = 0;
        lineIdx += 1;
        if (lineIdx >= lines.length) {
          // restart after a pause
          setTimeout(() => {
            term.innerHTML = '';
            term.appendChild(cursor);
            lineIdx = 0; charIdx = 0;
            writeChar();
          }, 4500);
        } else {
          // pause between lines (longer between groups)
          const pause = lines[lineIdx - 1].t === '' ? 60 : 220;
          setTimeout(writeChar, pause);
        }
      }
      // auto-scroll to bottom
      term.scrollTop = term.scrollHeight;
    };

    // Defer start until terminal is in view to save CPU
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            writeChar();
            obs.disconnect();
          }
        });
      }, { threshold: 0.3 });
      io.observe(term);
    } else {
      writeChar();
    }
  }

  // ---------- 6. Sticky-nav offset for in-page links ----------
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    const navH = document.querySelector('.nav')?.offsetHeight || 0;
    const top = target.getBoundingClientRect().top + window.scrollY - navH - 12;
    window.scrollTo({ top, behavior: 'smooth' });
    history.replaceState(null, '', '#' + id);
  });
})();
