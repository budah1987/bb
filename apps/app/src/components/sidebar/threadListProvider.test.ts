import { describe, expect, it } from "vitest";
import type { PluginThreadListSlot } from "@/lib/plugin-slots";
import {
  BUILT_IN_THREAD_LIST_PROVIDER,
  mergeThreadListProviders,
  resolveThreadListProvider,
  threadListProviderKey,
} from "./threadListProvider";
import {
  CONDUCTOR_THREAD_LIST_PROVIDER_KEY,
  conductorThreadListProvider,
} from "../conductor/conductorThreadListProvider";

function slot(pluginId: string, id: string): PluginThreadListSlot {
  return {
    pluginId,
    id,
    generation: 1,
    title: `${pluginId} list`,
    component: () => null,
  };
}

describe("resolveThreadListProvider", () => {
  it("resolves the built-in list when nothing is chosen", () => {
    expect(
      resolveThreadListProvider(
        [slot("t3sidebar", "inbox")],
        BUILT_IN_THREAD_LIST_PROVIDER,
      ),
    ).toBeNull();
  });

  it("matches a registered provider by plugin and slot id", () => {
    const registered = slot("t3sidebar", "inbox");
    expect(
      resolveThreadListProvider(
        [slot("other", "inbox"), registered],
        threadListProviderKey(registered),
      ),
    ).toBe(registered);
  });

  it("resolves the saved Conductor key to the host presentation", () => {
    expect(
      resolveThreadListProvider([], CONDUCTOR_THREAD_LIST_PROVIDER_KEY),
    ).toBe(conductorThreadListProvider);
  });

  // The whole point of the fallback: a disabled or still-loading plugin must
  // leave the user with bb's list, not an empty sidebar.
  it("falls back to the built-in list when the chosen plugin is gone", () => {
    expect(resolveThreadListProvider([], "t3sidebar/inbox")).toBeNull();
  });

  // Two plugins can each register an "inbox"; the plugin id disambiguates.
  it("does not confuse same-named slots from different plugins", () => {
    const mine = slot("mine", "inbox");
    const theirs = slot("theirs", "inbox");
    expect(
      resolveThreadListProvider([mine, theirs], threadListProviderKey(theirs)),
    ).toBe(theirs);
  });
});

describe("mergeThreadListProviders", () => {
  it("keeps Conductor available without the plugin", () => {
    expect(mergeThreadListProviders([])).toEqual([
      conductorThreadListProvider,
    ]);
  });

  it("keeps plugin alternatives and removes the old Conductor duplicate", () => {
    const oldConductor = slot("conductor-workspaces", "conductor");
    const t3 = slot("t3sidebar", "inbox");

    expect(mergeThreadListProviders([oldConductor, t3])).toEqual([
      conductorThreadListProvider,
      t3,
    ]);
  });
});
