import { useEffect } from "react";
import type { ProviderAuthKey } from "@bb/host-daemon-contract";
import { Alert, AlertTitle } from "@bb/shared-ui/alert";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { ProviderAuthLoginPanel } from "./ProviderAuthLoginPanel";
import {
  clearProviderAuthAttempt,
  closeProviderAuthDialog,
  openProviderAuthDialog,
} from "./provider-auth-login-store";
import { closeProviderAuthMobileView } from "./provider-auth-mobile-view-store";
import {
  findProviderAuthStatus,
  selectCurrentProviderAuthSession,
} from "./provider-auth-model";
import { useProviderAuthSurface } from "./useProviderAuthSurface";

/**
 * Owns provider re-authentication for the whole app.
 *
 * Mounted once by the app shell, above the routed page, so a signed-out provider
 * is stated wherever the user happens to be and a login started from one page
 * keeps running when they navigate to another. It is also the only subscriber
 * that is always mounted, which is what keeps the status poll alive after the
 * last alert clears.
 *
 * On a compact viewport it renders nothing: the mobile Command Center owns that
 * surface, because a modal is the wrong shape for a phone-sized login.
 */
export function ProviderAuthHost() {
  const isCompactViewport = useIsCompactViewport();
  const { attention, hostId, login, snapshot } = useProviderAuthSurface();
  const dialogProvider = login.dialogProvider;

  // Exactly one surface owns the login at a time. Rotating the device hands it
  // over rather than leaving an orphaned dialog or view behind.
  useEffect(() => {
    if (isCompactViewport) {
      closeProviderAuthDialog();
      return;
    }
    closeProviderAuthMobileView();
  }, [isCompactViewport]);

  const dialogStatus =
    dialogProvider === null
      ? null
      : findProviderAuthStatus(snapshot, dialogProvider);

  /**
   * Closing the dialog leaves the login alone — it runs on the host, and the
   * code already typed must still be there on reopen. Only a finished, signed-in
   * attempt is dropped, so the next sign-out starts from a clean field.
   */
  const handleDialogClose = (provider: ProviderAuthKey) => {
    closeProviderAuthDialog();
    if (findProviderAuthStatus(snapshot, provider)?.state === "loggedIn") {
      clearProviderAuthAttempt(provider);
    }
  };

  if (isCompactViewport || hostId === null) {
    return null;
  }

  return (
    <>
      {attention.length === 0 ? null : (
        <div className="mx-auto flex w-full max-w-xl shrink-0 flex-col gap-2 pb-4">
          {attention.map(({ provider, status }) => (
            <Alert
              key={provider}
              data-testid={`provider-auth-alert-${provider}`}
              className="flex items-center gap-3 border-warning/40 bg-warning/10 text-warning-text"
            >
              {/* Wrapped so Alert's `[&>svg]` absolute-positioning rules,
                  written for its icon-in-the-corner layout, leave this row
                  alone. */}
              <span className="flex shrink-0">
                <Icon name="AlertTriangle" className="size-4" aria-hidden />
              </span>
              <AlertTitle className="mb-0 min-w-0 flex-1 truncate text-sm">
                {status.displayName} is signed out
              </AlertTitle>
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                onClick={() => openProviderAuthDialog(provider)}
              >
                Log in
              </Button>
            </Alert>
          ))}
        </div>
      )}

      {/* Kept outside the alert list on purpose: a login that succeeds removes
          its alert, and the dialog must stay open to confirm the account. */}
      {dialogProvider === null || dialogStatus === null ? null : (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              handleDialogClose(dialogProvider);
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Log in to {dialogStatus.displayName}</DialogTitle>
            </DialogHeader>
            <ProviderAuthLoginPanel
              doneLabel="Done"
              entry={login.entries[dialogProvider]}
              hostId={hostId}
              provider={dialogProvider}
              session={selectCurrentProviderAuthSession(
                snapshot,
                dialogProvider,
              )}
              status={dialogStatus}
              onDone={() => handleDialogClose(dialogProvider)}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
