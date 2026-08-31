/* ENA PDP enhancements — progressive, idempotent (survives section morphs).
   Covers: gallery thumb rail, variant pill decoration (swatches + size rows),
   CTA price, countdown, upsell quick-add, video stories, sticky ATC bar,
   exclusive accordions, cross-sell card decoration. */
(function () {
  'use strict';

  var money = function (cents) {
    return '$' + Math.round(cents / 100).toLocaleString('es-AR');
  };

  var config = null;
  function getConfig() {
    if (config) return config;
    var el = document.querySelector('[data-ena-satc-config]');
    if (!el) return null;
    try {
      config = JSON.parse(el.textContent);
    } catch (e) {
      config = null;
    }
    return config;
  }

  var servingsMap = null;
  function getServingsMap() {
    if (servingsMap) return servingsMap;
    var el = document.querySelector('[data-ena-servings-map]');
    servingsMap = {};
    if (el) {
      try {
        servingsMap = JSON.parse(el.textContent);
      } catch (e) {}
    }
    return servingsMap;
  }

  function currentSelection() {
    var sel = {};
    document.querySelectorAll('.variant-option--buttons input[type="radio"]').forEach(function (input) {
      if (input.checked) sel[input.dataset.optionName] = input.value;
    });
    return sel;
  }

  function findVariant(opt1, opt2) {
    var cfg = getConfig();
    if (!cfg) return null;
    return (
      cfg.variants.find(function (v) {
        return v.option1 === opt1 && (v.option2 === opt2 || !v.option2);
      }) || null
    );
  }

  /* ---------- 1. Countdown ---------- */
  function initCountdowns() {
    document.querySelectorAll('[data-ena-countdown]').forEach(function (el) {
      if (el.__enaTicking) return;
      var end = new Date(el.getAttribute('data-ena-countdown')).getTime();
      if (isNaN(end)) return;
      var timeEl = el.querySelector('[data-ena-countdown-time]');
      function tick() {
        var diff = end - Date.now();
        if (diff <= 0) {
          el.hidden = true;
          clearInterval(el.__enaTicking);
          return;
        }
        el.hidden = false;
        var h = Math.floor(diff / 3600000);
        var m = Math.floor((diff % 3600000) / 60000);
        var s = Math.floor((diff % 60000) / 1000);
        var pad = function (n) {
          return (n < 10 ? '0' : '') + n;
        };
        if (timeEl) timeEl.innerHTML = pad(h) + '&nbsp;:&nbsp;' + pad(m) + '&nbsp;:&nbsp;' + pad(s);
      }
      tick();
      el.__enaTicking = setInterval(tick, 1000);
    });
  }

  /* ---------- 2. Upsell quick add ---------- */
  function updateCartBubble() {
    fetch('/cart.js')
      .then(function (r) {
        return r.json();
      })
      .then(function (cart) {
        document.querySelectorAll('.cart-bubble__text, [data-cart-count]').forEach(function (el) {
          el.textContent = cart.item_count;
        });
        var bubble = document.querySelector('.cart-bubble');
        if (bubble) bubble.classList.remove('visually-hidden');
      })
      .catch(function () {});
  }

  function addToCart(variantId, btn, doneClass, quantity) {
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: Number(variantId), quantity: quantity || 1 }),
    }).then(function (r) {
      if (!r.ok) throw new Error('add failed');
      if (btn) {
        btn.classList.add(doneClass || 'is-added');
        setTimeout(function () {
          btn.classList.remove(doneClass || 'is-added');
        }, 2000);
      }
      updateCartBubble();
    });
  }

  document.addEventListener('click', function (e) {
    var quick = e.target.closest('[data-ena-quick-add]');
    if (quick) {
      e.preventDefault();
      addToCart(quick.getAttribute('data-ena-quick-add'), quick).catch(function () {});
    }
  });

  /* ---------- 2c. ENA Club info tooltip (tap to toggle, tap-out to close) ---------- */
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('.ena-club__info');
    var wrap = trigger ? trigger.closest('[data-ena-club-info]') : null;
    // close any open tooltip that wasn't the one just tapped
    document.querySelectorAll('[data-ena-club-info].is-open').forEach(function (w) {
      if (w !== wrap) {
        w.classList.remove('is-open');
        var b = w.querySelector('.ena-club__info');
        if (b) b.setAttribute('aria-expanded', 'false');
      }
    });
    if (!wrap) return;
    e.preventDefault();
    var open = wrap.classList.toggle('is-open');
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('[data-ena-club-info].is-open').forEach(function (w) {
      w.classList.remove('is-open');
      var b = w.querySelector('.ena-club__info');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  });

  /* ---------- 2b. Rating → scroll to reviews ---------- */
  document.addEventListener('click', function (e) {
    var rating = e.target.closest('[data-ena-rating]');
    if (!rating) return;
    e.preventDefault();
    var reviews = document.querySelector('[id*="__ena_reviews"]');
    if (!reviews) return;
    var header = document.querySelector('#header-component');
    var offset = (header ? header.offsetHeight : 0) + 16;
    var pw = document.querySelector('.page-wrapper');
    var scroller = pw && pw.scrollHeight > pw.clientHeight + 10 ? pw : document.scrollingElement;
    var top = reviews.getBoundingClientRect().top + scroller.scrollTop - offset;
    scroller.scrollTo({ top: top, behavior: 'smooth' });
  });

  /* ---------- 3. Video stories (simple modal) ---------- */
  document.addEventListener('click', function (e) {
    var story = e.target.closest('[data-ena-story]');
    if (!story) return;
    var img = story.querySelector('img');
    if (!img) return;
    var overlay = document.createElement('div');
    overlay.className = 'ena-story-modal';
    overlay.innerHTML =
      '<div class="ena-story-modal__box"><img src="' +
      img.src.replace(/width=\d+/, 'width=720') +
      '" alt=""><span class="ena-story-modal__note">Video review — se conecta con la app de video reviews</span></div>';
    overlay.addEventListener('click', function () {
      overlay.remove();
    });
    document.body.appendChild(overlay);
  });

  /* ---------- 4. Variant pill decoration ---------- */
  function decorateFlavorPills() {
    var cfg = getConfig();
    if (!cfg || !cfg.swatches) return;
    document.querySelectorAll('.variant-option--buttons').forEach(function (fieldset) {
      var legend = fieldset.querySelector('legend');
      if (!legend || legend.textContent.trim().toLowerCase().indexOf('sabor') !== 0) return;
      fieldset.classList.add('ena-flavor-fieldset');
      fieldset.querySelectorAll('.variant-option__button-label').forEach(function (label) {
        var input = label.querySelector('input');
        var url = input && cfg.swatches[input.value];
        if (!url) return;
        var dot = label.querySelector('.ena-flavor-swatch');
        if (!dot) {
          dot = document.createElement('span');
          dot.className = 'ena-flavor-swatch';
          label.insertBefore(dot, label.firstChild);
        }
        var want = 'url("' + url + '")';
        if (dot.style.backgroundImage !== want) dot.style.backgroundImage = want;
      });
    });
  }

  var SIZE_TAGS = { '1 Kg': { text: 'Mejor opción', cls: '' }, Monodosis: { text: 'Práctica', cls: 'ena-tag--soft' } };
  var SIZE_NOTES = { Monodosis: 'Sobres individuales para llevar' };
  var SIZE_ORDER = ['150 g', '300 g', '1 Kg', 'Monodosis'];

  function decorateSizeRows() {
    var cfg = getConfig();
    if (!cfg) return;
    var map = getServingsMap();
    var sel = currentSelection();
    document.querySelectorAll('.variant-option--buttons').forEach(function (fieldset) {
      var legend = fieldset.querySelector('legend');
      if (!legend || legend.textContent.trim().toLowerCase().indexOf('tama') !== 0) return;
      fieldset.classList.add('ena-size-fieldset');
      fieldset.querySelectorAll('.variant-option__button-label').forEach(function (label) {
        var input = label.querySelector('input');
        if (!input) return;
        var size = input.value;
        var flavor = sel['Sabor'] || (cfg.variants[0] && cfg.variants[0].option1);
        var variant = findVariant(flavor, size);
        var idx = SIZE_ORDER.indexOf(size);
        if (idx >= 0) label.style.order = idx;

        var meta = label.querySelector('.ena-size-meta');
        if (!meta) {
          meta = document.createElement('span');
          meta.className = 'ena-size-meta';
          label.appendChild(meta);
        }
        var servings = map[size];
        var metaText = '';
        if (SIZE_NOTES[size]) {
          metaText = SIZE_NOTES[size];
        } else if (servings && variant) {
          metaText = servings + ' servicios · ' + money(variant.price / servings) + ' / servicio';
        }
        if (meta.textContent !== metaText) meta.textContent = metaText;

        var tagInfo = SIZE_TAGS[size];
        if (tagInfo && !label.querySelector('.ena-tag')) {
          var tag = document.createElement('span');
          tag.className = 'ena-tag ' + tagInfo.cls;
          tag.textContent = tagInfo.text;
          var textEl = label.querySelector('.variant-option__button-label__text');
          if (textEl) textEl.insertAdjacentElement('afterend', tag);
        }

        var priceEl = label.querySelector('.ena-size-price');
        if (!priceEl) {
          priceEl = document.createElement('span');
          priceEl.className = 'ena-size-price';
          label.appendChild(priceEl);
        }
        if (variant && priceEl.textContent !== money(variant.price)) priceEl.textContent = money(variant.price);
      });
    });
  }

  /* ---------- 5. Purchase mode (Subscribe & Save) + CTA price ---------- */
  // Subscription is the preselected default; applyAll() falls back to onetime
  // when no subscribe option renders (no selling plans + demo mode off).
  var enaMode = 'subscribe';

  // Quantity-discount pack state. qty = units in the selected pack, pct = its
  // discount %. Default x1 (no discount). Multi-packs are exclusive with
  // subscription: picking x2/x3 forces onetime; picking subscribe resets to x1.
  var enaPack = { qty: 1, pct: 0 };

  function getModeEl() {
    return document.querySelector('[data-ena-mode]');
  }

  function modePct() {
    var el = getModeEl();
    return el ? parseFloat(el.getAttribute('data-pct')) || 0 : 0;
  }

  function subPriceOf(cents) {
    return Math.round(cents * (1 - modePct() / 100));
  }

  function selectedVariant() {
    var cfg = getConfig();
    if (!cfg) return null;
    var sel = currentSelection();
    var variant = cfg.variants.find(function (v) {
      return (!sel['Sabor'] || v.option1 === sel['Sabor']) && (!sel['Tamaño'] || v.option2 === sel['Tamaño']);
    });
    return variant || cfg.variants[0] || null;
  }

  function syncSellingPlanInput() {
    var el = getModeEl();
    if (!el || el.getAttribute('data-demo') === 'true') return;
    var form = document.querySelector('.product-details form[action*="/cart/add"], product-form-component form');
    if (!form) return;
    var input = form.querySelector('input[name="selling_plan"]');
    if (enaMode === 'subscribe') {
      var freq = el.querySelector('[data-ena-frequency]');
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'selling_plan';
        form.appendChild(input);
      }
      if (freq) input.value = freq.value;
    } else if (input) {
      input.remove();
    }
  }

  function syncModeUI() {
    var el = getModeEl();
    if (el) {
      el.querySelectorAll('[data-ena-mode-option]').forEach(function (card) {
        var isSel = card.getAttribute('data-ena-mode-option') === enaMode;
        card.classList.toggle('is-selected', isSel);
        var input = card.querySelector('input[type=radio]');
        if (input && input.checked !== isSel) input.checked = isSel;
      });
    }
    document.querySelectorAll('[data-ena-satc-mode] button').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-mode') === enaMode);
    });
    syncSellingPlanInput();
  }

  function setMode(next) {
    if (next === enaMode) return;
    enaMode = next;
    // Subscription and multi-packs are exclusive — going back to subscribe
    // resets the pack to x1 (a bulk pack is a one-time purchase).
    if (enaMode === 'subscribe') {
      enaPack = { qty: 1, pct: 0 };
      setQtyInput(1);
    }
    syncModeUI();
    syncQtyDiscountUI();
    decorateCtaPrice();
    refreshStickyBar();
  }

  document.addEventListener('click', function (e) {
    var card = e.target.closest('[data-ena-mode-option]');
    if (card) {
      setMode(card.getAttribute('data-ena-mode-option'));
      return;
    }
    var toggle = e.target.closest('[data-ena-satc-mode] button');
    if (toggle) {
      setMode(toggle.getAttribute('data-mode'));
    }
  });

  function decorateCtaPrice() {
    var variant = selectedVariant();
    if (!variant) return;
    document.querySelectorAll('.product-details .add-to-cart-text__content > span:first-child').forEach(function (el) {
      if (!el.dataset.enaBase) el.dataset.enaBase = el.textContent.split('·')[0].trim();
      var next;
      if (enaMode === 'subscribe') {
        next = 'Suscribirme · ' + money(subPriceOf(variant.price));
      } else {
        // one-time: reflect the selected pack total (unit price × qty − pack %)
        var qty = enaPack.qty || 1;
        var total = Math.round(variant.price * qty * (1 - (enaPack.pct || 0) / 100));
        next = el.dataset.enaBase + ' · ' + money(total);
      }
      if (el.textContent !== next) el.textContent = next;
    });
  }

  /* ---------- 5c. Quantity-discount pack builder ---------- */
  function setQtyInput(qty) {
    var input = document.querySelector(
      '.product-details .quantity-selector input[name="quantity"], .product-details input[name="quantity"]'
    );
    if (input && String(input.value) !== String(qty)) {
      input.value = qty;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function currentMainImage() {
    var media = document.querySelector('.product-information__media');
    if (!media) return null;
    var slides = media.querySelectorAll('slideshow-slide');
    for (var i = 0; i < slides.length; i++) {
      if (getComputedStyle(slides[i]).display !== 'none') {
        var img = slides[i].querySelector('img');
        if (img) return img.currentSrc || img.src;
      }
    }
    var any = media.querySelector('img');
    return any ? any.currentSrc || any.src : null;
  }

  function syncQtyDiscountUI() {
    var qd = document.querySelector('[data-ena-qd]');
    if (!qd) return;
    // qty >= 3 keeps the top (3-unit) tier highlighted (PM: >3 mirrors the 3-pack).
    var tier = (enaPack.qty || 1) >= 3 ? 3 : enaPack.qty || 1;
    qd.querySelectorAll('[data-ena-qd-pack]').forEach(function (pack) {
      var qty = parseInt(pack.getAttribute('data-qty'), 10) || 1;
      pack.classList.toggle('is-selected', qty === tier);
    });
  }

  function decorateQtyDiscount() {
    var qd = document.querySelector('[data-ena-qd]');
    if (!qd) return;
    var variant = selectedVariant();
    if (!variant) return;
    var pct2 = parseFloat(qd.getAttribute('data-pct2')) || 0;
    var pct3 = parseFloat(qd.getAttribute('data-pct3')) || 0;
    var img = currentMainImage();
    qd.querySelectorAll('[data-ena-qd-pack]').forEach(function (pack) {
      var qty = parseInt(pack.getAttribute('data-qty'), 10) || 1;
      var pct = qty === 2 ? pct2 : qty === 3 ? pct3 : 0;
      pack.setAttribute('data-pct', pct);
      var was = variant.price * qty;
      var now = Math.round(was * (1 - pct / 100));
      var wasEl = pack.querySelector('[data-ena-qd-was]');
      var nowEl = pack.querySelector('[data-ena-qd-now]');
      if (wasEl && wasEl.textContent !== money(was)) wasEl.textContent = money(was);
      if (nowEl && nowEl.textContent !== money(now)) nowEl.textContent = money(now);
      // Only mirror the variant image into packs WITHOUT a merchant-pinned
      // image (data-ena-qd-fixed). Pinned images stay put across variants.
      if (img) {
        var im = pack.querySelector('[data-ena-qd-img]:not([data-ena-qd-fixed])');
        if (im && im.getAttribute('src') !== img) im.setAttribute('src', img);
      }
    });
    // keep the live pack pct in step with the current settings (qty >= 3 => 3-pack %)
    if (enaPack.qty >= 3) enaPack.pct = pct3;
    else if (enaPack.qty === 2) enaPack.pct = pct2;
    else enaPack.pct = 0;
    syncQtyDiscountUI();
  }

  document.addEventListener('click', function (e) {
    var pack = e.target.closest('[data-ena-qd-pack]');
    if (!pack) return;
    var qty = parseInt(pack.getAttribute('data-qty'), 10) || 1;
    var pct = parseFloat(pack.getAttribute('data-pct')) || 0;
    enaPack = { qty: qty, pct: pct };
    // A multi-unit pack is a one-time purchase — flip out of subscription.
    if (qty > 1 && enaMode === 'subscribe') {
      enaMode = 'onetime';
      syncModeUI();
    }
    setQtyInput(qty);
    syncQtyDiscountUI();
    decorateCtaPrice();
    refreshStickyBar();
  });

  // Reverse-sync: counter changes update the highlighted pack + CTA price.
  // Maps any quantity to a pack tier: 1 => x1, 2 => x2, >=3 => x3 (keeps the
  // 3-pack discount for 4+). Quantity stays the real counter value so the CTA
  // total and the add-to-cart quantity track the counter exactly.
  function applyQtyToPack(rawQty) {
    var qd = document.querySelector('[data-ena-qd]');
    if (!qd) return;
    var q = parseInt(rawQty, 10) || 1;
    if (q < 1) q = 1;
    var pct2 = parseFloat(qd.getAttribute('data-pct2')) || 0;
    var pct3 = parseFloat(qd.getAttribute('data-pct3')) || 0;
    var pct = q >= 3 ? pct3 : q === 2 ? pct2 : 0;
    enaPack = { qty: q, pct: pct };
    syncQtyDiscountUI();
    decorateCtaPrice();
    refreshStickyBar();
  }

  // Horizon's +/- stepper fires a custom bubbling event (not a native change)
  // when its value changes — this is the path that makes the buttons work.
  document.addEventListener('quantity-selector:update', function (e) {
    if (!e.detail || e.detail.quantity == null) return;
    // Ignore cart line-item selectors (they carry a cartLine) — only the
    // product form / sticky-bar selectors should drive the pack UI.
    if (e.detail.cartLine != null) return;
    applyQtyToPack(e.detail.quantity);
  });
  // Fallback for direct typing that emits a native change on the input.
  document.addEventListener('change', function (e) {
    if (!e.target.matches || !e.target.matches('input[name="quantity"]')) return;
    if (e.target.dataset && e.target.dataset.cartLine != null) return;
    applyQtyToPack(e.target.value);
  });

  /* ---------- 5b. Keep value chips + club points in sync with variant ---------- */
  function updateDynamicBlocks() {
    var cfg = getConfig();
    if (!cfg) return;
    var sel = currentSelection();
    var variant =
      cfg.variants.find(function (v) {
        return (!sel['Sabor'] || v.option1 === sel['Sabor']) && (!sel['Tamaño'] || v.option2 === sel['Tamaño']);
      }) || cfg.variants[0];
    if (!variant) return;

    var map = getServingsMap();
    var servings = map[variant.option2] || map[variant.option1];
    var chips = document.querySelector('.ena-chips');
    if (chips && servings) {
      var chipEls = chips.querySelectorAll('.ena-chips__chip');
      if (chipEls[0]) {
        var perServing = money(variant.price / servings);
        var next0 = perServing + ' por servicio';
        var strong = chipEls[0].querySelector('strong');
        if (strong && strong.textContent !== perServing) {
          strong.textContent = perServing;
        }
      }
      if (chipEls[1]) {
        var next1 = servings + ' servicios';
        if (chipEls[1].textContent.trim() !== next1) chipEls[1].textContent = next1;
      }
      if (chipEls[2]) {
        var months = Math.floor(servings / 30);
        if (months > 0) {
          var monthsText = months + (months === 1 ? ' mes' : ' meses');
          var textNode = chipEls[2].lastChild;
          if (textNode && textNode.textContent.trim() !== monthsText) {
            chipEls[2].innerHTML = chipEls[2].innerHTML.replace(/\d+\s+mes(es)?/, monthsText);
          }
          chipEls[2].style.display = '';
        } else {
          chipEls[2].style.display = 'none';
        }
      }
    }

    var clubStrong = document.querySelector('.ena-club__text strong');
    if (clubStrong) {
      var points = money(variant.price).replace('$', '') + ' puntos';
      if (clubStrong.textContent !== points) clubStrong.textContent = points;
    }

    var badge = document.querySelector('.ena-badge');
    if (badge && variant.compare > variant.price) {
      var pct = Math.round(((variant.compare - variant.price) / variant.compare) * 100);
      var prefix = badge.textContent.trim().split(' ')[0];
      var nextBadge = prefix + ' ' + pct + '%';
      if (badge.textContent.trim() !== nextBadge) badge.textContent = nextBadge;
    }

    var onetimePrice = document.querySelector('[data-ena-onetime-price]');
    if (onetimePrice && onetimePrice.textContent !== money(variant.price)) {
      onetimePrice.textContent = money(variant.price);
    }

    // Subscribe & Save card numbers (demo pricing computed from data-pct)
    var subPriceEl = document.querySelector('[data-ena-sub-price]');
    if (subPriceEl) {
      var sub = subPriceOf(variant.price);
      if (subPriceEl.textContent !== money(sub)) subPriceEl.textContent = money(sub);
      var subCompare = document.querySelector('[data-ena-sub-compare]');
      if (subCompare && subCompare.textContent !== money(variant.price)) {
        subCompare.textContent = money(variant.price);
      }
      var subValue = document.querySelector('[data-ena-sub-value]');
      if (subValue && servings) {
        var valText =
          money(sub / servings) + ' / servicio · vs ' + money(variant.price / servings) + ' en compra única';
        if (subValue.textContent !== valText) subValue.textContent = valText;
      }
    }

    syncModeUI();
  }

  /* ---------- 6. Gallery media filter (mobile carousel) ---------- */
  function filterCarouselMedia() {
    var cfg = getConfig();
    var exclude = cfg && cfg.galleryExclude ? cfg.galleryExclude : null;
    if (!exclude) return;
    var media = document.querySelector('.product-information__media');
    if (!media) return;
    var slides = media.querySelectorAll('slideshow-slide');
    var dots = media.querySelectorAll('.slideshow-control');
    slides.forEach(function (s, i) {
      var img = s.querySelector('img');
      var match = img && (img.currentSrc || img.src).indexOf(exclude) >= 0;
      var want = match ? 'none' : '';
      if (s.style.display !== want) s.style.display = want;
      if (dots[i] && dots[i].style.display !== want) dots[i].style.display = want;
    });
  }

  /* ---------- 6b. Gallery thumb rail ---------- */
  function buildThumbRail() {
    var media = document.querySelector('.product-information__media');
    if (!media) return;
    var grid = media.querySelector('.media-gallery__grid');
    if (!grid) return;
    var cfg = getConfig();
    var exclude = cfg && cfg.galleryExclude ? cfg.galleryExclude : null;
    var items = Array.prototype.slice.call(grid.children).filter(function (li) {
      var img = li.querySelector('img');
      if (!img) return false;
      // reference order: only the content images in the stack — variant/flavor
      // shots stay on the variant (cart + sticky thumbs) but leave the gallery
      if (exclude && (img.currentSrc || img.src).indexOf(exclude) >= 0) {
        li.style.display = 'none';
        return false;
      }
      li.style.display = '';
      return true;
    });
    if (items.length < 2) return;

    var rail = media.querySelector('.ena-thumb-rail');
    // key from the src ATTRIBUTE (not currentSrc: during a variant morph the
    // old image keeps "displaying" until the new one loads, so currentSrc lies)
    var railKey = items
      .map(function (li) {
        var img = li.querySelector('img');
        return img ? img.src : '';
      })
      .join('|');
    if (rail && rail.__key === railKey && rail.__firstItem === items[0]) return;
    if (rail) rail.remove();

    rail = document.createElement('div');
    rail.className = 'ena-thumb-rail';
    rail.__key = railKey;
    rail.__firstItem = items[0];
    items.forEach(function (li, i) {
      var img = li.querySelector('img');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ena-thumb-rail__thumb' + (i === 0 ? ' is-active' : '');
      btn.setAttribute('aria-label', 'Imagen ' + (i + 1));
      btn.__enaIdx = i;
      var src = img.src.replace(/width=\d+/, 'width=200');
      btn.innerHTML = '<img src="' + src + '" alt="" loading="lazy">';
      btn.addEventListener('click', function () {
        // resolve the target li LIVE — the grid nodes get replaced on morphs
        var liveItems = Array.prototype.slice.call(grid.children).filter(function (x) {
          return x.querySelector('img') && getComputedStyle(x).display !== 'none';
        });
        var target = liveItems[btn.__enaIdx] || li;
        var header = document.querySelector('#header-component');
        var offset = (header ? header.offsetHeight : 0) + 16;
        var pw = document.querySelector('.page-wrapper');
        var scroller = pw && pw.scrollHeight > pw.clientHeight + 10 ? pw : document.scrollingElement;
        var top = target.getBoundingClientRect().top + scroller.scrollTop - offset;
        scroller.scrollTo({ top: top, behavior: 'smooth' });
      });
      rail.appendChild(btn);
    });
    media.classList.add('ena-has-rail');
    media.insertBefore(rail, media.firstChild);

    if (window.__enaRailObserver) window.__enaRailObserver.disconnect();
    window.__enaRailObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var idx = items.indexOf(entry.target);
          if (idx < 0) return;
          rail.querySelectorAll('.ena-thumb-rail__thumb').forEach(function (b, i) {
            b.classList.toggle('is-active', i === idx);
          });
        });
      },
      { rootMargin: '-35% 0px -55% 0px' }
    );
    items.forEach(function (li) {
      window.__enaRailObserver.observe(li);
    });
  }

  /* ---------- 7. Sticky ATC bar ---------- */
  function initStickyBar() {
    var bar = document.querySelector('[data-ena-satc]');
    if (!bar || bar.__enaInit) return;
    bar.__enaInit = true;
    var cfg = getConfig();
    if (!cfg) return;

    var selects = bar.querySelectorAll('[data-ena-satc-option]');
    var priceEl = bar.querySelector('[data-ena-satc-price]');
    var swatchEl = bar.querySelector('[data-ena-satc-swatch]');
    var addBtn = bar.querySelector('[data-ena-satc-add]');

    function barVariant() {
      var o1 = selects[0] ? selects[0].value : null;
      var o2 = selects[1] ? selects[1].value : null;
      return (
        cfg.variants.find(function (v) {
          return v.option1 === o1 && (v.option2 === o2 || !v.option2);
        }) || null
      );
    }

    var narrow = window.matchMedia('(max-width: 749px)');

    function refresh() {
      var v = barVariant();
      // Mirror the selected pack in one-time mode: qty units × unit − pack %.
      var packQty = enaPack.qty || 1;
      var packTotal = v ? Math.round(v.price * packQty * (1 - (enaPack.pct || 0) / 100)) : 0;
      var priceText = v
        ? enaMode === 'subscribe'
          ? money(subPriceOf(v.price)) + ' /entrega'
          : money(packTotal)
        : '';
      if (v && priceEl && priceEl.textContent !== priceText) priceEl.textContent = priceText;
      if (addBtn) {
        var base =
          enaMode === 'subscribe'
            ? addBtn.getAttribute('data-label-subscribe') || 'Suscribirme'
            : addBtn.getAttribute('data-label-onetime') || 'Agregar al carrito';
        // On mobile the standalone price is hidden, so fold it into the CTA
        var label = narrow.matches && priceText ? base + ' · ' + priceText : base;
        if (addBtn.textContent.trim() !== label) addBtn.textContent = label;
      }
      if (swatchEl && selects[0] && cfg.swatches[selects[0].value]) {
        swatchEl.style.backgroundImage = 'url(' + cfg.swatches[selects[0].value] + ')';
      }
      if (addBtn) addBtn.disabled = !(v && v.available);
    }

    selects.forEach(function (s, i) {
      s.addEventListener('change', function () {
        // push into main picker so gallery/price/buy box follow
        var input = document.querySelector(
          '.variant-option--buttons input[data-input-id], .variant-option--buttons input'
        );
        document.querySelectorAll('.variant-option--buttons input[type="radio"]').forEach(function (radio) {
          if (radio.value === s.value && !radio.checked) radio.click();
        });
        refresh();
      });
    });

    if (addBtn) {
      addBtn.addEventListener('click', function () {
        var v = barVariant();
        if (!v) return;
        // one-time packs add N units; subscription is always a single unit
        var qty = enaMode === 'subscribe' ? 1 : enaPack.qty || 1;
        addToCart(v.id, addBtn, null, qty).catch(function () {});
      });
    }

    // Visibility: the bar shows whenever the buy-box CTA is NOT on screen —
    // whether it's below the fold on initial load OR scrolled above the top.
    // Re-query the CTA live on every scroll — an IntersectionObserver would go
    // stale because Horizon hydration + variant morphs replace the CTA node,
    // and it wouldn't track the .page-wrapper scroll container on desktop.
    function updateBarVisibility() {
      var mainCta = document.querySelector(
        '.product-details .add-to-cart-button, .product-details [ref="addToCartButton"], .product-details add-to-cart-component'
      );
      if (!mainCta) return;
      var r = mainCta.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      // any part of the CTA within the viewport counts as visible
      var ctaVisible = r.bottom > 0 && r.top < vh;
      if (bar.hidden !== ctaVisible) bar.hidden = ctaVisible;
    }
    window.addEventListener('scroll', updateBarVisibility, { passive: true });
    var pageScroller = document.querySelector('.page-wrapper');
    if (pageScroller) pageScroller.addEventListener('scroll', updateBarVisibility, { passive: true });
    // initial state can mismeasure before fonts/images settle the CTA position
    window.addEventListener('resize', updateBarVisibility);
    window.addEventListener('load', updateBarVisibility);
    window.__enaBarVisibility = updateBarVisibility;
    updateBarVisibility();

    document.addEventListener('change', function (e) {
      var input = e.target;
      if (!input.matches || !input.matches('.variant-option--buttons input[type="radio"]')) return;
      selects.forEach(function (s) {
        var opt = Array.prototype.find.call(s.options, function (o) {
          return o.value === input.value;
        });
        if (opt) s.value = input.value;
      });
      refresh();
    });

    window.__enaStickyRefresh = refresh;
    // re-fold the price into/out of the CTA label when crossing the breakpoint
    if (narrow.addEventListener) narrow.addEventListener('change', refresh);
    refresh();
  }

  function refreshStickyBar() {
    if (window.__enaStickyRefresh) window.__enaStickyRefresh();
  }

  /* ---------- 8. Exclusive accordions in details area ---------- */
  document.addEventListener(
    'toggle',
    function (e) {
      var details = e.target;
      if (!(details instanceof HTMLElement) || details.tagName !== 'DETAILS' || !details.open) return;
      var scope = details.closest('.ena-details-scope, .accordion-block');
      if (!scope) return;
      var container = details.closest('.group-block, .section');
      if (!container) return;
      container.querySelectorAll('details[open]').forEach(function (other) {
        if (other !== details && other.contains(details) === false && details.contains(other) === false) {
          other.removeAttribute('open');
        }
      });
    },
    true
  );

  /* ---------- 9. Cross-sell card decoration ---------- */
  var CARD_META = {
    'whey-protein': { badge: 'WHEY', color: '#C9A227', spec: '24 g de proteína / porción' },
    'bcaa-2-1-1': { badge: 'BCAA', color: '#3FB84F', spec: 'Recuperación muscular' },
    glutamina: { badge: 'GLUTAMINE', color: '#D81E7A', spec: 'Reparación y recupero' },
    'cafeina-red': { badge: 'CAFEÍNA', color: '#C42032', spec: 'Energía & foco' },
    'shaker-ena-600ml': { badge: 'ACCESORIOS', color: '#6E6E6E', spec: 'Shaker 600 ml' },
    'creatina-monohidrato': { badge: 'CREATINA', color: '#1E5FA8', spec: '5 g de creatina por porción' },
  };

  function decorateCards() {
    document.querySelectorAll('.product-recommendations product-card, product-card').forEach(function (card) {
      if (card.__enaDecorated) return;
      var link = card.querySelector('a[href*="/products/"]');
      if (!link) return;
      var handleMatch = link.getAttribute('href').match(/\/products\/([^?/]+)/);
      if (!handleMatch) return;
      var meta = CARD_META[handleMatch[1]];
      if (!meta) return;
      card.__enaDecorated = true;
      var gallery = card.querySelector('.product-card__gallery, .card-gallery') || card;
      // Category tag is omitted in the "Combiná con" recommendations carousel
      // for a cleaner card (QA ticket); the native "Oferta" sale badge stays.
      if (!card.closest('.product-recommendations')) {
        var badge = document.createElement('span');
        badge.className = 'ena-card-badge';
        badge.textContent = meta.badge;
        badge.style.background = meta.color;
        gallery.appendChild(badge);
      }
      var titleEl = card.querySelector('.product-card__content > a.contents, .product-card__title, product-title, .product-title, h6');
      if (titleEl && !card.querySelector('.ena-card-spec')) {
        var spec = document.createElement('span');
        spec.className = 'ena-card-spec';
        spec.textContent = meta.spec.toUpperCase();
        titleEl.insertAdjacentElement('afterend', spec);
      }
      if (!card.querySelector('.ena-card-plus')) {
        var plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'ena-card-plus';
        plus.textContent = '+';
        plus.setAttribute('aria-label', 'Agregar al carrito');
        plus.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          fetch('/products/' + handleMatch[1] + '.js')
            .then(function (r) { return r.json(); })
            .then(function (p) {
              var v = p.variants.find(function (x) { return x.available; }) || p.variants[0];
              return addToCart(v.id, plus);
            })
            .catch(function () {});
        });
        card.appendChild(plus);
      }
    });
  }

  /* ---------- buy-box sticky offset (unified page scroll) ---------- */
  /* The buy box is usually taller than the viewport. A plain sticky top would
     pin it immediately and its bottom (the ATC) would never come into view via
     page scroll. Setting top to the negative overflow makes it scroll with the
     page until its bottom sits 24px above the viewport bottom, then pin. */
  function syncDetailsSticky() {
    var details = document.querySelector('.product-details.sticky-content--desktop');
    if (!details) return;
    if (window.matchMedia('(max-width: 749px)').matches) {
      details.style.removeProperty('--ena-details-top');
      return;
    }
    var offset =
      parseFloat(getComputedStyle(details).getPropertyValue('--sticky-header-offset')) || 0;
    var vh = document.documentElement.clientHeight;
    var h = details.offsetHeight;
    if (h + offset + 24 <= vh) {
      // fits under the (sticky) header — let Horizon's own top offset apply
      details.style.removeProperty('--ena-details-top');
    } else {
      details.style.setProperty('--ena-details-top', vh - h - 24 + 'px');
    }
  }

  /* ---------- boot + survive morphs ---------- */
  function applyAll() {
    initCountdowns();
    decorateFlavorPills();
    decorateSizeRows();
    // subscription preselected by default — but only if a subscribe option
    // actually renders (selling plans or demo mode); otherwise fall back
    if (enaMode === 'subscribe') {
      var modeEl = getModeEl();
      if (!modeEl || !modeEl.querySelector('[data-ena-mode-option="subscribe"]')) {
        enaMode = 'onetime';
      }
    }
    // re-assert mode UI after variant morphs (liquid re-renders reset classes)
    syncModeUI();
    decorateQtyDiscount();
    decorateCtaPrice();
    updateDynamicBlocks();
    filterCarouselMedia();
    buildThumbRail();
    initStickyBar();
    decorateCards();
    syncDetailsSticky();
  }

  var scheduled = false;
  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    var ran = false;
    function run() {
      if (ran) return;
      ran = true;
      scheduled = false;
      try {
        applyAll();
      } catch (e) {
        /* one bad cycle must not kill the loop */
      }
    }
    // rAF re-decorates BEFORE the next paint, so the variant morph never paints
    // an un-decorated (collapsed) frame — kills the flavor-change layout shift.
    // setTimeout is a fallback: rAF is throttled in hidden/background tabs, so
    // this keeps the loop alive there (whichever fires first wins via `ran`).
    requestAnimationFrame(run);
    setTimeout(run, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAll);
  } else {
    applyAll();
  }

  var mo = new MutationObserver(scheduleApply);
  mo.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('resize', syncDetailsSticky);
  // buy-box height settles late (fonts/images) — re-measure after full load
  window.addEventListener('load', syncDetailsSticky);
  // accordions change the column height without a childList mutation
  document.addEventListener('toggle', syncDetailsSticky, true);
})();
