(() => {
  const root = document.documentElement;
  const bar = document.querySelector('.lp-preview');
  if (!bar) return;

  const route = location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
  bar.querySelectorAll('[data-route]').forEach((a) => {
    const r = a.dataset.route;
    if (route === r || (r === '/preview/blog' && route.startsWith('/preview/blog/'))) a.setAttribute('aria-current', 'page');
  });

  const buttons = bar.querySelectorAll('[data-palette-set]');
  const sync = () => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.paletteSet === root.dataset.palette)));
  buttons.forEach((b) => b.addEventListener('click', () => {
    root.dataset.palette = b.dataset.paletteSet;
    try { localStorage.setItem('lalia-preview-palette', root.dataset.palette); } catch (e) {}
    const url = new URL(location.href);
    if (url.searchParams.has('palette')) { url.searchParams.delete('palette'); history.replaceState(null, '', url); }
    sync();
  }));
  sync();

  const setHidden = (hidden) => {
    bar.hidden = hidden;
    try { sessionStorage.setItem('lalia-preview-bar', hidden ? 'hidden' : 'shown'); } catch (e) {}
  };
  try { if (sessionStorage.getItem('lalia-preview-bar') === 'hidden') bar.hidden = true; } catch (e) {}
  bar.querySelector('.lp-preview-close').addEventListener('click', () => setHidden(true));
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'p' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
    setHidden(!bar.hidden);
  });
})();
