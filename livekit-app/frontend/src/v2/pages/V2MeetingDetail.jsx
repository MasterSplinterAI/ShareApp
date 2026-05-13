import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Meetings, v2Host, v2Auth } from '../../services/apiV2';
import { getMeetingUiState } from '../lib/meetingState';
import { getMeetingLanguages, normalizeMeetingLanguageCode } from '../../lib/languages';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import MeetingHeader from '../components/MeetingHeader';
import MeetingJoinCard from '../components/MeetingJoinCard';
import MeetingPresenceCard from '../components/MeetingPresenceCard';
import MeetingAccessPanel from '../components/MeetingAccessPanel';
import MeetingInvitesPanel from '../components/MeetingInvitesPanel';
import MeetingTranscriptPanel from '../components/MeetingTranscriptPanel';
import MeetingDangerPanel from '../components/MeetingDangerPanel';

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

  const onTitleBlur = async () => {
    if (!meeting || !titleEdit.trim()) return;
    if (titleEdit.trim() === (meeting.title || '').trim()) return;
    try {
      await v2Meetings.patch(id, { title: titleEdit.trim() });
      toast.success('Title saved');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed');
      setTitleEdit(meeting.title || '');
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
  const isScheduled = Boolean(meeting.scheduled_start);
  const showPresence = ['live', 'scheduled'].includes(meeting.status);

  const accessPanelProps = {
    meeting,
    titleEdit,
    setTitleEdit,
    onTitleBlur,
    policy,
    onPatchPolicy: patchPolicy,
    canManageTranscriptPolicy,
    guestUrlNeedsToken,
    onCopyGuestUrl: copyGuestUrl,
  };

  const invitesPanelProps = {
    meeting,
    newInviteHours,
    setNewInviteHours,
    newInviteReusable,
    setNewInviteReusable,
    maxInviteHours,
    onCreateInvite: createInvite,
    onRevokeInvite: revokeInvite,
    onCopyInviteUrl: copyInviteUrl,
  };

  const joinCard = (
    <MeetingJoinCard
      meetingLanguages={MEETING_LANGUAGES}
      name={name}
      setName={setName}
      selectedLanguage={selectedLanguage}
      setSelectedLanguage={setSelectedLanguage}
      langOpen={langOpen}
      setLangOpen={setLangOpen}
      onJoinAsHost={joinAsHost}
    />
  );

  const dialogs = (
    <>
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
    </>
  );

  if (!isScheduled) {
    return (
      <div className="max-w-3xl space-y-8">
        <MeetingHeader meeting={meeting} ui={ui} />
        {showPresence && <MeetingPresenceCard presence={presence} />}

        <Card className="app-card border-border/60">
          <CardHeader className="border-b border-border/60 pb-3">
            <CardTitle className="text-base">Guest link</CardTitle>
            <CardDescription>Share this URL with participants. Use Advanced for policies and invite tokens.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <MeetingAccessPanel {...accessPanelProps} showTitleRow={false} showPolicyToggles={false} showGuestUrl />
          </CardContent>
        </Card>

        {joinCard}

        <Accordion type="single" collapsible className="rounded-lg border border-border/60 bg-card px-4 shadow-sm">
          <AccordionItem value="advanced" className="border-0">
            <AccordionTrigger className="text-base hover:no-underline">Advanced settings</AccordionTrigger>
            <AccordionContent className="space-y-8 pt-2">
              <MeetingAccessPanel {...accessPanelProps} showGuestUrl={false} />
              <MeetingInvitesPanel {...invitesPanelProps} />
              <MeetingTranscriptPanel
                lineCount={meeting.transcriptLineCount}
                onDownloadJson={downloadTranscriptJson}
                onDownloadTxt={downloadTranscriptTxt}
              />
              <MeetingDangerPanel
                canEndMeeting={canEndMeeting}
                ending={ending}
                onOpenEndDialog={() => setEndOpen(true)}
                onOpenArchiveDialog={() => setArchiveOpen(true)}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {dialogs}
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-screen-xl gap-8 lg:grid-cols-2">
      <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
        <MeetingHeader meeting={meeting} ui={ui} />
        {showPresence && <MeetingPresenceCard presence={presence} />}

        <Card className="app-card border-border/60">
          <CardHeader className="border-b border-border/60 pb-3">
            <CardTitle className="text-base">Overview</CardTitle>
            <CardDescription>
              {meeting.host_present === 1 ? (
                <span className="text-foreground">Host has opened this session.</span>
              ) : (
                <span>Waiting for host to join when host-gate is on.</span>
              )}
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="app-card border-border/60">
          <CardHeader className="border-b border-border/60 pb-3">
            <CardTitle className="text-base">Guest link</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <MeetingAccessPanel {...accessPanelProps} showTitleRow={false} showPolicyToggles={false} showGuestUrl />
          </CardContent>
        </Card>

        {joinCard}
      </div>

      <div className="min-w-0 space-y-6">
        <Card className="app-card border-border/60">
          <CardHeader className="border-b border-border/60 pb-3">
            <CardTitle className="text-base">Meeting setup</CardTitle>
            <CardDescription>Access, invites, recordings, and lifecycle actions.</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <Accordion type="multiple" defaultValue={['access', 'invites']} className="w-full">
              <AccordionItem value="access">
                <AccordionTrigger className="text-sm hover:no-underline">Access &amp; policy</AccordionTrigger>
                <AccordionContent>
                  <MeetingAccessPanel {...accessPanelProps} showGuestUrl={false} />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="invites">
                <AccordionTrigger className="text-sm hover:no-underline">Invite links</AccordionTrigger>
                <AccordionContent>
                  <MeetingInvitesPanel {...invitesPanelProps} />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="recordings">
                <AccordionTrigger className="text-sm hover:no-underline">Recordings &amp; transcript</AccordionTrigger>
                <AccordionContent>
                  <MeetingTranscriptPanel
                    lineCount={meeting.transcriptLineCount}
                    onDownloadJson={downloadTranscriptJson}
                    onDownloadTxt={downloadTranscriptTxt}
                  />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="danger" className="border-b-0">
                <AccordionTrigger className="text-sm hover:no-underline text-destructive">Danger zone</AccordionTrigger>
                <AccordionContent className="border-0 pb-0">
                  <MeetingDangerPanel
                    canEndMeeting={canEndMeeting}
                    ending={ending}
                    onOpenEndDialog={() => setEndOpen(true)}
                    onOpenArchiveDialog={() => setArchiveOpen(true)}
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      </div>

      {dialogs}
    </div>
  );
}
