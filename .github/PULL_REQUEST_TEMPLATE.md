## Summary

Describe the user-visible or internal behavior changed by this PR.

## Why

What problem does this solve? Why is this change appropriate for the constrained Maps-only scope?

## Validation

- [ ] `npm ci --ignore-scripts`
- [ ] `npm run check`
- [ ] `npm run build`
- [ ] Relevant smoke tests pass
- [ ] `npm pack --dry-run` reviewed if package contents changed

## Safety / security review

Check every item that applies:

- [ ] This PR does **not** expose generic browser primitives to MCP clients.
- [ ] This PR does **not** add scraping/crawling, review harvesting, internal Maps API interception, CAPTCHA bypass, stealth, fingerprint spoofing, or proxy rotation.
- [ ] Google Maps navigation remains allowlisted/fail-closed.
- [ ] CDP remains local/private and dedicated-profile assumptions are preserved.
- [ ] Dynamic candidate selection remains guarded against stale indexes (`expectedLabel`) where applicable.
- [ ] Maps-derived text remains treated as untrusted external data.
- [ ] V3 read bounds/rate limits are not widened unintentionally.
- [ ] No credentials, browser profiles, private locations, personal paths/emails, screenshots, traces, or Maps datasets are included.

If an item above is intentionally changed, explain the design/security reasoning in the PR body.

## Live Google Maps compatibility

Does this change affect URL compilation, semantic selectors, V3 reader behavior, challenge handling, or live page/CDP behavior?

- [ ] No live Maps run is needed (explain why if not obvious).
- [ ] `Live Maps E2E (manual)` was run and passed.

Do not add push/schedule-triggered live Maps crawling to validate a PR.

## Documentation

- [ ] README/docs are unchanged because behavior/configuration did not change.
- [ ] Relevant README/docs/examples were updated in this PR.

## Notes

Add migration, compatibility, or follow-up notes here.
