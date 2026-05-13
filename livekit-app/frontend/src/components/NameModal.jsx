import { useState } from 'react';
import { Globe, ChevronDown, Check } from 'lucide-react';
import { getMeetingLanguages, normalizeMeetingLanguageCode } from '../lib/languages';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

const MEETING_LANGUAGES = getMeetingLanguages();

function NameModal({ onClose, onSubmit, title = 'Enter your name', subtitle = '', showLanguageSelector = false, defaultLanguage = 'en' }) {
  const [name, setName] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState(() => normalizeMeetingLanguageCode(defaultLanguage));
  const [langOpen, setLangOpen] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim(), selectedLanguage, selectedLanguage);
      onClose();
    }
  };

  const selectedLang = MEETING_LANGUAGES.find((lang) => lang.code === selectedLanguage) || MEETING_LANGUAGES[0];

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
              <Popover open={langOpen} onOpenChange={setLangOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="w-full justify-between font-normal">
                    <span className="flex items-center gap-2">
                      <span>{selectedLang.flag}</span>
                      <span>{selectedLang.name}</span>
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <div className="max-h-[min(16rem,45dvh)] overflow-y-auto py-1">
                    {MEETING_LANGUAGES.map((language) => (
                      <button
                        key={language.code}
                        type="button"
                        onClick={() => {
                          setSelectedLanguage(language.code);
                          setLangOpen(false);
                        }}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                      >
                        <span className="flex items-center gap-2">
                          <span>{language.flag}</span>
                          <span>{language.name}</span>
                        </span>
                        {language.code === selectedLanguage && <Check className="h-4 w-4 text-primary" />}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
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
