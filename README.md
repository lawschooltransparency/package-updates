# Package updates

This repository contains a collection of [GitHub composite actions](https://docs.github.com/en/actions/creating-actions/creating-a-composite-action)
used for updating dependencies in our projects.

The Node action builds its package-change summary with the bundled
`node/lock-diff.cjs` script, using only Node's built-in libraries. It supports npm
lockfiles v1, v2, and v3, excludes the root package, and keeps nested package paths
distinct. It reports added/removed packages and changes to recorded version
strings; integrity and resolution metadata alone do not produce summary lines.
The text is also exposed as the action's `package-changes` output. Invalid input
fails the step rather than publishing an incomplete summary.

Run its tests with `node --test node/lock-diff.test.cjs`.
