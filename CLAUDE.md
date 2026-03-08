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

## Project Quick Reference

- Dev: `npm run dev` (server :7100, Vite :7101)
- Test: `npm run test:unit` (backend), `npm run test:components` (frontend)
- Build: `cd packages/web && npx vite build`
- Login: admin / admins (dev)
