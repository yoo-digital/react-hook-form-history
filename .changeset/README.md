# Changesets

Every user-facing change to `@yoo-digital/rhf-history` needs a changeset. Run
`pnpm changeset`, pick the bump type and describe the change. Merging to `main`
makes the release workflow open (or update) a "Version packages" PR; merging
that PR publishes to npm.

`examples/react-vite` is private and ignored by changesets.
