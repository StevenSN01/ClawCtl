# ClawCtl Development Guidelines

## i18n — Mandatory for All Frontend Changes

Every user-facing string in the frontend **must** be internationalized. Never hardcode display text.

### Rules

1. **Use `useTranslation()`** in every component that renders text:
   ```tsx
   const { t } = useTranslation();
   // ...
   <h1>{t("namespace.key")}</h1>
   ```

2. **Update both locale files** when adding or changing any string:
   - `packages/web/src/locales/en.json` (English)
   - `packages/web/src/locales/zh.json` (Chinese)

3. **Interpolation uses double curly braces**: `{{var}}` not `{var}`
   ```json
   "greeting": "Hello {{name}}"
   ```
   ```tsx
   t("greeting", { name: "Kris" })
   ```

4. **Namespace convention**: group keys by page/component
   - `sidebar.*`, `dashboard.*`, `sessions.*`, `channels.*`, `config.*`
   - `security.*`, `tools.*`, `operations.*`, `monitoring.*`, `usage.*`
   - `instance.*`, `settings.*`, `login.*`, `layout.*`
   - `agents.*`, `forms.*`, `assistant.*`
   - `common.*` for shared strings (Cancel, Save, Delete, etc.)
   - `restartDialog.*`, `templateApply.*` for modals/dialogs

5. **Avoid variable shadowing**: don't use `t` as a loop variable when `t` is the translation function. Rename to `tpl`, `tl`, `tab`, etc.

6. **Tests**: i18next is initialized in `packages/web/src/__tests__/setup.ts`. Tests can match on English text directly.

## Testing — Tests Must Follow Code Changes

Every code change that affects testable behavior **must** include corresponding test updates.

### Rules

1. **Run tests before pushing**: `npm run test:unit` (backend) and `npm run test:components` (frontend)
2. **Update existing tests** when modifying functions, data formats, or API contracts — don't just fix the code, fix the tests
3. **Check CI after push**: `gh run list --limit 1` — confirm status is `success` before moving on. If CI is red, fix immediately
4. **Test locations**:
   - Backend: `packages/server/src/**/__tests__/*.test.ts`
   - Frontend: `packages/web/src/pages/__tests__/*.test.tsx`
   - E2E: `e2e/`

## OpenClaw Credential & Config Writing

When writing files to remote OpenClaw instances, follow these rules strictly:

1. **API keys / OAuth tokens** go in `~/.openclaw/agents/<agentId>/agent/auth-profiles.json`, NOT in `openclaw.json`
2. **auth-profiles.json** must include `version: 1` and a `profiles` object
3. **OAuth profile fields**: `type`, `provider`, `access`, `refresh`, `expires` (epoch ms)
4. **openclaw.json `models.providers`** is for provider definitions (baseUrl, models[]), NOT for storing API keys
5. **Agent config merge** must deep-merge `tools.exec` and `tools.fs` to preserve existing fields (host, ask, mode, etc.)
6. **Model names** use `provider/model` format (e.g., `openai-codex/gpt-5.3-codex`, `anthropic/claude-opus-4-6`)

## Project Quick Reference

- Dev: `npm run dev` (server :7100, Vite :7101)
- Test: `npm run test:unit` (backend), `npm run test:components` (frontend)
- Build: `cd packages/web && npx vite build`
- Login: admin / admins (dev)
