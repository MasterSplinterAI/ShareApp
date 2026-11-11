import assert from "node:assert/strict";
import { it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SupportOpsConsole } from "./SupportOpsConsole.js";

it("standalone console has no portfolio selector or invented integration claims", () => {
  const html = renderToStaticMarkup(<SupportOpsConsole apiBase="/support" />);
  assert.doesNotMatch(html, /support-tenant-switcher|All Apps|LexIt|metalARB|Telegram sync/i);
});
it("portfolio controls use only explicit host registry labels and can be hidden", () => {
  const props = {apiBase: "/support", tenants: [{id: "business-1", label: "Registry business"}], selectedTenantId: "business-1"};
  assert.match(renderToStaticMarkup(<SupportOpsConsole {...props} />), /Registry business/);
  assert.doesNotMatch(renderToStaticMarkup(<SupportOpsConsole {...props} hideTenantSelector />), /support-tenant-switcher/);
});
