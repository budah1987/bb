import { useSyncExternalStore } from "react";
import type { ProviderAuthKey } from "@bb/host-daemon-contract";

let mobileProvider: ProviderAuthKey | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function openProviderAuthMobileView(provider: ProviderAuthKey): void {
  mobileProvider = provider;
  emit();
}

export function closeProviderAuthMobileView(): void {
  mobileProvider = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ProviderAuthKey | null {
  return mobileProvider;
}

export function useRootComposeProviderAuthProvider(): ProviderAuthKey | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useRootComposeProviderAuthLoginOpen(): boolean {
  return useRootComposeProviderAuthProvider() !== null;
}

export function resetProviderAuthMobileViewForTests(): void {
  mobileProvider = null;
  listeners.clear();
}
