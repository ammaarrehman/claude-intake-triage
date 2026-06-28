/**
 * Claude Intake Triage Assistant — Google Apps Script
 * -----------------------------------------------------
 * Bound to the Google Sheet that receives Google Form responses.
 * On each new submission it sends the request text to Claude and writes
 * structured triage fields back into the same row for staff to review.
 *
 * SETUP (see README.md for full steps):
 *   1. Form responses must land in this Sheet.
 *   2. Project Settings > Script Properties: add ANTHROPIC_API_KEY.
 *   3. Triggers (clock icon): add an "On form submit" trigger -> onFormSubmit.
 *   4. Make sure the header columns below exist on the responses sheet.
 *
 * The prompt here mirrors evals/prompts.py (SYSTEM_V2) so the live tool and
 * the eval harness behave identically.
 */

// Column header -> the field we write there. Adjust labels to match your sheet.
var OUTPUT_HEADERS = {
  primary: "Claude Primary Category",
  secondary: "Claude Secondary Categories",
  urgency: "Claude Urgency",
  summary: "Claude Summary",
  nextStep: "Suggested Next Step",
  followUps: "Follow-up Questions",
  review: "Human Review Required",
  reviewReason: "Review Reason",
  status: "Staff Status"
};

// Which form field holds the free-text request. Match your form question text.
var REQUEST_FIELD_HINT = "help"; // any header containing this word is treated as the request

var CATEGORIES = [
  "Food Assistance", "Housing & Shelter", "Workforce & Employment",
  "Education & Tutoring", "Healthcare Access", "Financial Assistance",
  "Transportation", "Legal Aid", "Childcare & Family Support",
  "Immigration & Language Support", "Other / Unclear"
];

function buildSystemPrompt() {
  var list = CATEGORIES.map(function (c) { return "- " + c; }).join("\n");
  return [
    "You are an intake triage assistant for a community-services organization.",
    "You read a short request submitted by a community member and return a",
    "structured JSON object that helps staff sort and route it. You never speak",
    "to the requester.",
    "",
    "Rules:",
    "- Summarize ONLY from the text provided. Never invent facts, names,",
    "  resources, or eligibility.",
    "- You do NOT make eligibility decisions or promise services. You suggest",
    "  categories and a next step for a human to review.",
    "- Do not give medical, legal, or financial advice.",
    "- A request may have more than one need. Put the most pressing one in",
    "  primary_category and any others in secondary_categories.",
    "- Choose every category from this exact list:",
    list,
    "- Set human_review_required to true for anything urgent, sensitive, a",
    "  possible safety/crisis issue, or where the need is unclear.",
    "- Keep the summary to one or two sentences. At most 3 follow-up questions.",
    "",
    "Return ONLY valid JSON, no markdown and no commentary, in this shape:",
    '{ "primary_category": "", "secondary_categories": [], "urgency": "Low | Medium | High",',
    '  "summary": "", "suggested_next_step": "", "follow_up_questions": [],',
    '  "human_review_required": true, "human_review_reason": "" }'
  ].join("\n");
}

function getClaudeTriage(requestText) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set in Script Properties.");

  var payload = {
    model: "claude-haiku-4-5",
    max_tokens: 600,
    system: buildSystemPrompt(),
    messages: [{
      role: "user",
      content: 'Community member request:\n"""\n' + requestText + '\n"""'
    }]
  };

  var resp = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    contentType: "application/json",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var body = JSON.parse(resp.getContentText());
  if (resp.getResponseCode() !== 200) {
    throw new Error("Claude API error: " + resp.getContentText());
  }
  var text = body.content.map(function (b) { return b.text || ""; }).join("");
  text = text.replace(/```json|```/g, "").trim();
  return JSON.parse(text);
}

function onFormSubmit(e) {
  var sheet = e.range.getSheet();
  var row = e.range.getRow();
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // find the request column
  var reqCol = -1;
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).toLowerCase().indexOf(REQUEST_FIELD_HINT) !== -1) { reqCol = i; break; }
  }
  if (reqCol === -1) { return; }
  var requestText = sheet.getRange(row, reqCol + 1).getValue();
  if (!requestText) { return; }

  var triage;
  try {
    triage = getClaudeTriage(String(requestText));
  } catch (err) {
    writeCell_(sheet, row, headers, OUTPUT_HEADERS.summary, "ERROR: " + err.message);
    writeCell_(sheet, row, headers, OUTPUT_HEADERS.review, "Yes");
    return;
  }

  writeCell_(sheet, row, headers, OUTPUT_HEADERS.primary, triage.primary_category || "");
  writeCell_(sheet, row, headers, OUTPUT_HEADERS.secondary, (triage.secondary_categories || []).join(", "));
  writeCell_(sheet, row, headers, OUTPUT_HEADERS.urgency, triage.urgency || "");
  writeCell_(sheet, row, headers, OUTPUT_HEADERS.summary, triage.summary || "");
  writeCell_(sheet, row, headers, OUTPUT_HEADERS.nextStep, triage.suggested_next_step || "");
  writeCell_(sheet, row, headers, OUTPUT_HEADERS.followUps, (triage.follow_up_questions || []).join(" | "));
  writeCell_(sheet, row, headers, OUTPUT_HEADERS.review, triage.human_review_required ? "Yes" : "No");
  writeCell_(sheet, row, headers, OUTPUT_HEADERS.reviewReason, triage.human_review_reason || "");
  writeCell_(sheet, row, headers, OUTPUT_HEADERS.status, "New");
}

// writes a value into the column whose header matches `headerLabel` (creates it if missing)
function writeCell_(sheet, row, headers, headerLabel, value) {
  var col = headers.indexOf(headerLabel);
  if (col === -1) {
    col = headers.length;
    sheet.getRange(1, col + 1).setValue(headerLabel);
    headers.push(headerLabel);
  }
  sheet.getRange(row, col + 1).setValue(value);
}

// Optional: run once manually to test without submitting the form.
function testTriage() {
  var sample = "I lost my job and need food assistance and resume help. No car.";
  Logger.log(JSON.stringify(getClaudeTriage(sample), null, 2));
}
