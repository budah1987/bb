---
kind: instruction
title: bb Guide — Projects
summary: Command reference for project CRUD, attachments, and sources.
intent: Provide complete project command documentation for agents.
editingNotes: Keep flags accurate against the CLI implementation.
---
Project commands

A project maps to a code repository. All threads belong to a project.

  bb project list                         List ordinary projects
    --include-personal                    Also include the personal project
  bb project history <id>                 List prompt history
  bb project reorder <id>                 Reorder in the sidebar
    --after <id>                          Previous project, or omit for start
    --before <id>                         Next project, or omit for end
  bb project create --name "..." [options]
    --root <path>                         Project source path
    --remote-url <url>                    Clone a Git repository as the source
    --github-account <login>              Default GitHub account for new workspaces
    --machine <id-or-name>                Bind the path to a connected machine
    --host <id-or-name>                   Alias for --machine

  An explicit machine/host selector accepts an exact ID or unambiguous name and
  binds --root to that machine. Omitting the selector preserves the existing
  local CLI machine fallback (normally the primary machine).

  bb project show <id>                    Show project details
  bb project update <id>                  Update a project
    --name <name>                         New name
    --github-account <login>              Set the default GitHub account
    --clear-github-account                Clear the default account

  bb project delete <id>                  Delete project and all threads
    --yes                                 Skip confirmation

Repository manager:

  bb project manager show <id>            Show manager settings
  bb project manager run <id>             Start a manager briefing thread
    --prompt <text>                       Add a briefing focus
  bb project manager settings <id>        Update manager settings
    --enable | --disable                  Allow or block manual runs
    --provider <id> --model <id>          Select the agent
    --reasoning <level>                   Select its reasoning level
    --service-tier <tier>                 Select its service tier
    --permission-mode <mode>              Select its permission mode

  Each run creates a visible root thread in the project's default workspace.
  The server supplies the repository briefing prompt and safe defaults.

Discovery:

  bb project github-accounts                List authenticated GitHub accounts
    --machine <id-or-name>                   Machine whose accounts to use
    --host <id-or-name>                      Alias for --machine
  bb project github-repositories            List repositories from all accounts
    --machine <id-or-name>                   Machine whose GitHub accounts to use
    --host <id-or-name>                      Alias for --machine
  bb project github-pull-requests <owner/repo>
                                              List open pull requests
    --github-account <login>                  Authenticated account to use
    --machine <id-or-name>                   Machine whose GitHub account to use
    --host <id-or-name>                      Alias for --machine
  bb project github-repository-health <owner/repo...>
                                              Read checks and PR attention
    --github-account <login>                  Authenticated account to use
    --cached                                  Never contact GitHub
    --machine <id-or-name>                   Machine whose GitHub account to use
    --host <id-or-name>                      Alias for --machine
  bb project github-repository-activity <owner/repo>
                                              Issues, Actions, and inbox
    --github-account <login>                  Authenticated account to use
    --machine <id-or-name>                   Machine whose GitHub account to use
    --host <id-or-name>                      Alias for --machine
  bb project branches <id> --host <id>   List branches for a machine source
  bb project paths <id>                   Search workspace paths
  bb project files <id>                   List workspace files
  bb project content <id> <path>          Read file content (binary is base64)
  bb project commands <id> --provider <id>
                                          List commands and skills
    --machine <id-or-name>                Target project source machine
    --host <id-or-name>                   Alias for --machine
    --environment <id>                    Target environment workspace

  The machine/host and environment selectors are mutually exclusive. An
  environment selects its owning machine and workspace; otherwise an explicit
  machine selects that machine's project source. Omitting both intentionally
  falls back to the primary machine's project source.

  GitHub repository discovery reads every authenticated github.com account on
  the selected machine, combines repositories by owner/name, and reports which
  accounts can access each one. Human output identifies the repository owner,
  every account with access, and the active account; --json returns the complete
  typed catalog.
  Pull-request discovery requires --github-account, scopes the operation to
  that authenticated account, and returns the PR head repository and branch so
  agents can reproduce the selected starting point.
  Repository health batches up to 50 repositories, reports default-branch
  checks and the highest-priority open-PR attention state, and returns typed
  sign-in, rate-limit, and availability outcomes. Pass --cached from persistent
  or background navigation so it cannot start host or GitHub work.
  Repository activity is an on-demand bounded read of open issues, recent
  Actions runs, and unread notifications for one repository. It never creates
  a background inbox or synchronization loop.
  The project GitHub account is a repository default inherited by new
  workspaces; an explicit workspace account still takes precedence.

Attachments:

  bb project attachment upload <id>       Upload bytes from the CLI machine
    --client-file <path>                  Path read on this CLI machine
    --filename <name>                     Attachment filename override
    --mime-type <type>                    MIME override (otherwise inferred)
  bb project attachment download <id> <attachment-path>
    --client-file <path>                  Destination on this CLI machine

  Uploads use multipart bytes and return a server-managed attachment DTO. Pass
  its relative `path` to thread --file/--image input. Those thread flags never
  read a client path: absolute values remain paths for the execution host.
  image/* uploads are limited to 10MB; other files are limited to 25MB.

Sources:

  Projects can have multiple machine-local path sources.

  bb project source add <projectId>       Add a source
    --path <path>                         Local path
    --clone                               Clone the project's Git remote
    --remote-url <url>                    Git remote override for --clone
    --target-path <path>                  Destination override for --clone
    --machine <id-or-name>                Target machine (--host is an alias)
    --default                             Set as default source

  Explicit project source selectors must name a connected machine. Omitting
  the selector preserves the same local CLI machine fallback as project create.

  bb project source update <projectId> <sourceId>
    --path <path>
    --default

  bb project source delete <projectId> <sourceId>
