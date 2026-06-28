# Staff Runbook — Claude Intake Triage Assistant

For volunteers and staff who review intake requests. No coding needed.

## Form fields (set these up once)

- Name or initials
- Contact email
- ZIP code
- **What do you need help with?**  (long answer — this is the text Claude reads)
- How urgent is this?  (Low / Medium / High)
- Any barriers? (transportation, language, internet, etc.)
- Consent checkbox: "I understand this tool helps organize requests but a person
  reviews before any action is taken."

> The script looks for the request column by matching the word "help" in the
> header, so keep "help" in that question. To change it, edit `REQUEST_FIELD_HINT`
> in `apps-script/Code.gs`.

## What happens automatically

When someone submits the form, a new row appears in the Sheet. Within a few
seconds the script fills in:

| Column | Meaning |
|--------|---------|
| Claude Primary Category | Main need |
| Claude Secondary Categories | Other needs found |
| Claude Urgency | Low / Medium / High |
| Claude Summary | Neutral one–two sentence recap |
| Suggested Next Step | Idea for staff (not a promise to the requester) |
| Follow-up Questions | What to ask if you reach out |
| Human Review Required | Yes/No |
| Review Reason | Why review was flagged |
| Staff Status | Starts as "New" |

## How to review a request

1. Sort or filter by **Human Review Required = Yes** first, then by Urgency.
2. Read the original request text yourself — Claude's summary is a shortcut, not
   a replacement.
3. Correct any wrong category directly in the cell.
4. Update **Staff Status**: New -> In Progress -> Done (or Referred).
5. For anything urgent or unsafe, follow your normal escalation process. The tool
   does not contact anyone.

## When something looks wrong

- **A column says ERROR:** the API call failed (often a bad/expired key or quota).
  Check Script Properties has a valid `ANTHROPIC_API_KEY`, then re-run by editing
  and re-saving the request cell, or use `testTriage()` in the editor.
- **Categories look off:** edit the cell; consider tightening the prompt in
  `Code.gs` and re-testing with the eval harness.
- **No columns filled in:** confirm the "On form submit" trigger exists
  (Apps Script > Triggers) and that the request question still contains "help".

## Handoff

This sheet + script is the whole system. To hand it to a new owner: share the
Sheet, have them add their own `ANTHROPIC_API_KEY` in Script Properties, and walk
them through one test submission using this runbook.
