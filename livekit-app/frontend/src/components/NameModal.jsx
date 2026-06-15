import { useState } from 'react';
import { Globe } from 'lucide-react';
import { normalizeMeetingLanguageCode, readStoredMeetingLanguage } from '../lib/languages';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { MeetingLanguagePicker } from './MeetingLanguagePicker';

function NameModal({ onClose, onSubmit, title = 'Enter your name', subtitle = '', showLanguageSelector = false, defaultLanguage = 'en' }) {
  const [name, setName] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState(() =>
    normalizeMeetingLanguageCode(defaultLanguage || readStoredMeetingLanguage())
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim(), selectedLanguage, selectedLanguage);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto border-border/80 bg-card" data-no-translate="true">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {subtitle ? <DialogDescription>{subtitle}</DialogDescription> : null}
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nm-name">Display name</Label>
            <Input id="nm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus required />
          </div>
          {showLanguageSelector && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Globe className="h-3.5 w-3.5" />
                My language (speak &amp; hear)
              </Label>
              <MeetingLanguagePicker value={selectedLanguage} onChange={setSelectedLanguage} align="start" />
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Continue</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default NameModal;
