---
kind: instruction
title: bb Guide — Spaces
summary: Command reference for Space creation, editing, deletion, and project membership.
intent: Provide complete Space command documentation for agents.
editingNotes: Keep flags accurate against the CLI implementation.
---
Space commands

A Space controls which projects appear in the sidebar. Each ordinary project
belongs to one Space. Pinned threads, sections, and personal threads stay global.

  bb space list                         List Spaces and project counts
  bb space create                       Create a Space
    --name <name>                       Space name
    --icon <icon>                       layers, grid, star, circle, zap, target, folder, or workflow
    --color <color>                     sage, amber, mulberry, blue, coral, teal, or neutral
  bb space edit <id>                    Replace the name, icon, and color
    --name <name>
    --icon <icon>
    --color <color>
  bb space move-project <space-id> <project-id>
                                        Move one project to another Space
  bb space delete <id>                  Delete a Space
    --move-projects-to <id>             Move contained projects before deletion
    --yes                               Skip confirmation

All commands accept --json. The last Space cannot be deleted. A Space that
contains projects requires --move-projects-to.
