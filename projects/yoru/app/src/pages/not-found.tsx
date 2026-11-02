import { Link } from 'wouter';
import { Button } from '@workspace/ayamai-design-system/components/ui/button';
import { Brand } from '@/social/app-nav';
import { usePageTitle } from '@/lib/page-title';

export default function NotFound() {
  usePageTitle('Not found');
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-background px-4 text-foreground">
      <div className="absolute left-4 top-4"><Brand /></div>
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">404</p>
        <h1 className="mt-2 text-xl font-semibold">This page doesn’t exist.</h1>
        <p className="mt-2 text-sm text-muted-foreground">The link may be old, or the item was removed.</p>
        <Button asChild className="mt-5" data-testid="button-go-home"><Link href="/">Back to ayamai</Link></Button>
      </div>
    </div>
  );
}
