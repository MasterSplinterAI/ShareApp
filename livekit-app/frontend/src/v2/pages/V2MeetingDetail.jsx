import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ExternalLink, Copy, Shield, Users, Globe, ChevronDown, Check, PhoneOff, Radio, FileDown } from 'lucide-react';
import { v2Meetings, v2Host, v2Auth } from '../../services/apiV2';
import { getMeetingUiState, toneClasses } from '../lib/meetingState';
import { getMeetingLanguages, normalizeMeetingLanguageCode } from '../../lib/languages';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';

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
  const [endOpen, setEndOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

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

  const runArchive = async () => {
    try {
      await v2Meetings.patch(id, { status: 'archived' });
      toast.success('Archived');
      setArchiveOpen(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  const runEndMeeting = async () => {
    setEnding(true);
    try {
      await v2Host.endMeeting(id);
      toast.success('Meeting ended');
      setEndOpen(false);
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
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const policy = meeting.policy || { host_required_to_start: false, require_invite_token: false, store_transcripts: false };
  const guestUrlNeedsToken = policy.require_invite_token && meeting.joinUrl && !meeting.joinUrl.includes('?i=');
  const maxInviteHours = meeting.inviteMaxTtlHours ?? 90 * 24;
  const presence = meeting.roomPresence || { humanCount: 0, participants: [] };
  const canManageTranscriptPolicy =
    me && (meeting.host_user_id === me.user?.id || ['owner', 'admin'].includes(me.role));

  return (
    <div className="max-w-3xl space-y-8">
      <Link to="/v2/app/meetings" className="text-sm font-medium text-primary hover:underline">
        ← Meetings
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{meeting.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {ui && (
            <span className={`rounded-md border px-2 py-0.5 text-xs uppercase tracking-wide ${toneClasses(ui.tone)}`}>
              {ui.label}
            </span>
          )}
          <span className="text-muted-foreground">
            Room{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{meeting.livekit_room_name}</code>
          </span>
        </div>
        {meeting.scheduled_start && (
          <p className="text-sm text-muted-foreground">
            Scheduled: <span className="text-foreground">{new Date(meeting.scheduled_start).toLocaleString()}</span>
          </p>
        )}
      </header>

      {['live', 'scheduled'].includes(meeting.status) && (
        <Card className="border-border/80">
          <CardHeader className="border-b border-border/60 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="h-4 w-4 shrink-0 text-emerald-500" />
              In the room
            </CardTitle>
            <CardDescription>
              LiveKit snapshot (refreshes about every 12s while this meeting is scheduled or live). Agents are not listed.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {presence.humanCount === 0 ? (
              <p className="text-sm text-muted-foreground">No participants connected right now.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(presence.participants || []).map((p) => (
                  <span
                    key={p.identity}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-foreground"
                  >
                    <span className="truncate font-mono text-muted-foreground">{p.identity}</span>
                    {p.name && p.name !== p.identity && <span className="truncate text-muted-foreground">· {p.name}</span>}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-border/80">
        <CardHeader className="border-b border-border/60 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 shrink-0 text-primary" />
            Details &amp; access
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={titleEdit} onChange={(e) => setTitleEdit(e.target.value)} className="flex-1" />
            <Button type="button" variant="secondary" onClick={saveTitle} className="shrink-0">
              Save title
            </Button>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/15 px-3 py-3">
              <div>
                <Label className="text-sm">Require host before guests enter</Label>
                <p className="text-xs text-muted-foreground">Guests wait in the lobby until you join.</p>
              </div>
              <Switch checked={!!policy.host_required_to_start} onCheckedChange={(v) => patchPolicy({ host_required_to_start: v })} />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/15 px-3 py-3">
              <div>
                <Label className="text-sm">Require invite token (?i=)</Label>
                <p className="text-xs text-muted-foreground">Guests need a full invite URL when enabled.</p>
              </div>
              <Switch checked={!!policy.require_invite_token} onCheckedChange={(v) => patchPolicy({ require_invite_token: v })} />
            </div>
            {canManageTranscriptPolicy && (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/15 px-3 py-3">
                <div>
                  <Label className="text-sm">Save transcript on server</Label>
                  <p className="text-xs text-muted-foreground">Host session uploads finalized captions when enabled.</p>
                </div>
                <Switch checked={!!policy.store_transcripts} onCheckedChange={(v) => patchPolicy({ store_transcripts: v })} />
              </div>
            )}
          </div>
          {Number(meeting.transcriptLineCount || 0) > 0 && (
            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">
                Saved lines: <span className="font-medium text-foreground">{meeting.transcriptLineCount}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={downloadTranscriptJson}>
                  <FileDown className="h-3.5 w-3.5" />
                  Download JSON
                </Button>
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={downloadTranscriptTxt}>
                  <FileDown className="h-3.5 w-3.5" />
                  Download .txt
                </Button>
              </div>
            </div>
          )}
          <div>
            <Label className="text-xs text-muted-foreground">Guest join URL</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Anyone with this link can join (plus <code className="text-foreground/80">?i=</code> when invite tokens are on).
            </p>
            {guestUrlNeedsToken && (
              <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-xs text-amber-200">
                Invite tokens are required, but no active invite link was found. Create a new invite below.
              </p>
            )}
            <textarea
              readOnly
              rows={4}
              value={meeting.joinUrl || ''}
              spellCheck={false}
              className="mt-2 w-full min-h-[5.5rem] resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs break-all text-foreground"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-1" onClick={copyGuestUrl}>
                <Copy className="h-4 w-4" />
                Copy
              </Button>
              {meeting.joinUrl && (
                <Button variant="outline" size="sm" className="gap-1" asChild>
                  <a href={meeting.joinUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    Open
                  </a>
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80">
        <CardHeader className="border-b border-border/60 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 shrink-0 text-primary" />
            Invite links
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Expires in (hours)</Label>
              <Input
                type="number"
                min={1}
                max={maxInviteHours}
                className="w-28"
                value={newInviteHours}
                onChange={(e) =>
                  setNewInviteHours(Math.min(maxInviteHours, Math.max(1, Number(e.target.value) || 24)))
                }
              />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch id="reusable" checked={newInviteReusable} onCheckedChange={setNewInviteReusable} />
              <Label htmlFor="reusable" className="text-sm font-normal">
                Reusable
              </Label>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setNewInviteHours(maxInviteHours)}>
              Max length
            </Button>
            <Button type="button" onClick={createInvite}>
              New invite link
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Longest cap: {Math.round(maxInviteHours / 24)} days from link creation (<code className="text-foreground/70">V2_MAX_INVITE_TTL_DAYS</code>).
          </p>
          <ul className="space-y-3 text-sm">
            {(meeting.invites || []).map((inv) => (
              <li key={inv.id} className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-foreground">{inv.label || 'Link'}</div>
                    <div className="text-xs text-muted-foreground">
                      {inv.revoked_at ? (
                        <span className="text-destructive">Revoked</span>
                      ) : (
                        <>
                          Expires {new Date(inv.expires_at).toLocaleString()} · uses {inv.use_count}
                          {inv.reusable ? ' · reusable' : ''}
                        </>
                      )}
                    </div>
                  </div>
                  {!inv.revoked_at && (
                    <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => revokeInvite(inv.id)}>
                      Revoke
                    </Button>
                  )}
                </div>
                {inv.joinUrl ? (
                  <>
                    <textarea
                      readOnly
                      rows={4}
                      value={inv.joinUrl}
                      spellCheck={false}
                      className="w-full min-h-[5rem] resize-y rounded-md border border-input bg-background px-2 py-2 font-mono text-xs break-all"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => copyInviteUrl(inv.joinUrl)}>
                        <Copy className="h-3.5 w-3.5" />
                        Copy URL
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1" asChild>
                        <a href={inv.joinUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open
                        </a>
                      </Button>
                    </div>
                  </>
                ) : (
                  !inv.revoked_at && <p className="text-xs text-amber-600 dark:text-amber-400">No guest URL — expired or use limit reached.</p>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="text-base">Join as host</CardTitle>
          <CardDescription>
            In the meeting, use the <strong className="text-foreground">People</strong> button in the bottom bar to mute or remove participants.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="host-name">Your name</Label>
            <Input id="host-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Host display name" />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              <Globe className="h-3.5 w-3.5" />
              My language (speak &amp; hear)
            </Label>
            <Popover open={langOpen} onOpenChange={setLangOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal">
                  <span>{MEETING_LANGUAGES.find((l) => l.code === selectedLanguage)?.name || selectedLanguage}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <div className="max-h-52 overflow-y-auto py-1">
                  {MEETING_LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => {
                        setSelectedLanguage(lang.code);
                        setLangOpen(false);
                      }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                    >
                      <span>{lang.name}</span>
                      {selectedLanguage === lang.code && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <Button type="button" className="w-full" onClick={joinAsHost}>
            Join as host
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/30 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Meeting actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canEndMeeting && (
            <Button type="button" variant="destructive" className="gap-2" disabled={ending} onClick={() => setEndOpen(true)}>
              <PhoneOff className="h-4 w-4" />
              {ending ? 'Ending…' : 'End meeting for everyone'}
            </Button>
          )}
          <div>
            <Button type="button" variant="link" className="h-auto p-0 text-amber-600 dark:text-amber-400" onClick={() => setArchiveOpen(true)}>
              Archive meeting (no new joins)
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={endOpen} onOpenChange={setEndOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End meeting for everyone?</AlertDialogTitle>
            <AlertDialogDescription>
              The LiveKit room will be closed and invite links revoked. Participants will be disconnected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={runEndMeeting}>
              End meeting
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this meeting?</AlertDialogTitle>
            <AlertDialogDescription>It will be hidden from the main list. No new joins will be allowed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
