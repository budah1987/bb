---
kind: instruction
title: bb Guide Simulators
summary: Open, inspect, and control an iOS Simulator attached to a BB environment.
intent: Help users and agents use BB's environment-scoped iOS Simulator.
---
iOS Simulator commands

BB can boot one managed iOS Simulator session per environment on a macOS host
with Xcode installed. In the app, open the thread's right panel, choose New Tab,
then select Open simulator. Closing the tab leaves the session running so agents
can continue controlling it; Stop ends the managed session.

  bb simulator list                     List devices and the active session
    --environment <id>                  Defaults to BB_ENVIRONMENT_ID

  bb simulator attach [device-udid]     Boot and attach (newest iPhone by default)
  bb simulator tap <x> <y>              Tap normalized coordinates from 0 to 1
  bb simulator swipe <x1> <y1> <x2> <y2> Swipe between normalized coordinates
  bb simulator type <text>              Type text into the focused app
  bb simulator button <name>            home, swipe_home, app_switcher, lock,
                                        siri, or side_button
  bb simulator rotate <orientation>     portrait, portrait_upside_down,
                                        landscape_left, or landscape_right
  bb simulator ax                       Print the accessibility tree as JSON
  bb simulator screenshot --out <path>  Save a PNG screenshot
  bb simulator stop                     Stop the managed session

Every command accepts `--environment <id>` and `--json` where the command has a
structured result. From an agent thread, BB_ENVIRONMENT_ID selects the current
environment automatically. The live view uses an expiring authenticated stream;
agents should use the CLI or SDK control methods rather than the stream endpoint.
