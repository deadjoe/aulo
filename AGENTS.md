# Aulo development guidelines

- Use English for all repository content, code comments, commit messages, and pull-request text.
- Build a beautiful, approachable local desktop product around existing YUE2 // GROOVE capabilities.
- Keep the core engine in its existing repository. Do not copy it or introduce new generation capabilities here.
- Avoid technical configuration in normal user journeys. Report uncertainty honestly and offer actionable recovery.
- Never present simulated downloads, unverified hardware, or disconnected generation as ready or completed.
- The existing local AI agent connection is an independent future integration, not an embedded new assistant requirement.
- Preserve the distinction between exploring the workspace and completing runtime setup.
- Run `npm run check` and relevant Rust checks before delivery. Visual verification is separate from component tests.
