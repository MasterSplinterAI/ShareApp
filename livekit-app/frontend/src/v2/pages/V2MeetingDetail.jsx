import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ExternalLink, Copy, Shield, Users, Globe, ChevronDown, Check } from 'lucide-react';
import { v2Meetings } from '../../services/apiV2';
import { getMeetingUiState, toneClasses } from '../lib/meetingState';
import { getMeetingLanguages, normalizeMeetingLanguageCode } from '../../lib/languages';

const MEETING_LANGUAGES = getMeetingLanguages();

export default function V2MeetingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [name, setName] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState(() => normalizeMeetingLanguageCode('en'));
  const [langOpen, setLangOpen] = useState(false);
  const [titleEdit, setTitleEdit] = useState('');
  const [newInviteHours, setNewInviteHours] = useState(72);
  const [newInviteReusable, setNewInviteReusable] = useState(false);

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

  const ui = meeting ? getMeetingUiState(meeting) : null;

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

  const joinAsHost = async () => {
    if (!name.trim()) {
      toast.error('Enter display name');
      return;
    }
    if (!meeting) return;
    try {
      await v2Meetings.hostSessionOpen(id);
      await v2Meetings.token(id, { participantName: name.trim(), isHost: true });
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

  if (!meeting) {
    return <p className="text-gray-500 text-sm">Loading…</p>;
  }

  const policy = meeting.policy || { host_required_to_start: false, require_invite_token: false };

  return (
    <div className="max-w-2xl space-y-6">
      <Link to="/v2/app/meetings" className="text-sm text-blue-400 hover:text-blue-300 inline-block">
        ← Meetings
      </Link>

      <div>
        <h1 className="text-2xl font-semibold text-white mb-2">{meeting.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {ui && (
            <span className={`rounded border px-2 py-0.5 text-xs uppercase tracking-wide ${toneClasses(ui.tone)}`}>
              {ui.label}
            </span>
          )}
          <span className="text-gray-500">
            Room <code className="text-gray-400 text-xs">{meeting.livekit_room_name}</code>
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-800/30 p-4 space-y-3">
        <h2 className="text-sm font-medium text-white flex items-center gap-2">
          <Shield className="w-4 h-4 text-blue-400" />
          Meeting details
        </h2>
        <div className="flex gap-2">
          <input
            value={titleEdit}
            onChange={(e) => setTitleEdit(e.target.value)}
            className="flex-1 rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-white text-sm"
          />
          <button type="button" onClick={saveTitle} className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white">
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
        </div>
        <button type="button" onClick={archiveMeeting} className="text-xs text-amber-500 hover:text-amber-400">
          Archive meeting
        </button>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-800/30 p-4">
        <p className="text-xs text-gray-500 mb-2">Guest join URL</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <a
            href={meeting.joinUrl}
            target="_blank"
            rel="noreferrer"
            className="text-blue-400 text-sm break-all inline-flex items-center gap-1 hover:text-blue-300 flex-1"
          >
            {meeting.joinUrl}
            <ExternalLink className="w-3 h-3 shrink-0" />
          </a>
          <button
            type="button"
            onClick={copyGuestUrl}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700"
          >
            <Copy className="w-4 h-4" />
            Copy
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-800/30 p-4 space-y-4">
        <h2 className="text-sm font-medium text-white flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-400" />
          Invite links
        </h2>
        <div className="flex flex-wrap gap-2 items-end text-sm">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Expires in (hours)</label>
            <input
              type="number"
              min={1}
              value={newInviteHours}
              onChange={(e) => setNewInviteHours(Number(e.target.value) || 24)}
              className="w-28 rounded-lg bg-gray-900 border border-gray-700 px-2 py-1.5 text-white"
            />
          </div>
          <label className="flex items-center gap-2 text-gray-300 pb-1">
            <input type="checkbox" checked={newInviteReusable} onChange={(e) => setNewInviteReusable(e.target.checked)} />
            Reusable
          </label>
          <button type="button" onClick={createInvite} className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 text-sm">
            New invite link
          </button>
        </div>
        <ul className="space-y-2 text-sm">
          {(meeting.invites || []).map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 border border-gray-700/60 rounded-lg px-3 py-2 bg-gray-900/40">
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
                <button type="button" onClick={() => revokeInvite(inv.id)} className="text-xs text-red-400 hover:text-red-300">
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-800/30 p-4 space-y-3">
        <Link to="/v2/app/host" className="text-sm text-blue-400 hover:text-blue-300 inline-block">
          Open host console →
        </Link>
        <div className="space-y-3">
          <label className="block text-xs text-gray-500">Your name (host)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white"
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
                className="w-full flex items-center justify-between rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm"
              >
                <span>{MEETING_LANGUAGES.find(l => l.code === selectedLanguage)?.name || selectedLanguage}</span>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${langOpen ? 'rotate-180' : ''}`} />
              </button>
              {langOpen && (
                <div className="absolute bottom-full left-0 mb-1 w-full max-h-52 overflow-y-auto rounded-lg bg-gray-900 border border-gray-700 shadow-xl z-30">
                  {MEETING_LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => { setSelectedLanguage(lang.code); setLangOpen(false); }}
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
        </div>
      </div>
    </div>
  );
}
