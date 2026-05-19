# Sales Call Audit Framework — Master Prompt for Qualitative Scoring

This file contains the operator's consolidated audit framework for the Claude-powered qualitative
lead scorer (Pillar 5.5). It was assembled from three detailed prompts (Marketing AI, Closer,
COO perspectives) and represents the canonical scoring methodology.

## How This Will Be Used

When a call transcript lands from Fathom, the scoring worker sends it to Claude along with
a system prompt derived from the principles below. Claude returns structured scores, evidence,
and recommendations that populate the `lead_scores` table.

---

## Core Principle

Qualification is NOT "they were nice" or "they showed interest."

A lead is qualified if ALL of the following are materially present:
1. Real problem we solve
2. Sufficient pain / desire for change
3. Authority to make a decision
4. Financial capacity or realistic access to capital
5. Urgency or a credible reason to act now
6. Offer actually fits their business model, stage, and goals
7. Coachable / decisive enough to move forward
8. Economics of serving them make sense

Do NOT confuse:
- Curiosity with intent
- Friendliness with fit
- Ambition with capacity
- Verbal agreement with buying readiness
- "This is interesting" with qualification
- "I want this someday" with current sales readiness

---

## Qualification Categories (Score 1-10 each, total /70)

### 1. Business Model Fit
- Real business vs idea-stage fantasy?
- Selling something already? Customers, team, operations, revenue?
- Problem is operational, sales, marketing, fulfillment, systems, AI?
- Does our offer (ProgB or AI Offer) actually fit?
- Red flags: pre-revenue, vague niche, unclear offer, too small, too broken

### 2. Revenue / Economic Capacity
- Monthly/annual revenue, margins, cash flow health
- Can they realistically afford the offer?
- ROI math makes sense?
- Red flags: under $10k/mo, survival mode, no capital access, price shock

### 3. Pain / Problem Severity
- How painful is current state? Frequent, expensive, emotional, urgent?
- Cost of staying the same — time, money, stress, missed growth, margin, quality of life
- Strong: repeated frustration, measurable inefficiency, money leak, hiring burden, bottleneck, burnout
- Weak: "just exploring", "curious about AI", no hard consequence if nothing changes

### 4. Urgency / Timing
- Why now? What happens if they wait 30/60/90 days?
- Deadline, growth constraint, team issue, margin issue, launch, seasonality?
- Strong: overloaded team, growth bottleneck NOW, labor cost NOW, wants implementation immediately
- Weak: "just looking", "sometime later", "I'll circle back"

### 5. Decision Authority
- Sole decision maker? Spouse/partner/cofounder/board involved?
- Can they say yes on the call if convinced?
- Red flags: "need to run by partner", "boss decides", "gathering info", absent decision maker

### 6. Coachability / Buyer Quality
- Decisive, takes ownership, serious, realistic, likely good client
- Red flags: blame shifting, chaos, extreme indecision, argumentative, wants miracles, chronic dabbling

### 7. Solution Fit
- Offer maps cleanly to their problem?
- Rep identified specific use cases / wins?
- Would this client realistically get value?
- Red flags: offer too advanced/expensive/early, force-fit

---

## Qualification Tiers

| Tier | Label | Description |
|------|-------|-------------|
| A | Highly Qualified | Real business, strong economics, painful problem, strong urgency, decision maker present, clear fit |
| B | Qualified Not Immediate | Real fit and problem, has capacity, but timeline/process delays action |
| C | Borderline | Some fit but material weaknesses — too early, weak urgency, partial authority, shaky economics |
| D | Unqualified | Wrong fit, too early, no money, no urgency, no authority, no meaningful pain |
| F | False Positive | Sounds exciting on surface, big talk weak substance, not actually buy-ready |

Score interpretation:
- 60-70 = highly qualified
- 48-59 = qualified
- 36-47 = borderline
- 20-35 = weak
- below 20 = unqualified

---

## Closer Performance Audit (Score 1-10 each, total /60)

### 1. Discovery Depth
- Business model, pain, current state, desired future, financial impact, urgency, buying process

### 2. Qualification Rigor
- Actually filtered the lead? Or just "had a nice convo"?

### 3. Control of Call
- Led confidently? Asked direct questions? Tolerated vagueness? Let prospect ramble?

### 4. Gap Creation
- Built the gap between where prospect is, where they want to be, cost of staying stuck

### 5. Commercial Judgment
- Knew when to push, disqualify, schedule follow-up, stop wasting time, challenge weak logic

