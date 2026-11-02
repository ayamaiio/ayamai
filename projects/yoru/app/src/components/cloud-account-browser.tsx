import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Folder, FileImage } from "lucide-react";
import {
  useListCloudAccounts, useAuthorizeCloudAccount, useDisconnectCloudAccount,
  useBrowseCloudEntries, usePreviewCloudSelection, getListCloudAccountsQueryKey, getListImportJobsQueryKey,
} from "@workspace/api-client-react";
import type { CloudEntry, ImportJob } from "@workspace/api-client-react";

type Provider = "drive" | "dropbox";
const names = { drive: "Google Drive", dropbox: "Dropbox" };
const button = "rounded-lg bg-secondary px-3 py-2 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-40";
function message(error: unknown) {
  const data = (error as { data?: { error?: string } } | null)?.data;
  return data?.error ?? "The cloud request could not be completed. Please try again.";
}

export function CloudAccountBrowser({ onPreview }: { onPreview: (job: ImportJob) => void }) {
  const [provider, setProvider] = useState<Provider>("drive");
  const accounts = useListCloudAccounts({ query: { staleTime: 0, refetchInterval: 3000, refetchOnWindowFocus: true } });
  const account = accounts.data?.find((item) => item.provider === provider);
  return <section className="mt-5 rounded-md border border-border p-3" aria-label="Connected cloud folders" data-testid="cloud-account-browser">
    <h3 className="text-xs font-bold uppercase tracking-[.1em] text-foreground/80">Import folders from your account</h3>
    <div className="mt-3 flex gap-2" aria-label="Cloud provider">
      {(["drive", "dropbox"] as const).map((p) => <button key={p} type="button" onClick={() => setProvider(p)} aria-pressed={provider === p}
        className={`${button} ${provider === p ? "ring-1 ring-primary" : ""}`}>{names[p]}</button>)}
    </div>
    <p className="mt-3 text-[11px] leading-4 text-muted-foreground">Connecting grants read-only access to files your account can access, not only the selection. Only media you confirm is copied. Credentials stay on the server. Up to 200 media files, 50 GB total, and 5 GB per file.</p>
    {accounts.isPending ? <p className="mt-3 text-xs text-muted-foreground" role="status">Checking connections…</p>
      : accounts.isError ? <div role="alert" className="mt-3 text-xs text-destructive">Could not load connections. <button type="button" className={button} onClick={() => void accounts.refetch()}>Retry</button></div>
      : account && <ProviderBrowser key={`${provider}:${account.connected}`} provider={provider} configured={account.configured} connected={account.connected} onPreview={onPreview} />}
  </section>;
}

