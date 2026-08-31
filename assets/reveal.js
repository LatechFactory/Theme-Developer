/* ==========================================================================
   Scroll-reveal animations  (copy into theme/assets/, pair with reveal.css)
   --------------------------------------------------------------------------
   Adds .reveal-in to [data-reveal] elements as they scroll into view (one-shot).
   Adjacent [data-reveal] siblings (e.g. grid cards) auto-stagger so a row
   cascades in instead of popping at once.

   - Respects prefers-reduced-motion: reveals everything immediately, no motion.
   - Falls back to showing everything if IntersectionObserver is unavailable.
   - Re-scans on shopify:section:load so the theme editor stays live.
   - Sets window.__revealInit so the inline <head> failsafe knows the engine ran.
   ========================================================================== */
(function () {
  'use strict';

  // Tell the head failsafe the engine loaded, so it won't strip reveal-ready.
  window.__revealInit = true;

  var REDUCED =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var STAGGER_STEP = 90; // ms between adjacent revealed siblings
  var STAGGER_MAX = 480; // cap so long rows don't drag

  var observer = null;

  function getObserver() {
    if (observer) return observer;
    observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('reveal-in');
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    );
    return observer;
  }

  // Count of [data-reveal] siblings before this element (its stagger position).
  function staggerIndex(el) {
    var idx = 0;
    var parent = el.parentNode;
    if (!parent) return 0;
    var kids = parent.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] === el) break;
      if (kids[i].nodeType === 1 && kids[i].hasAttribute('data-reveal')) idx++;
    }
    return idx;
  }

  function init(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var els = scope.querySelectorAll('[data-reveal]:not(.reveal-watched)');
    if (!els.length) return;

    // No-animation path: reduced motion or no observer support → just show.
    if (REDUCED || !('IntersectionObserver' in window)) {
      for (var i = 0; i < els.length; i++) {
        els[i].classList.add('reveal-watched', 'reveal-in');
      }
      return;
    }

    var obs = getObserver();
    for (var j = 0; j < els.length; j++) {
      var el = els[j];
      el.classList.add('reveal-watched');

      var explicit = el.getAttribute('data-reveal-delay');
      if (explicit !== null && explicit !== '') {
        el.style.transitionDelay = parseInt(explicit, 10) + 'ms';
      } else {
        var idx = staggerIndex(el);
        if (idx > 0) {
          el.style.transitionDelay = Math.min(idx * STAGGER_STEP, STAGGER_MAX) + 'ms';
        }
      }
      obs.observe(el);
    }
  }

  function boot() {
    init(document);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Theme editor: a section was added/re-rendered — wire up its new elements.
  document.addEventListener('shopify:section:load', function (event) {
    init(event.target || document);
  });
})();
