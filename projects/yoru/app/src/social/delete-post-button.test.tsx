import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DeletePostButton } from "./delete-post-button";

const api = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock("@workspace/api-client-react", async importOriginal => ({
  ...await importOriginal<object>(), useDeleteMedia: () => ({ mutateAsync: api.remove, isPending: false }),
}));
function mount(isOwner = true) {
  const client = new QueryClient();
  const deleted = vi.fn(), changed = vi.fn();
  render(<QueryClientProvider client={client}><DeletePostButton id="fixture" uid="viewer" isOwner={isOwner} onDeleted={deleted} onOpenChange={changed} /></QueryClientProvider>);
  return { client, deleted, changed };
}
beforeEach(() => { vi.resetAllMocks(); api.remove.mockResolvedValue(undefined); });
afterEach(cleanup);
test("never offers deletion for someone else's post", () => {
  mount(false);
  expect(screen.queryByRole("button", { name: "Delete upload" })).toBeNull();
  expect(api.remove).not.toHaveBeenCalled();
});
test("Cancel leaves the file and post untouched", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Delete upload" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(api.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(api.remove).not.toHaveBeenCalled();
});
test("only explicit permanent confirmation deletes and removes the active player", async () => {
  const { client, deleted, changed } = mount();
  client.setQueryData(["/api/social/videos", "viewer"], { items: [{ id: "fixture" }] });
  fireEvent.click(screen.getByRole("button", { name: "Delete upload" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(deleted).toHaveBeenCalledOnce());
  expect(api.remove).toHaveBeenCalledWith({ id: "fixture" });
  expect(changed).toHaveBeenLastCalledWith(false);
  await waitFor(() => expect(client.getQueryData(["/api/social/videos", "viewer"])).toEqual({ items: [] }));
  client.clear();
});
test("a failure keeps confirmation open and preserves the item for retry", async () => {
  api.remove.mockRejectedValueOnce(new Error("network"));
  const { deleted } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Delete upload" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(deleted).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(deleted).toHaveBeenCalledOnce());
});
test("an already-deleted upload is removed from stale UI instead of trapping the viewer", async () => {
  api.remove.mockRejectedValue({ status: 404 });
  const { deleted } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Delete upload" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Delete permanently" })));
  expect(deleted).toHaveBeenCalledOnce();
});
