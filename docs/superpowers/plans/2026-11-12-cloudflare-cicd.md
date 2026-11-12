# Cloudflare Pages CI/CD Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically deploy successful pushes to `main` to the existing RouteTrack Pages project (RT-004, RT-504).

**Architecture:** Extend the existing GitHub Actions verification job with one conditional Wrangler deployment step after E2E. Reuse the Direct Upload project `routetrack` and its production URL.

**Tech Stack:** GitHub Actions, cloudflare/wrangler-action v4, existing npm/Vite build.

**Spec:** User request in this session; `docs/00-DECISIONS.md` ADR-11; `docs/08-ROADMAP.md` RT-004/RT-504.

## Global Constraints

- Keep Cloudflare Pages, branch `main`, output `dist`, and the existing application stack.
- No application, GPS, schema, or dependency changes.
- Store the Pages Edit token only in GitHub Actions secret `CLOUDFLARE_API_TOKEN`.

## Review Focus

- Pull requests and non-main branches must not deploy or consume the Cloudflare secret.
- Any failed verification step must prevent deployment.
- Deploy the tested `dist` directory, including generated `_headers`.
- Keep the existing production project/URL and read-only GitHub token permissions.
- Missing/revoked Cloudflare credentials must fail visibly; rerun after replacing the secret.

## Task 1: Reuse CI for production deployment

**Files:** Modify `.github/workflows/ci.yml`, `README.md`, and the CI/CD paragraph in `docs/03-ARCHITECTURE.md`; this file records the plan and validation.

- [x] Add the main-push-only deploy step after the existing E2E checks.
- [x] Document the current URL, required secret, triggers, and build-time configuration.
- [x] Validate workflow syntax/expressions with actionlint and run `npm ci`, typecheck, lint, format, test, build.
- [ ] Review the diff, commit, and push the workflow to `main`.
- [ ] Verify a GitHub Actions run and the matching production deployment, then check HTTPS/SPA/security headers.

## Credential prerequisite

GitHub credentials can push workflows and read repository secrets metadata. Cloudflare OAuth can deploy but token-management endpoints return HTTP 403. The account owner must create a token with Account → Cloudflare Pages → Edit for account `e7420968b9c4ed515c72372e953f9033` and save it as the repository secret above. Never paste or commit the token.

## Validation before push

Actionlint 1.7.12, `npm ci`, typecheck, lint, format, test (333 passed, 1 TODO), and build passed. Independent review found no Critical/Important issues; the README now explicitly says to rerun the latest `main` run so an older rerun does not roll production back. Live credential/deployment verification remains dependent on the repository secret.