function ProviderBrowser({ provider, configured, connected, onPreview }: {
  provider: Provider; configured: boolean; connected: boolean; onPreview: (job: ImportJob) => void;
}) {
  const client = useQueryClient();
  const authorize = useAuthorizeCloudAccount();
  const disconnect = useDisconnectCloudAccount();
  const preview = usePreviewCloudSelection();
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [selection, setSelection] = useState<Map<string, CloudEntry>>(new Map());
  const folder = path.at(-1)?.id ?? "";
  const listing = useBrowseCloudEntries(provider, { folder, cursor: cursors.at(-1) }, {
    query: { enabled: connected, staleTime: 0, refetchOnMount: "always" },
  });
  const busy = authorize.isPending || disconnect.isPending || preview.isPending;

  async function connect() {
    if (lock.current) return;
    lock.current = true;
    setError(""); setNotice("");
    setSelection(new Map()); setPath([]); setCursors([undefined]);
    // Open synchronously so popup blockers do not mistake the OAuth tab for an ad.
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try {
      const result = await authorize.mutateAsync({ provider });
      if (popup) popup.location.href = result.url;
      else { setError("Your browser blocked the authorization tab. Allow popups for this app and press Connect again."); return; }
      setNotice("Finish authorization in the new tab, then return here. Connection status updates automatically.");
    } catch (err) { popup?.close(); setError(message(err)); }
    finally { lock.current = false; }
  }
  async function removeConnection() {
    if (lock.current || !window.confirm("Disconnect this account? Pending imports from it will stop. Already imported files will remain in your library.")) return;
    lock.current = true;
    setError("");
    try {
      await disconnect.mutateAsync({ provider });
      setPath([]); setCursors([undefined]); setSelection(new Map()); setNotice("");
      client.removeQueries({ queryKey: [`/api/imports/accounts/${provider}/entries`] });
      await Promise.all([
        client.invalidateQueries({ queryKey: getListCloudAccountsQueryKey() }),
        client.invalidateQueries({ queryKey: getListImportJobsQueryKey() }),
      ]);
    } catch (err) { setError(message(err)); }
    finally { lock.current = false; }
  }
  async function makePreview() {
    if (lock.current || !selection.size) return;
    lock.current = true; setError("");
    try {
      const job = await preview.mutateAsync({ provider, data: { ids: [...selection.keys()] } });
      await client.invalidateQueries({ queryKey: getListImportJobsQueryKey() });
      onPreview(job);
      setSelection(new Map());
    } catch (err) { setError(message(err)); }
    finally { lock.current = false; }
  }
  function toggle(entry: CloudEntry) {
    setSelection((current) => {
      const next = new Map(current);
      if (next.has(entry.id)) next.delete(entry.id);
      else if (next.size < 200) next.set(entry.id, entry);
      return next;
    });
  }
  function navigate(next: typeof path) { setPath(next); setCursors([undefined]); setError(""); }

  return <div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" className={button} disabled={!configured || busy} onClick={connect}>
        {authorize.isPending ? "Opening…" : connected ? "Reconnect" : `Connect ${names[provider]}`}
      </button>
      {connected && <button type="button" className={button} disabled={busy} onClick={removeConnection}>{disconnect.isPending ? "Disconnecting…" : "Disconnect"}</button>}
    </div>
    {!configured && <p className="mt-2 text-xs text-muted-foreground" role="status">{names[provider]} account folders are unavailable for now. Account authorization can be set up later. Shared file links still work below.</p>}
    {notice && !connected && <p className="mt-2 text-xs text-foreground/80" role="status">{notice}</p>}
    {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
    {connected && <div className="mt-3">
      <nav className="flex flex-wrap items-center gap-1 text-xs text-accent-foreground" aria-label="Folder breadcrumbs">
        <button type="button" disabled={busy} onClick={() => navigate([])}>My files</button>
        {path.map((part, index) => <span key={part.id} className="flex items-center gap-1"><ChevronRight size={12} /><button type="button" disabled={busy} onClick={() => navigate(path.slice(0, index + 1))}>{part.name}</button></span>)}
      </nav>
      {listing.isPending ? <p className="py-4 text-xs text-muted-foreground" role="status">Loading folders…</p>
        : listing.isError ? <div className="py-3 text-xs text-destructive" role="alert">{message(listing.error)} <button type="button" className={button} onClick={() => void listing.refetch()}>Retry listing</button></div>
        : <ul className="mt-2 max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {!listing.data?.entries.length && <li className="p-3 text-xs text-muted-foreground">No folders or supported media on this page.</li>}
          {listing.data?.entries.map((entry) => <li key={entry.id} className="flex items-center gap-2 px-3 py-2 text-xs">
            <input type="checkbox" aria-label={`Select ${entry.name}`} checked={selection.has(entry.id)} disabled={busy || (!selection.has(entry.id) && selection.size >= 200)} onChange={() => toggle(entry)} className="h-4 w-4 accent-primary" />
            {entry.folder ? <Folder size={15} className="shrink-0 text-accent-foreground" /> : <FileImage size={15} className="shrink-0 text-muted-foreground" />}
            {entry.folder ? <button type="button" className="min-w-0 flex-1 truncate py-1 text-left text-accent-foreground" disabled={busy} onClick={() => navigate([...path, { id: entry.id, name: entry.name }])}>{entry.name} /</button>
              : <span className="min-w-0 flex-1 truncate text-foreground" title={entry.name}>{entry.name}</span>}
          </li>)}
        </ul>}
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <button type="button" className={button} disabled={cursors.length <= 1 || busy || listing.isFetching} onClick={() => setCursors((current) => current.slice(0, -1))}>Previous page</button>
        <button type="button" className={button} disabled={!listing.data?.cursor || busy || listing.isFetching} onClick={() => setCursors((current) => [...current, listing.data?.cursor ?? undefined])}>Next page</button>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">{selection.size} selected across folders. Selecting a folder includes media in all its subfolders. Preview checks the full selection against the limits before importing.</p>
      <div className="mt-2 flex gap-2">
        <button type="button" className={button} disabled={!selection.size || busy} onClick={makePreview}>{preview.isPending ? "Reading folders…" : "Preview selection"}</button>
        <button type="button" className={button} disabled={!selection.size || busy} onClick={() => setSelection(new Map())}>Clear selection</button>
      </div>
    </div>}
  </div>;
}
