/* ===== scrollbar.js — 自製可愛卷軸（不使用瀏覽器原生卷軸） =====
 * 原本的捲動行為（滾輪、觸控、鍵盤）完全保留，只是把原生卷軸藏起來，
 * 另外在上層畫一條永遠看得到、可以拖曳、可以點軌道翻頁的圓潤卷軸。
 * 套用對象：SEL 列出的容器＋整個頁面（非遊戲畫面時）。新容器出現會自動接上。 */
(function (root) {
  'use strict';
  const SEL = '.chat-log, .summary, .sum-pane, .pcards, .result-card, .modal-body, .mc, .side, [data-cs]';
  const bars = new Map();
  let layer = null, raf = 0;

  function ensureLayer() {
    if (layer) return layer;
    layer = document.createElement('div');
    layer.id = 'cs-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    return layer;
  }

  /** target：元素，或 null 代表整個頁面 */
  function attach(target) {
    if (bars.has(target)) return;
    const page = target === null;
    const el = page ? document.scrollingElement || document.documentElement : target;
    const track = document.createElement('div'), thumb = document.createElement('div');
    track.className = 'cs-track'; thumb.className = 'cs-thumb';
    track.appendChild(thumb); ensureLayer().appendChild(track);
    if (page) document.documentElement.classList.add('cs-page'); else el.classList.add('cs');
    const b = { el, page, track, thumb, ratio: 0, room: 0 };
    bars.set(target, b);
    (page ? window : el).addEventListener('scroll', schedule, { passive: true });

    let drag = null;
    thumb.addEventListener('pointerdown', ev => {
      ev.preventDefault(); ev.stopPropagation();
      thumb.setPointerCapture(ev.pointerId);
      drag = { y: ev.clientY, top: el.scrollTop };
      thumb.classList.add('drag');
    });
    thumb.addEventListener('pointermove', ev => {
      if (!drag) return;
      el.scrollTop = drag.top + (ev.clientY - drag.y) * b.ratio;
    });
    const end = () => { drag = null; thumb.classList.remove('drag'); };
    thumb.addEventListener('pointerup', end);
    thumb.addEventListener('pointercancel', end);
    track.addEventListener('pointerdown', ev => {
      if (ev.target !== track) return;
      const r = thumb.getBoundingClientRect();
      const dir = ev.clientY < r.top ? -1 : 1;
      el.scrollTo({ top: el.scrollTop + dir * el.clientHeight * 0.85, behavior: 'smooth' });
    });
    if (window.ResizeObserver) new ResizeObserver(schedule).observe(el);
  }

  function hide(b) { b.track.style.display = 'none'; }

  function update(b) {
    const el = b.el;
    if (!b.page && !el.isConnected) { b.track.remove(); bars.delete(el); return; }
    let x, y, h;
    if (b.page) {
      if (document.body.classList.contains('in-game') || document.querySelector('.modal:not([hidden])')) return hide(b);
      x = innerWidth; y = 0; h = innerHeight;
      if (el.scrollHeight <= innerHeight + 2) return hide(b);
      b.room = el.scrollHeight - innerHeight;
    } else {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 20 || r.height < 30 || cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden]')) return hide(b);
      if (el.scrollHeight <= el.clientHeight + 2) return hide(b);
      const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight);
      if (bottom - top < 40) return hide(b);
      x = r.right - (parseFloat(cs.borderRightWidth) || 0); y = top; h = bottom - top;
      b.room = el.scrollHeight - el.clientHeight;
      /* 被別的東西蓋住（例如彈窗底下的面板）就不畫 */
      const hit = document.elementFromPoint(Math.min(innerWidth - 2, x - 8), Math.min(innerHeight - 2, y + h / 2));
      if (!hit || !(el.contains(hit) || hit.closest('#cs-layer'))) return hide(b);
    }
    const th = h - 12;
    const view = b.page ? innerHeight : el.clientHeight;
    const total = b.page ? el.scrollHeight : el.scrollHeight;
    const thumbH = Math.max(44, Math.min(th, th * view / total));
    const t = b.track.style;
    t.display = 'block'; t.left = (x - 16) + 'px'; t.top = (y + 6) + 'px'; t.height = th + 'px';
    const free = th - thumbH;
    b.ratio = free > 0 ? b.room / free : 1;
    b.thumb.style.height = thumbH + 'px';
    b.thumb.style.transform = 'translateY(' + (b.room > 0 ? free * Math.min(1, el.scrollTop / b.room) : 0) + 'px)';
  }

  function schedule() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; bars.forEach(update); }); }

  function scan() {
    document.querySelectorAll(SEL).forEach(e => attach(e));
    schedule();
  }

  function init() {
    if (!document.body) return;
    attach(null);
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    setInterval(schedule, 350);   /* 彈窗動畫、版面切換之後位置會變 */
  }

  root.CScroll = { attach, refresh: schedule };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof self !== 'undefined' ? self : this);
