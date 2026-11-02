import { useEffect, useState, type ReactNode } from "react";

const localUser = {
  id: "local-dev-founder",
  firstName: "Itachi",
  lastName: "",
  fullName: "Itachi",
  username: "itachi",
  imageUrl: "",
  primaryEmailAddressId: "local-dev-email",
  primaryEmailAddress: {
    id: "local-dev-email",
    emailAddress: "itachi@ayamai.io",
    verification: { status: "verified" },
  },
  emailAddresses: [{
    id: "local-dev-email",
    emailAddress: "itachi@ayamai.io",
    verification: { status: "verified" },
  }],
  publicMetadata: {},
  unsafeMetadata: {},
};

function LocalFounderGate({ children }: { children?: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  async function startSession() {
    setFailed(false);
    try {
      const response = await fetch("/api/dev-auth/session", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Local session unavailable");
      setReady(true);
    } catch {
      setFailed(true);
    }
  }

  useEffect(() => { void startSession(); }, []);
  if (ready) return children;
  return <main className="grid min-h-[100dvh] place-items-center bg-background p-6 text-foreground" aria-busy={!failed}>
    <section className="max-w-sm text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {failed ? "Local session unavailable" : "Starting local session"}
      </p>
      {failed && <button className="mt-4 rounded border px-3 py-2 text-sm" onClick={() => void startSession()}>Retry</button>}
    </section>
  </main>;
}

export function ClerkProvider({ children }: { children?: ReactNode }) {
  return <LocalFounderGate>{children}</LocalFounderGate>;
}

export function useUser() {
  return { isLoaded: true, isSignedIn: true, user: localUser };
}

export function useClerk() {
  return {
    signOut: async () => undefined,
    addListener: (_listener: (...args: unknown[]) => void) => () => undefined,
  };
}

export function Show({ when, children }: { when: "signed-in" | "signed-out"; children?: ReactNode }) {
  return when === "signed-in" ? children : null;
}

export function SignIn() {
  return <p className="rounded border border-border p-4 text-sm text-muted-foreground">Switch AYAMAI_DEV_AUTH_MODE to clerk to test sign-in.</p>;
}

export function SignUp() {
  return <p className="rounded border border-border p-4 text-sm text-muted-foreground">Switch AYAMAI_DEV_AUTH_MODE to clerk to test sign-up.</p>;
}

export function publishableKeyFromHost(_host: string, fallbackKey?: string): string {
  return fallbackKey || "local-founder";
}
