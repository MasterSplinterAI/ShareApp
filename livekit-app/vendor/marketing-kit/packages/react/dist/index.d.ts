import * as react_jsx_runtime from 'react/jsx-runtime';

interface MarketingTenantOption {
    id: string;
    label: string;
}
interface MarketingOpsConsoleProps {
    /** Base URL of the marketing router, e.g. `/marketing` or `/api/v1/marketing`. */
    apiBase: string;
    /** When provided, a tenant selector is shown and requests go to `${apiBase}/t/<tenant>`. */
    tenants?: MarketingTenantOption[];
    defaultTenantId?: string;
    /** Origin used to resolve relative media URLs per tenant (needed when the console runs on another domain). */
    assetOrigins?: Record<string, string>;
    /** Public site origin per tenant, used for "View live" links. */
    publicOrigins?: Record<string, string>;
    getAccessToken?: () => string | null | undefined;
    className?: string;
}
declare function MarketingOpsConsole(props: MarketingOpsConsoleProps): react_jsx_runtime.JSX.Element;

export { MarketingOpsConsole, type MarketingOpsConsoleProps, type MarketingTenantOption };
