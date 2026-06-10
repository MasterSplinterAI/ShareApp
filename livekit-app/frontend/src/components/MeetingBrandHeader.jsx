import { DEFAULT_BRAND_ACCENT } from '../lib/meetingBranding';

/** Header block shown on guest join, waiting, and prejoin when branding is configured. */
export default function MeetingBrandHeader({ branding, meetingTitle, fallbackTitle = 'Parley' }) {
  if (!branding) return null;
  const { logoUrl, hostName, welcomeMessage, accentColor } = branding;
  const title = meetingTitle || hostName || fallbackTitle;

  return (
    <div className="mb-4 flex flex-col items-center gap-2 text-center">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt=""
          className="max-h-12 max-w-[180px] object-contain"
        />
      ) : hostName ? (
        <div
          className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-semibold text-white"
          style={{ backgroundColor: accentColor || DEFAULT_BRAND_ACCENT }}
          aria-hidden="true"
        >
          {hostName.slice(0, 1).toUpperCase()}
        </div>
      ) : null}
      {title && (
        <p className="text-sm font-medium text-foreground">{title}</p>
      )}
      {welcomeMessage && (
        <p className="max-w-sm text-xs text-muted-foreground">{welcomeMessage}</p>
      )}
    </div>
  );
}