### 6. Close Execution
- If qualified, advanced the deal correctly? If not, why not?

Score interpretation:
- 51-60 = excellent
- 41-50 = strong
- 31-40 = average
- 21-30 = weak
- below 20 = poor

---

## Critical Questions a Strong Closer Should Ask

**Problem / Pain:**
- What exactly is broken right now?
- What is this costing you in revenue, time, stress, or team performance?
- Why solve this now?
- What happens if nothing changes in the next 3-6 months?

**Current Situation:**
- What is your current monthly revenue?
- Where are leads coming from?
- What is your close rate or conversion issue?
- What bottleneck is stopping the next level?

**Urgency / Timing:**
- Why now?
- What is the timeline for solving this?
- What happens if you wait?

**Money:**
- What resources do you have to fix this?
- Have you invested in solving this before?
- Is capital actually available if the solution makes sense?

**Decision:**
- Are you the sole decision-maker?
- Does anyone else need to approve this?
- If this makes sense, can you decide today?

**Fit / Execution:**
- Do you have the bandwidth/team to implement?
- What have you already tried?
- Are you willing to change how you operate?

If these were NOT asked, qualification confidence is reduced and closer score is penalized.

---

## Outcome Classification

Root cause of no-close must be one of:
- A: Truly unqualified lead
- B: Borderline lead that required sharper qualification and framing
- C: Qualified lead, poorly closed
- D: Qualified lead, no-close due to external timing/process constraints
- E: Inconclusive because discovery was insufficient

**Critical rule:** Never confuse "the closer failed to uncover qualification" with "the lead was not qualified." If the rep failed to ask the necessary questions, mark that clearly.

---

## Common Failure Modes

1. **"Nice prospect" trap** — pleasant + engaged + verbal interest, but lacks urgency/authority/money
2. **"Consulting session" trap** — 45-90 min giving advice before real qualification
3. **"Hidden spouse/partner" trap** — decision-maker absent, surfaced late
4. **"Fake urgency" trap** — big goals but no actual time pressure
5. **"High revenue, low fit" trap** — has money but wrong for the offer
6. **"Broke but hopeful" trap** — deeply wants transformation but commercially unqualified
7. **"Qualified but poorly closed" trap** — ingredients present, closer failed

---

## Output Structure for Scoring Worker

The Claude-powered scorer should return:

```json
{
  "leadVerdict": "Qualified | Borderline | Unqualified | Inconclusive",
  "qualificationTier": "A | B | C | D | F",
  "qualificationScore": 0-70,
  "closerScore": 0-60,
  "rootCause": "A | B | C | D | E",
  "oneSentenceTruth": "string",
  "qualScores": {
    "businessFit": 0-10,
    "economicCapacity": 0-10,
    "painSeverity": 0-10,
    "urgency": 0-10,
    "decisionAuthority": 0-10,
    "coachability": 0-10,
    "solutionFit": 0-10
  },
  "closerScores": {
    "discoveryDepth": 0-10,
    "qualificationRigor": 0-10,
    "controlOfCall": 0-10,
    "gapCreation": 0-10,
    "commercialJudgment": 0-10,
    "closeExecution": 0-10
  },
  "redFlags": ["string"],
  "greenFlags": ["string"],
  "summary": "string (2-3 sentences)",
  "missedQuestions": ["string"],
  "bestNextStep": "close | follow-up | rebook-with-dm | nurture | disqualify | remove",
  "coachingNote": "string",
  "evidenceQuotes": [{"quote": "string", "signal": "string", "impact": "positive | negative"}]
}
```

---

## Harsh Truth Rules

- Do NOT protect the rep's feelings
- Do NOT inflate lead quality
- Do NOT call someone qualified just because they are impressive
- Do NOT assume budget from confidence
- Do NOT assume urgency from interest
- Do NOT assume authority from attendance
- If key qualification data was never collected, penalize the rep score
- If the prospect clearly should not have been booked, say it directly
- If the rep missed an obvious close on a qualified lead, say it directly
- The written reasoning matters MORE than the number

---

## Context: ProgB + AI Offer

We sell Program B (ProgB) and the AI Offer only. Do not mix in YOUR_COMPANY.
This is a high-ticket B2B consultative sale.
Team: Closers = Closer One, Closer Two. Setter = Setter One.
The purpose of auditing is to protect revenue, time, and team capacity.
A long call with an unqualified lead is not neutral — it is a loss of sales capacity.
