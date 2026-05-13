import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ExternalLink, Copy, Shield, Users, Globe, ChevronDown, Check, PhoneOff, Radio, FileDown } from 'lucide-react';
import { v2Meetings, v2Host, v2Auth } from '../../services/apiV2';
import { getMeetingUiState, toneClasses } from '../lib/meetingState';
import { getMeetingLanguages, normalizeMeetingLanguageCode } from '../../lib/languages';

const MEETING_LANGUAGES = getMeetingLanguages();

export default function V2MeetingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [me, setMe] = useState(null);
  const [name, setName] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState(() => normalizeMeetingLanguageCode('en'));
  const [langOpen, setLangOpen] = useState(false);
  const [titleEdit, setTitleEdit] = useState('');
  const [newInviteHours, setNewInviteHours] = useState(72);
  const [newInviteReusable, setNewInviteReusable] = useState(false);
  const [ending, setEnding] = useState(false);

  const load = () =>
    v2Meetings
      .get(id)
      .then((m) => {
        setMeeting(m);
        setTitleEdit(m.title || '');
      })
      .catch(() => {
        toast.error('Meeting not found');
        navigate('/v2/app/meetings');
      });

  useEffect(() => {
    load();
  }, [id, navigate]);

  useEffect(() => {
    v2Auth
      .me()
      .then((r) => setMe(r))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!meeting?.inviteMaxTtlHours) return;
    setNewInviteHours((h) => Math.min(Math.max(1, h), meeting.inviteMaxTtlHours));
  }, [meeting?.inviteMaxTtlHours]);

  useEffect(() => {
    if (!meeting || !['live', 'scheduled'].includes(meeting.status)) return undefined;
    const t = setInterval(() => {
      v2Meetings.get(id).then(setMeeting).catch(() => {});
    }, 12000);
    return () => clearInterval(t);
  }, [meeting?.status, id]);

  const ui = meeting ? getMeetingUiState(meeting) : null;

  const canEndMeeting =
    meeting &&
    ['live', 'scheduled'].includes(meeting.status) &&
    me &&
    (meeting.host_user_id === me.user?.id || ['owner', 'admin'].includes(me.role));

  const saveTitle = async () => {
    if (!meeting || !titleEdit.trim()) return;
    try {
      await v2Meetings.patch(id, { title: titleEdit.trim() });
      toast.success('Title saved');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const patchPolicy = async (body) => {
    try {
      await v2Meetings.patch(id, body);
      toast.success('Settings updated');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Update failed');
    }
  };

  const archiveMeeting = async () => {
    if (!window.confirm('Archive this meeting? It will stay in your list as archived.')) return;
    try {
      await v2Meetings.patch(id, { status: 'archived' });
      toast.success('Archived');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  const endMeeting = async () => {
    if (!window.confirm('End this meeting for everyone? The LiveKit room will be closed and invite links revoked.')) return;
    setEnding(true);
    try {
      await v2Host.endMeeting(id);
      toast.success('Meeting ended');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not end meeting');
    } finally {
      setEnding(false);
    }
  };

  const createInvite = async () => {
    try {
      const r = await v2Meetings.createInvite(id, {
        expiresInHours: newInviteHours,
        reusable: newInviteReusable,
        label: 'Guest link',
      });
      toast.success('Invite created');
      await navigator.clipboard.writeText(r.joinUrl);
      toast('Copied join URL to clipboard');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  const revokeInvite = async (linkId) => {
    try {
      await v2Meetings.revokeInvite(id, linkId);
      toast.success('Invite revoked');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  const copyGuestUrl = async () => {
    if (!meeting?.joinUrl) return;
    await navigator.clipboard.writeText(meeting.joinUrl);
    toast.success('Copied guest URL');
  };

  const copyInviteUrl = async (url) => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast.success('Copied invite URL');
  };

  const joinAsHost = async () => {
    if (!name.trim()) {
      toast.error('Enter display name');
      return;
    }
    if (!meeting) return;
    try {
      await v2Meetings.hostSessionOpen(id);
      const share = meeting.joinUrl || `${window.location.origin}/join/${encodeURIComponent(meeting.livekit_room_name)}`;
      const participantInfo = {
        isHost: true,
        participantName: name.trim(),
        hostCode: meeting.host_code,
        shareableLink: share,
        shareableLinkNetwork: share,
        roomName: meeting.livekit_room_name,
        meetingId: id,
        inviteToken: '',
        selectedLanguage,
        spokenLanguage: selectedLanguage,
      };
      sessionStorage.setItem('participantInfo', JSON.stringify(participantInfo));
      navigate(`/room/${encodeURIComponent(meeting.livekit_room_name)}${window.location.search || ''}`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Token failed');
    }
  };

  const downloadTranscriptJson = async () => {
    try {
      const { lines } = await v2Meetings.getTranscript(id);
      const blob = new Blob([JSON.stringify(lines, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `meeting-${id}-transcript.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Download started');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Download failed');
    }
  };

  const downloadTranscriptTxt = async () => {
    try {
      const blob = await v2Meetings.getTranscriptTxtBlob(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `meeting-${id}-transcript.txt`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Download started');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Download failed');
    }
  };

  if (!meeting) {
    return <p className="text-gray-500 text-sm">Loading…</p>;
  }

  const policy = meeting.policy || { host_required_to_start: false, require_invite_token: false, store_transcripts: false };
  const guestUrlNeedsToken = policy.require_invite_token && meeting.joinUrl && !meeting.joinUrl.includes('?i=');
  const maxInviteHours = meeting.inviteMaxTtlHours ?? 90 * 24;
  const presence = meeting.roomPresence || { humanCount: 0, participants: [] };
  const canManageTranscriptPolicy =
    me && (meeting.host_user_id === me.user?.id || ['owner', 'admin'].includes(me.role));

  return (
    <div className="max-w-3xl space-y-8">
      <Link to="/v2/app/meetings" className="text-sm text-blue-400 hover:text-blue-300 inline-block">
        ← Meetings
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">{meeting.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {ui && (
            <span className={`rounded-md border px-2 py-0.5 text-xs uppercase tracking-wide ${toneClasses(ui.tone)}`}>
              {ui.label}
            </span>
          )}
          <span className="text-gray-500">
            Room <code className="text-gray-400 text-xs bg-gray-800/80 px-1.5 py-0.5 rounded">{meeting.livekit_room_name}</code>
          </span>
        </div>
        {meeting.scheduled_start && (
          <p className="text-sm text-gray-400">
            Scheduled: <span className="text-gray-200">{new Date(meeting.scheduled_start).toLocaleString()}</span>
          </p>
        )}
      </header>

      {['live', 'scheduled'].includes(meeting.status) && (
        <section className="rounded-xl border border-gray-800 bg-gray-800/25 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2 border-b border-gray-700/80 pb-3">
            <Radio className="w-4 h-4 text-emerald-400 shrink-0" />
            In the room
          </h2>
          <p className="text-xs text-gray-500">
            LiveKit snapshot (refreshes about every 12s while this meeting is scheduled or live). Agents are not listed.
          </p>
          {presence.humanCount === 0 ? (
            <p className="text-sm text-gray-400">No participants connected right now.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(presence.participants || []).map((p) => (
                <li key={p.identity} className="flex flex-wrap items-baseline gap-2 text-gray-200 border border-gray-700/50 rounded-lg px-3 py-2 bg-gray-900/40">
                  <span className="font-mono text-xs text-gray-300">{p.identity}</span>
                  {p.name && p.name !== p.identity && <span className="text-gray-400 text-xs">({p.name})</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-xl border border-gray-800 bg-gray-800/25 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2 border-b border-gray-700/80 pb-3">
          <Shield className="w-4 h-4 text-blue-400 shrink-0" />
          Details &amp; access
        </h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={titleEdit}
            onChange={(e) => setTitleEdit(e.target.value)}
            className="flex-1 rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-white text-sm"
          />
          <button type="button" onClick={saveTitle} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white shrink-0">
            Save title
          </button>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={!!policy.host_required_to_start}
              onChange={(e) => patchPolicy({ host_required_to_start: e.target.checked })}
            />
            Require host to join before guests can enter
          </label>
          <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={!!policy.require_invite_token}
              onChange={(e) => patchPolicy({ require_invite_token: e.target.checked })}
            />
            Require invite token in URL for guests (?i=)
          </label>
          {canManageTranscriptPolicy && (
            <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={!!policy.store_transcripts}
                onChange={(e) => patchPolicy({ store_transcripts: e.target.checked })}
              />
              Save meeting transcript on server (host session uploads finalized captions when enabled)
            </label>
          )}
        </div>
        {Number(meeting.transcriptLineCount || 0) > 0 && (
          <div className="rounded-lg border border-gray-700/80 bg-gray-900/30 px-3 py-3 space-y-2">
            <p className="text-xs text-gray-400">
              Saved transcript lines: <span className="text-gray-200 font-medium">{meeting.transcriptLineCount}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={downloadTranscriptJson}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-600 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700"
              >
                <FileDown className="w-3.5 h-3.5" />
                Download JSON
              </button>
              <button
                type="button"
                onClick={downloadTranscriptTxt}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-600 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700"
              >
                <FileDown className="w-3.5 h-3.5" />
                Download .txt
              </button>
            </div>
          </div>
        )}
        <div>
          <p className="text-xs text-gray-500 mb-2">Guest join URL (full link — scroll or select to verify)</p>
          <p className="text-xs text-gray-600 mb-2">
            Anyone with this link can join (plus <code className="text-gray-500">?i=</code> when invite tokens are on). Expiry is counted from when each invite is created, not from the scheduled start time.
          </p>
          {guestUrlNeedsToken && (
            <p className="text-xs text-amber-400 mb-2 rounded-md border border-amber-800/50 bg-amber-950/30 px-2 py-1.5">
              Invite tokens are required, but no active invite link was found. Create a new invite below so guests get a valid URL with <code className="text-amber-200/90">?i=</code>.
            </p>
          )}
          <textarea
            readOnly
            rows={4}
            value={meeting.joinUrl || ''}
            spellCheck={false}
            className="w-full rounded-lg bg-gray-950 border border-gray-700 px-3 py-2 text-xs font-mono text-gray-200 break-all resize-y min-h-[5.5rem]"
          />
          <div className="flex flex-wrap gap-2 mt-2">
            <button
              type="button"
              onClick={copyGuestUrl}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 shrink-0"
            >
              <Copy className="w-4 h-4" />
              Copy
            </button>
            {meeting.joinUrl && (
              <a
                href={meeting.joinUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700"
              >
                <ExternalLink className="w-4 h-4" />
                Open
              </a>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-800/25 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2 border-b border-gray-700/80 pb-3">
          <Users className="w-4 h-4 text-blue-400 shrink-0" />
          Invite links
        </h2>
        <div className="flex flex-wrap gap-2 items-end text-sm">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Expires in (hours)</label>
            <input
              type="number"
              min={1}
              max={maxInviteHours}
              value={newInviteHours}
              onChange={(e) =>
                setNewInviteHours(Math.min(maxInviteHours, Math.max(1, Number(e.target.value) || 24)))
              }
              className="w-28 rounded-lg bg-gray-900 border border-gray-700 px-2 py-1.5 text-white"
            />
          </div>
          <label className="flex items-center gap-2 text-gray-300 pb-1">
            <input type="checkbox" checked={newInviteReusable} onChange={(e) => setNewInviteReusable(e.target.checked)} />
            Reusable
          </label>
          <button
            type="button"
            onClick={() => setNewInviteHours(maxInviteHours)}
            className="rounded-lg border border-gray-600 px-2 py-2 text-xs text-gray-300 hover:bg-gray-700"
            title={`${maxInviteHours}h (~${Math.round(maxInviteHours / 24)} days) from link creation`}
          >
            Max length
          </button>
          <button type="button" onClick={createInvite} className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 text-sm">
            New invite link
          </button>
        </div>
        <p className="text-xs text-gray-600">
          Longest allowed without a shorter custom value: {Math.round(maxInviteHours / 24)} days from when the link is created (server cap — set{' '}
          <code className="text-gray-500">V2_MAX_INVITE_TTL_DAYS</code> to change).
        </p>
        <ul className="space-y-3 text-sm">
          {(meeting.invites || []).map((inv) => (
            <li key={inv.id} className="border border-gray-700/60 rounded-lg px-3 py-3 bg-gray-900/40 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-gray-200">{inv.label || 'Link'}</div>
                  <div className="text-xs text-gray-500">
                    {inv.revoked_at ? (
                      <span className="text-red-400">Revoked</span>
                    ) : (
                      <>
                        Expires {new Date(inv.expires_at).toLocaleString()} · uses {inv.use_count}
                        {inv.reusable ? ' · reusable' : ''}
                      </>
                    )}
                  </div>
                </div>
                {!inv.revoked_at && (
                  <button type="button" onClick={() => revokeInvite(inv.id)} className="text-xs text-red-400 hover:text-red-300 shrink-0">
                    Revoke
                  </button>
                )}
              </div>
              {inv.joinUrl ? (
                <>
                  <textarea
                    readOnly
                    rows={4}
                    value={inv.joinUrl}
                    spellCheck={false}
                    className="w-full rounded-lg bg-gray-950 border border-gray-600/80 px-2 py-1.5 text-xs font-mono text-gray-200 break-all resize-y min-h-[5rem]"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => copyInviteUrl(inv.joinUrl)}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-800"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy URL
                    </button>
                    <a
                      href={inv.joinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-800"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open
                    </a>
                  </div>
                </>
              ) : (
                !inv.revoked_at && (
                  <p className="text-xs text-amber-500/90">No guest URL — expired or use limit reached.</p>
                )
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-800/25 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white border-b border-gray-700/80 pb-3">Join as host</h2>
        <p className="text-xs text-gray-500">
          In the meeting, use the <strong className="text-gray-400">People</strong> button in the bottom bar to mute or remove participants.
        </p>
        <label className="block text-xs text-gray-500">Your name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-white"
          placeholder="Host display name"
        />

        <div>
          <label className="block text-xs text-gray-500 mb-1">
            <Globe className="w-3.5 h-3.5 inline mr-1" />
            My language (speak &amp; hear)
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setLangOpen(!langOpen)}
              className="w-full flex items-center justify-between rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-white text-sm"
            >
              <span>{MEETING_LANGUAGES.find((l) => l.code === selectedLanguage)?.name || selectedLanguage}</span>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${langOpen ? 'rotate-180' : ''}`} />
            </button>
            {langOpen && (
              <div className="absolute bottom-full left-0 mb-1 w-full max-h-52 overflow-y-auto rounded-lg bg-gray-900 border border-gray-700 shadow-xl z-30">
                {MEETING_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => {
                      setSelectedLanguage(lang.code);
                      setLangOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-700 transition-colors flex items-center justify-between ${
                      selectedLanguage === lang.code ? 'bg-gray-700 text-white' : 'text-gray-300'
                    }`}
                  >
                    <span>{lang.name}</span>
                    {selectedLanguage === lang.code && <Check className="w-4 h-4 text-green-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={joinAsHost}
          className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
        >
          Join as host
        </button>
      </section>

      <section className="rounded-xl border border-red-900/30 bg-red-950/10 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-red-300">Meeting actions</h2>
        {canEndMeeting && (
          <button
            type="button"
            disabled={ending}
            onClick={endMeeting}
            className="inline-flex items-center gap-2 rounded-lg border border-red-800/60 bg-red-950/40 px-4 py-2 text-sm text-red-200 hover:bg-red-950/60 disabled:opacity-50"
          >
            <PhoneOff className="w-4 h-4" />
            {ending ? 'Ending…' : 'End meeting for everyone'}
          </button>
        )}
        <div>
          <button type="button" onClick={archiveMeeting} className="text-xs text-amber-500 hover:text-amber-400">
            Archive meeting (keep in list, no new joins)
          </button>
        </div>
      </section>
    </div>
  );
}
