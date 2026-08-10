import { useEffect, useId } from "react";
import type {
  ProviderAuthKey,
  ProviderAuthSession,
  ProviderAuthStatus,
} from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Label } from "@bb/shared-ui/label";
import { CopyButton } from "@/components/ui/copy-button";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import {
  setProviderAuthCode,
  startProviderAuthLogin,
  submitProviderAuthCode,
  type ProviderAuthLoginEntry,
} from "./provider-auth-login-store";
import {
  isProviderAuthSessionActive,
  isProviderAuthSessionSettled,
} from "./provider-auth-model";

interface ProviderAuthLoginPanelProps {
  /** Label for the button that leaves the surface after a successful login. */
  doneLabel: string;
  entry: ProviderAuthLoginEntry;
  hostId: string;
  onDone: () => void;
  provider: ProviderAuthKey;
  session: ProviderAuthSession | null;
  status: ProviderAuthStatus;
}

/**
 * One provider's sign-in body, shared by the desktop dialog and the mobile
 * Command Center login view so both walk the identical handshake.
 *
 * The login itself runs on the host: this panel starts it, mirrors the phase the
 * daemon reports, and forwards the one-time code. It never asks for a password
 * or an API key — the provider's own page owns the credentials.
 */
export function ProviderAuthLoginPanel({
  doneLabel,
  entry,
  hostId,
  onDone,
  provider,
  session,
  status,
}: ProviderAuthLoginPanelProps) {
  const codeFieldId = useId();
  const isSignedIn = status.state === "loggedIn";
  const isVerifying =
    entry.pending === "submit" || session?.phase === "verifying";

  // Opening the surface is the request to sign in, so the handshake starts
  // straight away. It must not restart a running login, re-run a finished one,
  // or fight a request error the user has not acknowledged yet.
  useEffect(() => {
    if (
      isSignedIn ||
      entry.pending !== null ||
      entry.error !== null ||
      isProviderAuthSessionActive(session) ||
      isProviderAuthSessionSettled(session)
    ) {
      return;
    }
    startProviderAuthLogin({ hostId, provider });
  }, [entry.error, entry.pending, hostId, isSignedIn, provider, session]);

  const retry = () => {
    startProviderAuthLogin({ hostId, provider });
  };

  if (isSignedIn) {
    return (
      <div
        role="status"
        className="flex flex-col gap-4"
        data-testid="provider-auth-succeeded"
      >
        <div className="flex items-start gap-2">
          <Icon
            name="CircleCheck"
            className="mt-0.5 size-4 shrink-0 text-success-foreground"
            aria-hidden
          />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">
              Signed in to {status.displayName}
            </p>
            {status.accountEmail === null ? null : (
              <p className="truncate text-xs text-muted-foreground">
                {status.accountEmail}
              </p>
            )}
            {status.organizationName === null ? null : (
              <p className="truncate text-xs text-muted-foreground">
                {status.organizationName}
              </p>
            )}
          </div>
        </div>
        <Button type="button" className="min-h-11" onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
    );
  }

  if (entry.error !== null) {
    return (
      <ProviderAuthFailure
        message={entry.error}
        onRetry={retry}
        recoveryCommand={null}
      />
    );
  }

  if (isVerifying) {
    return (
      <ProviderAuthProgress
        label={`Verifying your ${status.displayName} login…`}
      />
    );
  }

  if (session === null || session.phase === "starting") {
    return (
      <ProviderAuthProgress label={`Starting ${status.displayName} login…`} />
    );
  }

  if (session.phase === "failed" || session.phase === "recoveryRequired") {
    return (
      <ProviderAuthFailure
        message={
          session.message ?? `${status.displayName} login did not finish.`
        }
        onRetry={retry}
        recoveryCommand={session.recoveryCommand}
      />
    );
  }

  const openLabel = provider === "codex" ? "Open ChatGPT" : "Open";
  const { oauthUrl, sessionId, userCode } = session;

  return (
    <div className="flex flex-col gap-4">
      {session.message === null ? null : (
        <p className="text-sm text-muted-foreground">{session.message}</p>
      )}

      {userCode === null ? null : (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            One-time code
          </p>
          <div className="flex items-center gap-2 rounded-md border border-border-hairline bg-surface-raised px-3 py-2">
            <code
              className="min-w-0 flex-1 truncate font-mono text-sm tracking-wide"
              data-testid="provider-auth-device-code"
            >
              {userCode}
            </code>
            <CopyButton
              className="size-8 shrink-0"
              text={userCode}
              label="Copy one-time code"
              successMessage="One-time code copied"
            />
          </div>
        </div>
      )}

      {oauthUrl === null ? null : (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Sign-in link
          </p>
          <div className="flex items-center gap-2 rounded-md border border-border-hairline bg-surface-raised px-3 py-2">
            <span
              className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
              title={oauthUrl}
              data-testid="provider-auth-oauth-url"
            >
              {oauthUrl}
            </span>
            <CopyButton
              className="size-8 shrink-0"
              text={oauthUrl}
              label="Copy sign-in link"
              successMessage="Sign-in link copied"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 w-full"
            onClick={() => openUrlInExternalBrowser(oauthUrl)}
          >
            <Icon name="ExternalLink" aria-hidden />
            {openLabel}
          </Button>
        </div>
      )}

      {session.codeInputRequired ? (
        <form
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            submitProviderAuthCode({ hostId, provider, sessionId });
          }}
        >
          <Label htmlFor={codeFieldId}>One-time code</Label>
          <Input
            id={codeFieldId}
            name="provider-auth-code"
            type="text"
            value={entry.code}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-11"
            onChange={(event) =>
              setProviderAuthCode(provider, event.target.value)
            }
          />
          <Button
            type="submit"
            className="min-h-11 w-full"
            disabled={entry.code.length === 0}
          >
            Submit code
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function ProviderAuthProgress({ label }: { label: string }) {
  return (
    <p
      role="status"
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      <Icon
        name="Loading"
        className="size-4 animate-spin motion-reduce:animate-none"
        aria-hidden
      />
      {label}
    </p>
  );
}

interface ProviderAuthFailureProps {
  message: string;
  onRetry: () => void;
  /**
   * A command the user runs themselves on the machine — today, unlocking the
   * macOS login keychain for Claude Code. bb only shows it; nothing here runs it.
   */
  recoveryCommand: string | null;
}

function ProviderAuthFailure({
  message,
  onRetry,
  recoveryCommand,
}: ProviderAuthFailureProps) {
  return (
    <div className="flex flex-col gap-4">
      <p
        role="alert"
        className="text-sm text-warning-text"
        data-testid="provider-auth-error"
      >
        {message}
      </p>
      {recoveryCommand === null ? null : (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Run this on the machine
          </p>
          <p className="text-xs text-muted-foreground">
            Enter your Mac password only on that Mac. Never paste or send it to
            BB.
          </p>
          <div className="flex items-start gap-2 rounded-md border border-border-hairline bg-surface-raised px-3 py-2">
            <code
              className="min-w-0 flex-1 break-all font-mono text-xs"
              data-testid="provider-auth-recovery-command"
            >
              {recoveryCommand}
            </code>
            <CopyButton
              className="size-8 shrink-0"
              text={recoveryCommand}
              label="Copy recovery command"
              successMessage="Command copied"
            />
          </div>
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  );
}
