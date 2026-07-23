import * as react from 'react';
import { ReactNode } from 'react';

interface SupportOpsConsoleProps {
    apiBase: string;
    className?: string;
    pollMs?: number;
    /** Bearer JWT for hosts without cookie sessions (e.g. ShareApp). */
    getAccessToken?: () => string | null | undefined;
}
declare function SupportOpsConsole(props: SupportOpsConsoleProps): react.JSX.Element;

interface SupportLauncherProps {
    apiBase: string;
    user?: {
        id: string;
        name?: string;
        email?: string;
        planLabel?: string;
    };
    brand?: {
        name: string;
        accent?: string;
        supportAgentName?: string;
        signupUrl?: string;
        contactEmail?: string;
        marketingConsentLabel?: string;
    };
    position?: "bottom-right" | "bottom-left";
    /**
     * Nudge the floating bubble so it clears host UI (e.g. a Send button
     * anchored bottom-right). Ignored in `mode="page"`.
     */
    offset?: {
        bottom?: number;
        left?: number;
        right?: number;
    };
    mode?: "bubble" | "page";
    /**
     * `public` = home / logged-out: contact gate first, then FAQ chat + Contact
     * (no bug/feature/my tickets).
     */
    audience?: "app" | "public";
    renderTrigger?: (open: () => void) => ReactNode;
    className?: string;
    /**
     * Hosts that use Bearer JWT (ShareApp) instead of cookie sessions.
     * Return the raw token; Authorization header is attached automatically.
     */
    getAccessToken?: () => string | null | undefined;
}
declare function SupportLauncher(props: SupportLauncherProps): react.JSX.Element;

export { SupportLauncher, type SupportLauncherProps, SupportOpsConsole, type SupportOpsConsoleProps };
