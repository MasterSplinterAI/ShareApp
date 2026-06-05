import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Archive, MoreHorizontal, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { v2Meetings } from '../../services/apiV2';
import { getMeetingUiState, toneToBadgeVariant } from '../lib/meetingState';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
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
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { DatetimePicker } from '../../components/ui/datetime-picker';

export default function V2MeetingsList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState('active');
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('Instant meeting');
  const [hostRequired, setHostRequired] = useState(false);
  const [storeTranscripts, setStoreTranscripts] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(undefined);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = (archived = false) => {
    setLoading(true);
    v2Meetings
      .list({ archived })
      .then((r) => setMeetings(r.meetings || []))
      .catch(() => toast.error('Failed to load meetings'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(tab === 'archived');
  }, [tab]);

  useEffect(() => {
    if (searchParams.get('create') === '1') {
      setNewTitle('Instant meeting');
      setHostRequired(false);
      setStoreTranscripts(false);
      setScheduledDate(undefined);
      setShowCreate(true);
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const openCreateModal = () => {
    setNewTitle('Instant meeting');
    setHostRequired(false);
    setStoreTranscripts(false);
    setScheduledDate(undefined);
    setShowCreate(true);
  };

  const createNow = async () => {
    try {
      const iso =
        scheduledDate instanceof Date && !Number.isNaN(scheduledDate.getTime()) ? scheduledDate.toISOString() : null;
      const m = await v2Meetings.create({
        title: newTitle.trim() || 'Meeting',
        host_required_to_start: hostRequired,
        store_transcripts: storeTranscripts,
        ...(iso ? { scheduled_start: iso } : {}),
      });
      toast.success(m.status === 'scheduled' ? 'Meeting scheduled' : 'Meeting created');
      setShowCreate(false);
      window.location.href = `/v2/app/meetings/${m.id}`;
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not create');
    }
  };

  const archiveMeeting = async (id, e) => {
    e?.preventDefault();
    e?.stopPropagation();
    try {
      await v2Meetings.patch(id, { status: 'archived' });
      toast.success('Meeting archived');
      load(tab === 'archived');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not archive');
    }
  };

  const restoreMeeting = async (id, e) => {
    e?.preventDefault();
    e?.stopPropagation();
    try {
      await v2Meetings.patch(id, { status: 'ended' });
      toast.success('Meeting restored');
      load(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not restore');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await v2Meetings.delete(pendingDelete);
      toast.success('Meeting deleted');
      setPendingDelete(null);
      load(tab === 'archived');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not delete');
    } finally {
      setDeleting(false);
    }
  };

  const meetingRow = (m) => {
    const ui = getMeetingUiState(m);
    const lineCount = Number(m.transcript_line_count) || 0;
    return (
      <li key={m.id}>
        <Card className="app-card app-card-hover border-border/70 hover:border-primary/40">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <Link to={`/v2/app/meetings/${m.id}`} className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground">{m.title || m.livekit_room_name}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {m.scheduled_start ? new Date(m.scheduled_start).toLocaleString() : new Date(m.created_at).toLocaleString()}
                {lineCount > 0 ? ` · ${lineCount} transcript lines` : ''}
              </span>
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant={toneToBadgeVariant(ui.tone)} className="text-xs uppercase tracking-wide">
                {ui.label}
              </Badge>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={(e) => e.preventDefault()}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Actions</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem asChild>
                    <Link to={`/v2/app/meetings/${m.id}`}>Open</Link>
                  </DropdownMenuItem>
                  {tab === 'active' && m.status !== 'archived' && (
                    <DropdownMenuItem onClick={(e) => archiveMeeting(m.id, e)}>
                      <Archive className="mr-2 h-4 w-4" />
                      Archive
                    </DropdownMenuItem>
                  )}
                  {tab === 'archived' && (
                    <DropdownMenuItem onClick={(e) => restoreMeeting(m.id, e)}>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Restore
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPendingDelete(m.id);
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete permanently
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardContent>
        </Card>
      </li>
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Meetings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create instant or scheduled meetings, invite guests, join as host.</p>
        </div>
        <Button onClick={openCreateModal} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          New meeting
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="archived">Archived</TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="mt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : meetings.length === 0 ? (
            <Card className="border-dashed border-border bg-muted/30 shadow-none">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No active meetings. Use &quot;New meeting&quot; above to create one.
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-2">{meetings.map(meetingRow)}</ul>
          )}
        </TabsContent>
        <TabsContent value="archived" className="mt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : meetings.length === 0 ? (
            <Card className="border-dashed border-border bg-muted/30 shadow-none">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No archived meetings. Archive a meeting from its detail page or the actions menu.
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-2">{meetings.map(meetingRow)}</ul>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create meeting</DialogTitle>
            <DialogDescription>Optional schedule, host gate, and transcript storage.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="mtitle">Title</Label>
              <Input id="mtitle" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Start time (optional)</Label>
              <p className="text-xs text-muted-foreground">Leave unset for an instant meeting.</p>
              <DatetimePicker value={scheduledDate} onChange={setScheduledDate} placeholder="Instant — add date & time to schedule" />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/40 px-3 py-3">
              <div className="space-y-0.5">
                <Label htmlFor="host-wait" className="text-sm">
                  Guests wait for host
                </Label>
                <p className="text-xs text-muted-foreground">Guests enter only after you open the session.</p>
              </div>
              <Switch id="host-wait" checked={hostRequired} onCheckedChange={setHostRequired} />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/40 px-3 py-3">
              <div className="space-y-0.5">
                <Label htmlFor="store-tr" className="text-sm">
                  Save transcript on server
                </Label>
                <p className="text-xs text-muted-foreground">Host uploads finalized captions during the meeting.</p>
              </div>
              <Switch id="store-tr" checked={storeTranscripts} onCheckedChange={setStoreTranscripts} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={createNow}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete meeting permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the meeting, invites, transcripts, and AI reports. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
