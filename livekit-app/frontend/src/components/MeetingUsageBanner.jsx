import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { v2Meetings } from '../services/apiV2';

const WARN_LEVELS = new Set(['soft_overage', 'near_hard_cap', 'hard_stopped', 'running_low', 'high']);

/**
 * Polls org usage while in a live meeting and shows a banner before hard stop.
 * Also caches the latest limit message for RoomConnectionGuard on ROOM_DELETED.
 */
export default function MeetingUsageBanner({ meetingId, isHost }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!meetingId || !isHost) return undefined;
    let cancelled = false;

    const tick = async () => {
      try {
        const data = await v2Meetings.usageStatus(meetingId);
        if (cancelled) return;
        const s = data?.status || null;
        setStatus(s);
        if (s?.hardCapMessage || s?.worstLevel) {
          const msg =
            s.hardCapMessage ||
            (s.worstLevel === 'near_hard_cap'
              ? 'This workspace is approaching its monthly usage hard limit. The meeting may end soon.'
              : s.worstLevel === 'soft_overage'
                ? 'This workspace is in soft overage. Hard stop is still enforced at 2× included minutes.'
                : s.worstLevel === 'hard_stopped'
                  ? 'This workspace has reached its monthly usage hard limit.'
                  : '');
          if (msg) {
            try {
              sessionStorage.setItem(`usage_limit_message_${meetingId}`, msg);
              sessionStorage.setItem('usage_limit_message_last', msg);
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        /* ignore poll errors */
      }
    };

    tick();
    const id = setInterval(tick, 45000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [meetingId, isHost]);

  if (!isHost || !status || status.unlimited) return null;
  const level = status.worstLevel;
  if (!WARN_LEVELS.has(level) || level === 'running_low' || level === 'high') {
    // Only show in-meeting for soft overage / near / stopped (80% is fine in sidebar)
    if (level !== 'soft_overage' && level !== 'near_hard_cap' && level !== 'hard_stopped') return null;
  }

  const meter =
    (status.translation?.pctHard || 0) > (status.meeting?.pctHard || 0) ? status.translation : status.meeting;
  let text = '';
  if (level === 'hard_stopped') {
    text = status.hardCapMessage || 'Hard usage limit reached. This meeting may end.';
  } else if (level === 'near_hard_cap') {
    text = `Approaching hard stop: ${Math.round(meter?.used || 0)} / ${Math.round(meter?.hardCap || 0)} minutes (${meter?.pctHard || 0}% of limit).`;
  } else {
    text = `In soft overage (${Math.round(meter?.used || 0)} / ${Math.round(meter?.included || 0)} included). Hard stop at ${Math.round(meter?.hardCap || 0)}. Auto-charge does not raise this limit.`;
  }

  return (
    <div
      className="flex items-start gap-2 border-b border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs text-amber-950 dark:text-amber-100"
      role="status"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-snug">{text}</p>
        <Link to="/v2/app/settings?section=billing" className="font-medium text-primary underline-offset-2 hover:underline">
          Review billing & usage
        </Link>
      </div>
    </div>
  );
}
