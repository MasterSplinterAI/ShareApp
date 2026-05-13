import { Link } from 'react-router-dom';

export function MarketingFooter() {
  return (
    <footer className="border-t border-border/60 bg-muted/10 py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 text-center text-sm text-muted-foreground sm:flex-row sm:px-6 sm:text-left">
        <div>
          <p className="font-medium text-foreground">JarMetals Conference</p>
          <p className="mt-1">Video with translation, captions, and workspace controls.</p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <Link to="/v2/login" className="text-primary hover:underline">
            Sign in to workspace
          </Link>
          <p className="text-xs">Support: <span className="text-foreground">hello@jarmetals.com</span> (placeholder)</p>
        </div>
      </div>
    </footer>
  );
}
