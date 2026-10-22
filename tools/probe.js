(() => {
  // ---------------------------------------------------------------------------
  // Naming-agnostic feed probe.
  //
  // Hashed CSS-module class names (_contentItem_med4d_29) change on every deploy,
  // so instead of guessing classes this finds the feed *structurally*: the
  // repeated ancestor element that contains both a link and a timestamp. That
  // signature survives redesigns.
  // ---------------------------------------------------------------------------
  const TIME_RE = /^(\d+秒前|\d+分钟前|\d+小时前|\d+天前|刚刚|今天|昨天|前天|\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日|\d{4}-\d{2}-\d{2})/;
  const HASHED = /^_[A-Za-z0-9]+_[a-z0-9]{4,8}_\d+$/;   // CSS-module hash shape
  const out = { url: location.href, title: document.title, scrollH: document.documentElement.scrollHeight };

  const ownText = (e) => (e.textContent || '').trim();
  const sig = (el) => {
    const cls = String(el.className || '').split(/\s+/).filter(Boolean);
    return el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '');
  };
  const stableSig = (el) => {
    const cls = String(el.className || '').split(/\s+/).filter(Boolean).filter((c) => !HASHED.test(c));
    return el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '');
  };
  const shape = (h) => String(h || '')
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/\d{6,}/g, '<NUM>')
    .replace(/[0-9a-f]{24}/g, '<ID24>')
    .replace(/[0-9A-Za-z]{8,12}(?=\/|$|\?)/g, '<MBLOGID>')
    .replace(/\?.*$/, '?<Q>');

  // --- 1. timestamp-like leaf elements ---
  const timeEls = Array.from(document.querySelectorAll('*')).filter((e) => {
    if (e.children.length) return false;
    const t = ownText(e);
    return t.length > 0 && t.length <= 20 && TIME_RE.test(t);
  });
  out.timeElCount = timeEls.length;
  out.timeSamples = timeEls.slice(0, 6).map((e) => ({ text: ownText(e), sig: sig(e) }));

  // --- 2. which repeated ancestor holds a link + a timestamp? ---
  const tally = new Map();
  for (const te of timeEls) {
    let el = te;
    for (let up = 0; up < 8 && el; up++) {
      el = el.parentElement;
      if (!el || el === document.body) break;
      if (!el.querySelector('a[href]')) continue;
      const key = stableSig(el) + '  ::  ' + sig(el);
      const rec = tally.get(key) || { n: 0, el, tag: el.tagName, cls: String(el.className) };
      rec.n++;
      tally.set(key, rec);
    }
  }
  out.candidateContainers = Array.from(tally.entries())
    .sort((a, b) => b[1].n - a[1].n).slice(0, 6)
    .map(([k, v]) => ({ key: k, count: v.n, tag: v.tag, cls: v.cls.slice(0, 120) }));

  // --- 3. every distinct link shape on the page, with counts ---
  const links = new Map();
  for (const a of document.querySelectorAll('a[href]')) {
    const s = shape(a.getAttribute('href'));
    const rec = links.get(s) || { n: 0, sample: a.getAttribute('href'), inCandidate: false };
    rec.n++;
    links.set(s, rec);
  }
  out.linkShapes = Array.from(links.entries()).sort((a, b) => b[1].n - a[1].n).slice(0, 14)
    .map(([s, v]) => ({ shape: s, n: v.n, sample: String(v.sample).slice(0, 120) }));

  // --- 4. inspect the winning container in detail ---
  const best = out.candidateContainers[0];
  if (best && tally.size) {
    const rec = Array.from(tally.values()).sort((a, b) => b.n - a.n)[0];
    const el = rec.el;
    out.winner = { tag: rec.tag, cls: String(rec.cls).slice(0, 160) };

    const inner = Array.from(el.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));
    out.winnerLinks = Array.from(new Set(inner)).slice(0, 8);
    out.winnerLinkCount = inner.length;
    out.winnerDistinctLinks = new Set(inner).size;

    // leaf blocks with real prose = the post body
    const prose = [];
    el.querySelectorAll('*').forEach((e) => {
      if (e.children.length) return;
      const t = ownText(e);
      if (t.length > 25) prose.push({ sig: sig(e), len: t.length, text: t.slice(0, 90) });
    });
    out.winnerProseBlocks = prose.sort((a, b) => b.len - a.len).slice(0, 5);

    out.winnerAttrs = Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, String(a.value).slice(0, 70)]));
    out.winnerHTML = (el.outerHTML || '').slice(0, 4000);
  }

  // --- 5. repeated siblings => how many feed items are on the page? ---
  if (best) {
    const rec = Array.from(tally.values()).sort((a, b) => b.n - a.n)[0];
    const parent = rec.el.parentElement;
    if (parent) {
      out.itemsOnPage = Array.from(parent.children).filter((c) => c.querySelector('a[href]') && TIME_RE.test((c.textContent || '').trim().slice(0, 20)) || Array.from(c.querySelectorAll('*')).some((x) => !x.children.length && TIME_RE.test(ownText(x)))).length;
      out.parentOfWinner = sig(parent).slice(0, 120);
      out.siblingCount = parent.children.length;
    }
  }
  return out;
})()
