import React from 'react';
import ReactDOM from 'react-dom/client';
import LaliaSupportLauncher from './v2/components/LaliaSupportLauncher';

function mountMarketingSupport() {
  if (typeof document === 'undefined' || !document.body) return;
  if (document.getElementById('lalia-marketing-support-root')) return;
  const container = document.createElement('div');
  container.id = 'lalia-marketing-support-root';
  container.setAttribute('data-no-translate', 'true');
  document.body.appendChild(container);
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <LaliaSupportLauncher audience="public" />
    </React.StrictMode>
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountMarketingSupport, { once: true });
} else {
  mountMarketingSupport();
}
