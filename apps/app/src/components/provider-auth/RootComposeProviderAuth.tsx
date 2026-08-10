import { useEffect, useRef } from "react";
import type {
  ProviderAuthKey,
  ProviderAuthSession,
  ProviderAuthStatus,
} from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { ProviderAuthLoginPanel } from "./ProviderAuthLoginPanel";
import {
  clearProviderAuthAttempt,
  closeProviderAuthMobileView,
  openProviderAuthMobileView,
  type ProviderAuthLoginEntry,
} from "./provider-auth-login-store";
import {
  findProviderAuthStatus,
  selectCurrentProviderAuthSession,
  type ProviderAuthAttention,
} from "./provider-auth-model";
import { useProviderAuthSurface } from "./useProviderAuthSurface";

interface MobileProviderAuthLoginView {
  entry: ProviderAuthLoginEntry;
  hostId: string;
  provider: ProviderAuthKey;
  session: ProviderAuthSession | null;
  status: ProviderAuthStatus;
}

interface MobileProviderAuthState {
  attention: ProviderAuthAttention[];
  loginView: MobileProviderAuthLoginView | null;
}

function useMobileProviderAuthState(): MobileProviderAuthState {
  const isCompactViewport = useIsCompactViewport();
  const { attention, hostId, login, snapshot } = useProviderAuthSurface();
  const provider = login.mobileProvider;
  const status =
    provider === null ? null : findProviderAuthStatus(snapshot, provider);

  if (!isCompactViewport || hostId === null) {
    return { attention: [], loginView: null };
  }
  return {
    attention,
    loginView:
      provider === null || status === null
        ? null
        : {
            entry: login.entries[provider],
            hostId,
            provider,
            session: selectCurrentProviderAuthSession(snapshot, provider),
            status,
          },
  };
}

/**
 * True while the Command Center is showing a provider login instead of its
 * sessions and composer. Read by the root compose page so the login owns the
 * screen — a phone has no room for both.
 */
export function useRootComposeProviderAuthLoginOpen(): boolean {
  return useMobileProviderAuthState().loginView !== null;
}

/**
 * Provider re-authentication inside the mobile Command Center.
 *
 * Signed-out providers appear as their own "Needs attention" items above
 * Sessions and outside the session filters: they are not sessions, so no filter
 * or search may ever hide them. Each item opens this surface's own login view,
 * which the host daemon keeps running even after the view closes.
 */
export function RootComposeProviderAuth() {
  const { attention, loginView } = useMobileProviderAuthState();

  if (loginView !== null) {
    return <MobileProviderAuthLogin {...loginView} />;
  }
  if (attention.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="root-compose-provider-auth"
      className="flex flex-col gap-1"
      data-testid="root-compose-provider-auth"
    >
      <h2
        id="root-compose-provider-auth"
        className="px-1 text-sm font-medium text-warning-text"
      >
        Needs attention
      </h2>
      <ul className="flex flex-col">
        {attention.map(({ provider, status }) => (
          <li key={provider}>
            <div className="flex min-h-14 items-center gap-3 rounded-lg px-3 py-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-raised text-warning-text">
                <Icon name="AlertTriangle" className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {status.displayName} is signed out
              </span>
              <Button
                type="button"
                size="sm"
                className="min-h-11 shrink-0"
                data-provider-auth-trigger={provider}
                onClick={() => openProviderAuthMobileView(provider)}
              >
                Log in
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MobileProviderAuthLogin({
  entry,
  hostId,
  provider,
  session,
  status,
}: MobileProviderAuthLoginView) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The view replaces the Command Center's content, so move focus with it.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  /**
   * Leaving the view leaves the login alone — it runs on the host, and the code
   * already typed must still be there on return. Only a finished, signed-in
   * attempt is dropped, so the next sign-out starts from a clean field.
   */
  const leave = () => {
    closeProviderAuthMobileView();
    if (status.state === "loggedIn") {
      clearProviderAuthAttempt(provider);
    }
    window.requestAnimationFrame(() => {
      const target =
        document.querySelector<HTMLElement>(
          `[data-provider-auth-trigger="${provider}"]`,
        ) ??
        document.querySelector<HTMLElement>(
          '[data-testid="compact-command-center-intro"]',
        );
      target?.focus();
    });
  };

  return (
    <section
      aria-labelledby="root-compose-provider-auth-login"
      className="flex flex-col gap-4"
      data-testid="root-compose-provider-auth-login"
    >
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 min-h-11 shrink-0 px-2 text-muted-foreground"
          onClick={leave}
        >
          <Icon name="ChevronLeft" aria-hidden />
          Command Center
        </Button>
      </div>
      <h2
        ref={headingRef}
        id="root-compose-provider-auth-login"
        tabIndex={-1}
        className="px-1 text-sm font-medium focus-visible:outline-none"
      >
        Log in to {status.displayName}
      </h2>
      <div className="px-1">
        <ProviderAuthLoginPanel
          doneLabel="Return to Command Center"
          entry={entry}
          hostId={hostId}
          provider={provider}
          session={session}
          status={status}
          onDone={leave}
        />
      </div>
    </section>
  );
}
