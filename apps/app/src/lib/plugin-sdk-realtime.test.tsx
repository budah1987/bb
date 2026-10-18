// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginContext } from "@/components/plugin/plugin-context";
import { wsManager } from "./ws";
import { experimental_usePluginRealtime } from "./plugin-sdk-hooks";

afterEach(cleanup);

function Probe({ onSignal }: { onSignal: (payload: unknown) => void }) {
  experimental_usePluginRealtime("pr-manager", "links-changed", onSignal);
  return null;
}

describe("experimental_usePluginRealtime", () => {
  it("receives only the named plugin/channel and updates the callback", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = render(
      <PluginContext.Provider value="consumer">
        <Probe onSignal={first} />
      </PluginContext.Provider>,
    );
    const send = (pluginId: string, channel: string) =>
      wsManager.handleIncomingMessage(
        JSON.stringify({
          type: "plugin-signal",
          pluginId,
          channel,
          payload: { threadIds: ["thread-a"] },
        }),
      );

    act(() => {
      send("other", "links-changed");
      send("pr-manager", "other");
    });
    expect(first).not.toHaveBeenCalled();

    view.rerender(
      <PluginContext.Provider value="consumer">
        <Probe onSignal={latest} />
      </PluginContext.Provider>,
    );
    act(() => send("pr-manager", "links-changed"));
    expect(latest).toHaveBeenCalledWith({ threadIds: ["thread-a"] });
    expect(first).not.toHaveBeenCalled();

    view.unmount();
    act(() => send("pr-manager", "links-changed"));
    expect(latest).toHaveBeenCalledTimes(1);
  });
});
