# Electron desktop shell with an isolated Git service

The first delivery targets Windows and needs a compact Git workbench with local dialogs, persisted drafts, and system Git integration. Use Electron with a React/TypeScript renderer; keep Git and filesystem access in the main process behind explicit, validated operations and an isolated, sandboxed preload bridge. This favors a short path to a working desktop client over a smaller installation; the renderer never receives a generic shell execution API.
