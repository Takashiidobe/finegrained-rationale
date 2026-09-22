# Architecture

Two components, split across two repos.

## Frontend — VS Code extension (this repo, TypeScript)

UI and editor integration only. No git, LLM, or search logic lives here.

- **Input**: a commit hash (typed/picked) or a line-range selection in the active editor.
- **Blame**: line-range selections are resolved to commit hashes by shelling out to
  `git blame --porcelain -L <start>,<end> -- <file>` (or `simple-git`), directly in the
  extension process. No native bindings needed for this.
- **Symbols**: enclosing method/function for a selection is resolved via VS Code's own
  `vscode.executeDocumentSymbolProvider` command, so it works for every language VS Code
  already has a language extension for — no custom LSP client.
- **Backend calls**: sends `{commitHash}` or `{file, startLine, endLine, commitHashes}`
  requests to the local Python backend over HTTP (`fetch` to `localhost`), and renders
  returned markdown/JSON (justification notes, search results) in a webview.
- **Backend lifecycle**: the extension spawns the Python backend as a child process on
  activation (`rationale.backend.command`, invoked as `<command> --port <port>`) and
  kills it on deactivation. The port is picked automatically (a free ephemeral port)
  unless `rationale.backend.port` is set to a fixed value. The extension polls
  `GET /health` on that port after spawning and holds all requests until it responds
  `200`, so the backend must expose that endpoint as soon as it's ready to serve.
- **Search**: a command/UI box sends natural-language queries to the backend's search
  endpoint and renders the ranked notes returned.

## Backend Python service (separate repo)

Runs as `FastAPI` + `uvicorn` on localhost, spawned by the extension.

- **GitHub API**: given a commit hash, fetches commit/PR metadata, diff, and review
  discussion via the GitHub API.
- **LLM reconstruction**: calls an LLM (Anthropic/OpenAI) over that raw data to
  reconstruct a "why was this change made" narrative.
- **Artifacts**: writes the result to disk as a markdown file plus JSON artifacts
  (structured data extracted alongside the narrative) in a notes directory.
- **Indexing**: indexes each note into a `tantivy-py` index incrementally as it's
  written — this is the piece still to be added to the Python repo.
- **Search / RAG**: exposes a search endpoint that takes a natural-language query,
  runs it against the tantivy index, and optionally reranks/summarizes the top hits
  with an LLM pass before returning results to the extension.
