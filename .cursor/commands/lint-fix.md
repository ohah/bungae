# Lint and format fix

Auto-fix lint and format issues in the project.

**Instructions:**

1. Run these commands in order. Use `mise exec --` prefix for all Node/Bun commands (see project rules). On Windows you may omit `mise exec --`.

   ```bash
   mise exec -- bun run lint:fix
   mise exec -- bun run format
   ```

2. If there are remaining errors that cannot be auto-fixed, list them and suggest manual fixes.

3. After fixing, suggest running the full pre-commit check (`/pre-commit-check`) before committing.
