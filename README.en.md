# CodeGuard

[中文](README.md)

A Windows Git workbench for understanding local changes, reviewing what you are about to commit, and submitting it yourself.

CodeGuard is a Windows desktop app. It helps you read a change, check findings and evidence, then commit, fetch, pull, push, and merge local branches. History and diffs follow the layout of GitKraken; choosing what to stage follows VS Code. You configure the model. The app explains and reviews, a coding assistant edits the code, and Git writes run only after you click.

A review warns you. It does not block a commit.

## What it does

- Open an existing local repository, switch repositories, or remove one from the list. Removing it does not delete the directory.
- Browse unstaged, staged, and untracked files, read the real diff, and stage or unstage a whole file or everything at once.
- Write a commit message, or generate an editable Conventional Commits draft from the staged diff, then commit what is staged.
- Browse a colored branch history, search by subject, author, or hash, and open a commit’s diff.
- Fetch, fast-forward pull, and ordinary push. Switch to an existing local branch, or merge after a preview. Conflicts stay in the change list; resolve them outside the app and continue, or abort the merge.
- Review the staged commit when something is staged. Otherwise, explain all local changes. Results include before-and-after behavior, the affected flow, and evidence searched in a fixed snapshot.
- Build a Windows x64 installer and a portable executable.

## What it does not do yet

This version does not review an old commit or a branch diff, discover project conventions, run configured check commands, clone a repository, create a branch, stage individual lines, force-push, hard-reset, rebase automatically, stash automatically, or edit merge conflicts inside the app.

## Requirements

- Windows
- From source: Node.js 22.12 or newer, and Git on `PATH`
- Installer and portable build: Git on `PATH`; Node.js is not required

## Run

When dependencies are already installed, double-click `Start-CodeGuard.cmd`, or run this in the project directory:

```powershell
npm start
```

After a fresh checkout, run `npm install` first. The Electron runtime downloads on the first install or launch. Development mode is `npm run dev`. If the system npm startup script is misconfigured, run `node scripts/start.mjs` directly.

A double-click hides the background console. Logs go to `.local/launch.log` and `.local/launch-error.log`.

## Package

On Windows, with development dependencies installed:

```powershell
npm run package
```

The command typechecks, builds the frontend, then writes:

- `release/CodeGuard-0.1.2-Setup-x64.exe`: installer, with a choosable directory plus desktop and Start menu shortcuts
- `release/CodeGuard-0.1.2-Portable-x64.exe`: portable build

The version in the file name comes from `package.json`. `npm run package:dir` only creates `release/win-unpacked/`; keep that directory together. The first package needs a network connection to download the packager and Electron.

Both packaged builds store settings, the encrypted key, and review records in `%APPDATA%/CodeGuard/`. They do not import `.local/desktop/` from a source checkout. Uninstall keeps that data by default. The build is not code-signed, so Windows may warn about an unknown publisher.

The window, taskbar, and packages share one icon. The source is `public/codeguard.svg`. After editing it, run `node scripts/generate-icons.mjs`, then package again.

## Daily use

1. Open an existing local repository. The default view is all local changes. That is not the same set of files as the upcoming commit.
2. The left tree groups unstaged, staged, and untracked files, and folders collapse. Select a file to read that version’s diff in the center. One file can appear in both the unstaged and staged groups. Commit history uses the “changed files” tree on the right.
3. `＋` stages a whole file, and `−` unstages it. “Stage all” beside the heading stages additions, modifications, deletions, and renames, following ignore rules. The button is disabled when there is nothing to stage, the index is locked, or conflicts remain. Staging follows the repository’s Git configuration and may run a clean filter.
4. Write the message on the right, or click “Generate commit message”. Generation skips the confirmation dialog. It uses only the staged diff, with the service, exclusions, and budget from model settings. A successful draft matches `type(scope): summary`. The scope is optional, the subject is at most 72 characters, and a blank line precedes the body. A result that fails this check does not replace the draft. Edits, failures, and cancellation during preparation or generation keep the previous draft.
5. “Commit” submits the staged content directly. The button is disabled when the message is empty, nothing is staged, the index is locked, or conflicts remain. Existing hooks and signing still apply. A failure keeps the draft. The app does not stage, push, edit source, or delete lock files on its own.
6. “Current checkout” in the toolbar is the working branch. Branch names in the menu browse history and can also switch or merge. History loads more on request. Search matches subjects, authors, and hashes on the current branch; “All history” restores every branch. A merge commit’s diff uses the first parent.
7. “Fetch” updates tracking status for the selected remote. “Pull” fetches, previews, and fast-forwards only. If the branches have diverged, preview an explicit merge in the same panel. “Push” first shows the local branch, the remote branch, and the commits to send. Without an upstream, choose the remote and branch; establishing the upstream is a separate checkbox. The app pushes only the previewed commits. It does not force-push or send tags.
8. Choose “Switch” or “Merge…” beside the target branch. Source, target, commits, and files are checked in one panel before the action runs. Switching is limited to existing local branches. A remote-tracking branch can be merged in.
9. “Remote repositories” in the repository menu adds, edits, or removes a remote. Removal explains the effect on tracking branches and upstreams. The server repository and local branches stay.
10. Merge conflicts remain in the change list. After resolving them outside the app and staging the result, choose “Continue merge…” from the branch menu or the conflict notice. “Abort merge…” can be previewed. If Git cannot restore the previous state, the current state stays.

