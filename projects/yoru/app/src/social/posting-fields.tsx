import { Link } from "wouter";
import { EyeOff, Globe2, UserRound, VenetianMask } from "lucide-react";
import type { SocialAccount } from "@workspace/api-client-react";
import { AdultGateForm } from "./adult-gate";
import { parseTags } from "./social-lib";
import type { PostingDraft } from "./social-lib";

const seg = (on: boolean) => `flex items-center justify-center gap-2 rounded-md border px-3 py-3 text-sm font-semibold transition disabled:opacity-50 ${on ? "border-primary bg-primary/15 text-foreground" : "border-border bg-secondary text-foreground/80 hover:text-foreground"}`;

export function PostingFields({ draft, onChange, account, disabled, idPrefix }: {
  draft: PostingDraft;
  onChange: (next: PostingDraft) => void;
  account: SocialAccount | undefined;
  disabled?: boolean;
  idPrefix: string;
}) {
  const set = (patch: Partial<PostingDraft>) => onChange({ ...draft, ...patch });
  const tags = parseTags(draft.tagText);
  const isPublic = draft.visibility === "public";
  return <fieldset className="mt-5 rounded-md border border-border bg-secondary p-4" disabled={disabled} data-testid={`${idPrefix}-posting`}>
    <legend className="px-1 text-xs font-bold uppercase tracking-[.1em] text-foreground/80">Who sees this</legend>
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Visibility">
      <button type="button" role="radio" aria-checked={isPublic} onClick={() => set({ visibility: "public" })} className={seg(isPublic)} data-testid={`${idPrefix}-visibility-public`}><Globe2 size={16} /> Public</button>
      <button type="button" role="radio" aria-checked={!isPublic} onClick={() => set({ visibility: "private", rightsConfirmed: false })} className={seg(!isPublic)} data-testid={`${idPrefix}-visibility-private`}><EyeOff size={16} /> Private</button>
    </div>
    <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{isPublic ? "Shown in the shared Watch feed to signed-in adults." : "Only you. Never appears in any shared feed or profile."}</p>
    {isPublic && account && !account.adultAccepted && <div className="mt-4 rounded-md border border-primary/30 bg-primary/[.06] p-3"><p className="text-xs font-semibold text-warning">Before posting publicly</p><AdultGateForm compact /></div>}
    {isPublic && <>
      <p className="mt-4 text-xs font-bold uppercase tracking-[.1em] text-foreground/80">Post as</p>
      <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Attribution">
        <button type="button" role="radio" aria-checked={draft.attribution === "anonymous"} onClick={() => set({ attribution: "anonymous" })} className={seg(draft.attribution === "anonymous")} data-testid={`${idPrefix}-attribution-anonymous`}><VenetianMask size={16} /> Anonymous</button>
        <button type="button" role="radio" aria-checked={draft.attribution === "profile"} disabled={!account?.profile} onClick={() => set({ attribution: "profile" })} className={seg(draft.attribution === "profile")} data-testid={`${idPrefix}-attribution-profile`}><UserRound size={16} /> <span className="truncate">{account?.profile ? `@${account.profile.handle}` : "Profile"}</span></button>
      </div>
      {!account?.profile && <p className="mt-1.5 text-[11px] text-muted-foreground">No pseudonym yet. <Link href="/account" className="font-semibold text-accent-foreground">Create one</Link> to post under a name.</p>}
    </>}
    <label htmlFor={`${idPrefix}-description`} className="mt-4 block text-xs font-bold uppercase tracking-[.1em] text-foreground/80">Description</label>
    <textarea id={`${idPrefix}-description`} value={draft.description} maxLength={2000} rows={2} onChange={(e) => set({ description: e.target.value })} placeholder="Optional" className="mt-2 w-full resize-none rounded-md border border-border bg-background/25 px-4 py-3 text-sm text-foreground outline-none focus:border-primary" data-testid={`${idPrefix}-input-description`} />
    <label htmlFor={`${idPrefix}-tags`} className="mt-3 block text-xs font-bold uppercase tracking-[.1em] text-foreground/80">Tags</label>
    <input id={`${idPrefix}-tags`} value={draft.tagText} onChange={(e) => set({ tagText: e.target.value })} placeholder="Comma separated, up to 15" className="mt-2 w-full rounded-md border border-border bg-background/25 px-4 py-3 text-sm text-foreground outline-none focus:border-primary" data-testid={`${idPrefix}-input-tags`} />
    {tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{tags.map((t) => <span key={t} className="rounded-md bg-secondary px-2 py-0.5 text-[11px] text-foreground/80">#{t}</span>)}</div>}
    {isPublic && <label className="mt-4 flex gap-3 rounded-md border border-border bg-background/20 p-3 text-xs leading-5 text-foreground/80">
      <input type="checkbox" checked={draft.rightsConfirmed} onChange={(e) => set({ rightsConfirmed: e.target.checked })} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" data-testid={`${idPrefix}-checkbox-rights`} />
      <span>I own this or have the rights to share it, every person or character shown (including illustrated ones) is an adult, and everyone real who appears consented to it being shared publicly. Nothing illegal, exploitative or stolen.</span>
    </label>}
  </fieldset>;
}
