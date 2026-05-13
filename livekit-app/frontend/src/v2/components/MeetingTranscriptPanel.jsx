import { FileDown } from 'lucide-react';
import { Button } from '../../components/ui/button';

export default function MeetingTranscriptPanel({ lineCount, onDownloadJson, onDownloadTxt }) {
  if (!lineCount || lineCount <= 0) {
    return <p className="text-sm text-muted-foreground">No saved transcript lines for this meeting yet.</p>;
  }
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4">
      <p className="text-xs text-muted-foreground">
        Saved lines: <span className="font-medium text-foreground">{lineCount}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onDownloadJson}>
          <FileDown className="h-3.5 w-3.5" />
          Download JSON
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onDownloadTxt}>
          <FileDown className="h-3.5 w-3.5" />
          Download .txt
        </Button>
      </div>
    </div>
  );
}
