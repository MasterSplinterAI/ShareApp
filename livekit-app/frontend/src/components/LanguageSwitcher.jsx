import { Check, Globe } from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { loadLocaleMessages } from '../lib/i18n/loadLocale';
import { SUPPORTED_LOCALES } from '../lib/i18n/constants';
import { useTranslation } from '../lib/i18n/I18nProvider';
import { cn } from '../lib/utils';

/**
 * Site-wide locale switcher. Prefetches bundles on hover for snappy switches.
 */
export function LanguageSwitcher({ className, compact = false }) {
  const { locale, setLocale, t } = useTranslation();
  const current = SUPPORTED_LOCALES.find((l) => l.code === locale) || SUPPORTED_LOCALES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? 'icon' : 'sm'}
          className={cn('shrink-0 gap-1.5', className)}
          aria-label={t('language.choose')}
        >
          <Globe className="h-4 w-4 shrink-0" />
          {!compact && (
            <span className="hidden max-w-[7rem] truncate sm:inline">{current.nativeLabel}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{t('language.label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SUPPORTED_LOCALES.map((item) => (
          <DropdownMenuItem
            key={item.code}
            onSelect={() => setLocale(item.code)}
            onFocus={() => {
              if (item.code !== locale) loadLocaleMessages(item.code);
            }}
            onMouseEnter={() => {
              if (item.code !== locale) loadLocaleMessages(item.code);
            }}
            className="flex items-center justify-between gap-2"
          >
            <span>
              <span className="font-medium">{item.nativeLabel}</span>
              {item.nativeLabel !== item.label && (
                <span className="ml-1.5 text-xs text-muted-foreground">{item.label}</span>
              )}
            </span>
            {locale === item.code && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
