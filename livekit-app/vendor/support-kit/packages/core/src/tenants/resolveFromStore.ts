import type { BrandConfig } from "@quill/support-shared";
import type { ResolveTenant } from "../adapters/types.js";
import type { TenantBrand, TenantStore } from "./store.js";

function brandToConfig(brand: TenantBrand | null, tenantName: string): BrandConfig {
  const name = brand?.name?.trim() || tenantName;
  const config: BrandConfig = {
    name,
    supportAgentName: brand?.supportAgentName ?? "Support",
    agentAuthorId: "support-ai",
  };
  if (brand?.accent) config.accentColor = brand.accent;
  if (brand?.signupUrl) config.signupUrl = brand.signupUrl;
  if (brand?.contactEmail) config.contactEmail = brand.contactEmail;
  return config;
}

/** Resolve ?tenant= / x-tenant-id against a persisted TenantStore. */
export function resolveTenantFromStore(store: TenantStore): ResolveTenant {
  return async (_req, requestedTenantId) => {
    const tenant = await store.getById(requestedTenantId);
    if (!tenant) return null;
    return {
      tenantId: tenant.id,
      brand: brandToConfig(tenant.brand, tenant.name),
    };
  };
}
