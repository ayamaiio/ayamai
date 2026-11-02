import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDeleteMedia } from "@workspace/api-client-react";
import { Trash2 } from "lucide-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from "@workspace/ayamai-design-system/components/ui/alert-dialog";
import { forgetDeletedMedia } from "@/lib/deleted-media";
import { errorText, isGone } from "./social-lib";

export function DeletePostButton({ id, uid, isOwner, compact = false, className, onDeleted, onOpenChange }: {
  id: string; uid: string; isOwner: boolean; compact?: boolean; className?: string;
  onDeleted?: () => void; onOpenChange?: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const remove = useDeleteMedia();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const changeOpen = (next: boolean) => {
    if (remove.isPending) return;
    setOpen(next); setError(""); onOpenChange?.(next);
  };
  const confirm = async () => {
    if (!isOwner || remove.isPending) return;
    setError("");
    try { await remove.mutateAsync({ id }); }
    catch (cause) {
      if (!isGone(cause)) { setError(errorText(cause, "Couldn’t delete this upload. Please try again.")); return; }
    }
    setOpen(false); onOpenChange?.(false);
    onDeleted?.();
    await forgetDeletedMedia(client, id, uid);
  };
  if (!isOwner) return null;
  return <AlertDialog open={open} onOpenChange={changeOpen}>
    <AlertDialogTrigger asChild>
      <Button type="button" variant="outline" size={compact ? "icon" : "sm"}
        className={className} aria-label="Delete upload" data-testid={`button-delete-post-${id}`}>
        <Trash2 size={compact ? 19 : 14} />{!compact && "Delete"}
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent onEscapeKeyDown={event => { if (remove.isPending) event.preventDefault(); }}>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete this upload permanently?</AlertDialogTitle>
        <AlertDialogDescription>This permanently deletes the upload and its stored file from your library and all shared feeds. This can’t be undone.</AlertDialogDescription>
      </AlertDialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
        <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => void confirm()}
          data-testid="button-confirm-delete-upload">{remove.isPending ? "Deleting…" : "Delete permanently"}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
