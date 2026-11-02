import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { LibraryPreview } from "./library-preview";

const hook = vi.hoisted(() => vi.fn());
vi.mock("@workspace/api-client-react", () => ({ useGetMediaPreview: hook }));
vi.mock("@clerk/react", () => ({ useUser: () => ({ user: { id: "account-a" } }) }));

describe("Library tile previews", () => {
  it("uses the preview endpoint and a static image for every media type", () => {
    hook.mockReturnValue({ data: { status: "ready", url: "/api/media/item/preview/image?ticket=opaque" } });
    const { container } = render(<LibraryPreview id="item" visible />);
    expect(hook).toHaveBeenCalledWith("item", expect.objectContaining({
      query: expect.objectContaining({ enabled: true, queryKey: ["library-preview", "account-a", "item"] }),
    }));
    expect(screen.getByTestId("img-library-item").getAttribute("src")).toContain("/preview/image");
    expect(container.querySelector("video")).toBeNull();
  });
  it("releases offscreen image elements and disables polling", () => {
    hook.mockReturnValue({ data: { status: "ready", url: "/preview" } });
    const { rerender, container } = render(<LibraryPreview id="item" visible />);
    rerender(<LibraryPreview id="item" visible={false} />);
    expect(container.querySelector("img")).toBeNull();
    const options = hook.mock.calls.at(-1)![1].query;
    expect(options.enabled).toBe(false);
    expect(options.refetchInterval({ state: { data: { status: "pending" } } })).toBe(false);
  });
  it("keeps unavailable or broken previews clickable without requesting originals", () => {
    hook.mockReturnValue({ data: { status: "ready", url: "/broken-preview" } });
    const { container } = render(<LibraryPreview id="item" visible />);
    fireEvent.error(screen.getByTestId("img-library-item"));
    expect(screen.getByLabelText("Preview unavailable. Open to view original.")).toBeTruthy();
    expect(container.querySelector("img,video")).toBeNull();
  });
  it("polls pending work and retries unavailable previews without downloading originals", () => {
    hook.mockReturnValue({ data: { status: "pending", url: null } });
    const { container } = render(<LibraryPreview id="item" visible />);
    const options = hook.mock.calls.at(-1)![1].query;
    expect(options.refetchInterval({ state: { data: { status: "pending" } } })).toBe(3000);
    expect(options.refetchInterval({ state: { data: { status: "unavailable" } } })).toBe(120000);
    expect(container.querySelector("img,video")).toBeNull();
  });
});
