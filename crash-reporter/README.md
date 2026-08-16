# Bundled crash reporter — source is intentionally NOT in this repo

`crash_reporter.py`, `ai_log_patterns.py` and `crash_reporter.ini.example` are
gitignored here. If you just cloned Provincia, this folder is nearly empty and
`npm run ship` will stop and tell you so.

**Why:** those files contain the report channel's Discord webhook in plaintext,
and this repo is public. v0.9.1438 (2026-07-25) committed them; GitHub secret
scanning reported the URL, Discord deleted the webhook, and from then on every
tester's upload failed with:

```
Discord rejected the report: HTTP 404 Not Found
Discord says: {"message": "Unknown Webhook", "code": 10015}
```

Nothing was wrong on the client, and nothing looked wrong from here — the
failure only shows up on testers' machines, so it went unnoticed until someone
pasted their console output.

## Getting the files

The master copy is `..\RIS-CrashReporter` (local-only repo, no remote — plaintext
is safe there). Copy in before packaging:

```
copy ..\RIS-CrashReporter\crash_reporter.py            crash-reporter\
copy ..\RIS-CrashReporter\ai_log_patterns.py           crash-reporter\
copy ..\RIS-CrashReporter\crash_reporter.ini.example   crash-reporter\
```

`ai_log_patterns.py` is generated — `npm run gen:ailog-patterns` writes it to
both checkouts.

## If the webhook has to be rotated again

1. Discord → report channel → Integrations → Webhooks → delete the old one, New Webhook.
2. Put the new URL in `DEFAULT_WEBHOOK_URL` in `..\RIS-CrashReporter\crash_reporter.py`,
   and add the **old webhook's ID** to `RETIRED_WEBHOOK_IDS` in the same file.
   That second step is what actually repairs existing testers: the reporter runs
   from `userData` with a `crash_reporter.ini` that Provincia never overwrites,
   so an ini pinned to the dead webhook survives every update. A retired ID is
   replaced with the current default and the ini is rewritten.
3. Copy the files in here, then ship both (standalone reporter release + Provincia).

`npm run ship` refuses to release if these files are missing, if they are tracked
by git again, or if `DEFAULT_WEBHOOK_URL` is one of the retired IDs.