Pull and merge require a clean worktree. On branch switch, Git decides whether current edits can stay; the app does not stash them. Remote authentication uses the system Git credential helper or SSH. Authentication failures and network failures are shown separately. Editing remote URLs changes only this repository’s local config and does not open a network connection for that edit. A push is refused when several push URLs are configured, so one confirmation cannot publish to more than one place.

## Understanding changes and reviewing a commit

1. Open “Model settings” at the top right. Enter a Chat Completions-compatible URL (usually including `/v1`), a model ID, and a key, then choose “Save and test”. A full `/chat/completions` URL also works. A local service without authentication can leave the key empty.
2. There is one analysis button. With staged files it says “Review this commit” and reads the index. With nothing staged it says “Understand all local changes” and reads the worktree, including untracked files. A click rereads Git status and freezes that scope. The button is disabled when there is nothing to analyze. “Conventions and requirements” are optional and save automatically.
3. The click goes straight to progress, without a send confirmation. The app freezes the versions and nearby context, asks the model for short hypotheses, searches that fixed snapshot across directories, then asks the model to conclude from the actual hits. Cancelling during preparation sends no request. After a request has started, waiting can be stopped, but the provider may still charge for the call.
4. Results lead with before-and-after behavior and the affected flow, then connect hypotheses, matching excerpts, conclusions, and fix suggestions. You can filter by file, select a flow node, zoom the diagram, and jump to the diff line. A finding can be copied to a coding assistant. CodeGuard does not edit the code.

Both scopes request a Chat Completions SSE stream. While it runs, the UI shows only summary text that has passed the sensitive-content check, and findings whose locations have been checked. Provider reasoning and raw JSON stay hidden. A dropped stream, error, or cancellation does not store a partial result as finished.

One analysis makes at most two model requests. Search reads ordinary source from the snapshot fixed for that task, under the exclusion rules, sensitive-content checks, and character budget. The two versions together scan at most 300 files and about 1.5 million characters. A citation in the conclusion must match a real hit; otherwise the item stays unconfirmed. The app does not run commands proposed by the model, and it does not describe a static judgment as a passed test.

The safe read limit is 1 MB, separate from the budget sent to the model. A small change inside a large file can be analyzed. A diff that does not fit is sampled across its real line numbers and marked partially covered. Overlapping nearby context is merged before the budget is split. TS/JS and Python get limited function and reference recognition; other text, including Markdown, contributes nearby text only.

When running from source, the key is encrypted with the system account and stored in `.local/desktop/model-settings.json`. It is not shown again. Conventions and the latest review are stored in `.local/desktop/reviews/` and are not written into the opened repository. Environment variables are not copied into settings. Packaged builds use `%APPDATA%/CodeGuard/`.

## Verification

```powershell
npm run test:ux
npm test
npm run build
npm run test:desktop
node scripts/desktop-smoke.mjs --commit-message
```

Automated tests use temporary repositories and do not write to the development checkout. `npm run test:desktop` launches a hidden window and checks the sandbox bridge, system key encryption, and a local model request.

`node scripts/validate-model.mjs --inspect` stays offline by default. After a real service is configured, `--run` calls at most four synthetic samples. The completed DeepSeek samples describe only that small set; they do not measure quality on a real repository. See [model validation](docs/model-validation.md).

`npm run preview:fixture` opens a browser preview bound to a temporary repository. `node scripts/preview.mjs --mock-model` also connects a local mock model so the review interaction can be inspected. Mock findings are not real defects.

## Design notes

- [Product plan](docs/product-plan.md) (Chinese)
- [Architecture decision](docs/adr/0001-local-electron-workbench.md) (Chinese)
- [Domain language](CONTEXT.md) (Chinese)
- [Git workbench notes](.scratch/git-workbench/README.md) (Chinese)
- [AI review notes](.scratch/ai-review/README.md) (Chinese)
- [Sync and branch notes](.scratch/git-sync/README.md) (Chinese)
