# Pre-commit check

Run the project's pre-commit checks (lint, format check, typecheck) before committing.

**Instructions:**

1. Run these commands in order. Use `mise exec --` prefix for all Node/Bun commands (see project rules). On Windows you may omit `mise exec --`.

   ```bash
   mise exec -- bun run lint
   mise exec -- bun run format:check
   mise exec -- bun run typecheck
   ```

2. If any check fails, report the errors and suggest fixes. Do not run `git commit` until all three pass.

3. Remind that commit messages must be in English and follow Conventional Commits (e.g. `feat: description`, `fix: description`).
