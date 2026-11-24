# rhf-history

Monorepo for [`@yoo-digital/rhf-history`](./packages/rhf-history/README.md), undo/redo for react-hook-form that scales to thousands of fields, and [`@yoo-digital/rhf-history-persist`](./packages/rhf-history-persist/README.md), optional draft persistence (values and undo history) in IndexedDB or custom storage.

Start with the package READMEs for installation, usage and the API.

## Layout

| Path                                                             | Description                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`packages/rhf-history`](./packages/rhf-history)                 | Undo/redo library (ESM-only, built with tsdown). Entry points `.`, `./core`. |
| [`packages/rhf-history-persist`](./packages/rhf-history-persist) | Draft persistence on top of it. Entry points `.`, `./indexeddb`.             |
| [`examples/react-vite`](./examples/react-vite)                   | Demo SPA: profile form with draft persistence and a large-form stress test.  |

## Development

Requires Node 18+ and pnpm.

```sh
pnpm install
pnpm dev          # example app at http://localhost:5173
pnpm build        # build all packages
pnpm typecheck
pnpm lint         # oxlint
pnpm test:run     # all tests once
pnpm bench        # library benchmarks
```

Package-scoped: `pnpm -F @yoo-digital/rhf-history build | test:run | bench | typecheck | check:pkg` (same for `@yoo-digital/rhf-history-persist`).

The example and the persist package consume the libraries' TypeScript source through the `@yoo-digital/source` export condition, so no prebuild is needed.

## Releasing

Releases use [Changesets](https://github.com/changesets/changesets).

1. Run `pnpm changeset` in your PR and describe the change (patch, minor or major).
2. After merging to `main`, the release workflow opens a "Version Packages" PR.
3. Merging that PR publishes to npm with provenance.

## License

[MIT](./LICENSE)
