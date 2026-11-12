# One real sandbox hold: owner runbook

Written November 10, 2026 (Pacific) against `main` at `97c084a`. **Run once, on November 12, but not as written:** the PayPal approval tab did not return to the page, so the hold, release and return went through the app's API instead of these clicks ([what happened](VALIDATION.md#one-real-sandbox-hold--november-12-2026)). The clicks below have still only been pressed against a fake. It is the order of clicks for the owner, who is the only person who may make a PayPal sandbox call. It takes about 15 minutes.

It places one $25.00 hold, releases $15.00 while keeping the rest held, then returns the remaining $10.00. That is one authorization, one capture that is not final, and one void: the three PayPal answers the [hold path](PAYMENT-HOLDS.md) has only ever seen from a fake.

**The clicks were rehearsed on November 11, against a fake.** A browser test ([#95](https://github.com/alejandro-publius/our-castle/pull/95), `test/e2e/submission-walkthrough.spec.mjs`) presses steps 2 to 8 on the real page in sandbox mode, with a fake PayPal and a scripted buyer, for both endings of step 6. Every label, sentence and amount below matched. That checks the page and this server. It says nothing about the PayPal sandbox itself, the real PayPal button or this port, which only this run can show.

It uses a new process, a new port and a new, empty data folder. The saved apps on 3010 and 3021 are not touched, restarted or upgraded, and their records are not read.

## Before you start

- The sign-in for a **sandbox personal (buyer) account** and for the **sandbox business account** that owns the REST app, both from the PayPal developer dashboard.
- The path of the private configuration file the saved apps already use. It is never printed, copied or committed.
- If you want this run in the video, start a screen recording first ([checklist](VIDEO-CHECKLIST.md)). It cannot be staged again without another hold.

## 1. Start current main in sandbox mode

From any existing checkout of the repository:

```sh
git fetch origin
git worktree add --detach ../our-castle-sandbox-hold-proof origin/main
cd ../our-castle-sandbox-hold-proof
npm ci
git rev-parse --short HEAD            # write this down
lsof -nP -iTCP:3030 -sTCP:LISTEN      # must print nothing; otherwise choose another port below

env -i HOME="$HOME" PATH="$PATH" HOST=127.0.0.1 PORT=3030 \
  OUR_CASTLE_ACCESS=example \
  OUR_CASTLE_DATA_DIR="$HOME/our-castle-sandbox-hold-proof-data" \
  OUR_CASTLE_ENV_FILE="/absolute/path/to/your/private/.env" \
  node server/index.mjs
```

`env -i` starts the server with only these settings, so nothing else from the shell reaches it. The other integrations in that file are configured too, but each makes a request only when someone asks for it; this run asks for none of them.

**Confirm sandbox mode in three places before any click that matters.** If any one of them says simulated or example, stop: a simulated hold proves nothing here.

| Where | It must say |
| --- | --- |
| The terminal | `Payments: PayPal SANDBOX via the PayPal Server SDK (client …)` and a `Data:` line ending `our-castle-sandbox.sqlite` inside the new folder |
| The page, **World settings** | the integration badge **PayPal sandbox**, not **Simulated payments** |
| **Contribute**, once an amount is typed | the approval ends **(test money)**, not **(simulated)**, and the action is the PayPal button, not **Simulate approved payment** |

The saved 3021 app completed its checkout on `localhost`; this port has not been tried. If the PayPal button does not load, note the message under it and stop. Do not work around it by upgrading a saved app; that is a separate decision.

## 2. Found the house

Open `http://localhost:3030/`. This is a new household, so open the journal, **House**, fill in **Found your house** and choose **Raise our banner**.

Every new household starts with the **Camping trip fund**: **$60.00 toward $300.00**, and the header reads **Next: Manor · $15.00 to go**. That is why this run releases $15.00. The **Household member** selector in the header must show an adult; a child is offered neither the hold nor a decision on one.

Screenshot 1: the header at $60.00.

## 3. Hold $25.00

1. Journal → **Contribute**.
2. **Amount (USD):** `25.00`.
3. Tick **Hold it first. Nothing counts until an adult releases or returns it.**
4. The approval now reads **I approve holding $25.00 USD (test money).** Tick it.
5. Press the PayPal button, sign in as the sandbox buyer and approve.

Expect:

- under the button: **Held. Nothing is counted until an adult releases or returns it from its Ledger record.**
- a receipt titled **Contribution held**, stamped **PayPal sandbox · test money**, with **Held $25.00** and **Released Nothing**, and a PayPal order ID;
- the header still **$60.00**.

## 4. Confirm it is held and nothing moved

Journal → **Ledger**, and open the new record. It reads **Held — not counted**, tagged **PayPal sandbox**, with the trail **Held $25.00** and a line beginning **PayPal’s three-day guarantee lasts until**. The header is still **$60.00** and the Manor has not been raised.

Screenshot 2: that record with the header in view.

## 5. Release $15.00 and keep the rest held

1. On the record, choose **Release to the goal…**. The amount field opens at `25.00`.
2. Change it to `15.00`.
3. Tick **Keep the rest held for a later release (2 more allowed)**.
4. The button now reads **Confirm release of $15.00, keep $10.00 held**. Press it.

Expect:

- **Released $15.00. It now counts toward the goal. $10.00 is still held.**
- the record reads **Partly released — part counted**, with the trail **Held $25.00 → Released $15.00 → $10.00 still held**;
- the header moves to **$75.00** and the Manor is raised. Its deed may open; close it.

Screenshot 3: the record, its trail and the header at $75.00.

## 6. Return the remaining $10.00

1. On the same record, choose **Return the hold…**.
2. The button reads **Confirm return of $10.00**. Press it. (**Keep holding** backs out and sends nothing.)

Expect the trail **Held $25.00 → Released $15.00 → Returned $10.00**, the record **Completed — counted**, no further decisions offered on it, and the header still **$75.00**.

Screenshot 4: the finished trail.

**Instead of returning:** choose **Release to the goal…** again, leave `10.00` and press **Confirm release of $10.00**. The trail then ends **Released $10.00** and the header reads **$85.00**. Do one or the other. A return is the better proof, because a void is the answer the fake has stood in for.

## 7. Optional: one extension

**Extend the hold…** is offered only after PayPal's three-day guarantee has ended, and only while nothing has been released from that hold. A hold placed now cannot reach it before the November 12 deadline, so it is not part of this run.

To have it later, place a second hold now (for example $10.00), leave it alone, and come back after the date its guarantee line names. Then **Extend the hold…** → **Confirm extension of $10.00** should answer **Extended. It is held again under a new authorization, with a new three-day guarantee.** Until that is done, nothing may be claimed about extending.

## 8. PayPal's own record

Sign in to the PayPal sandbox as the **business** account and find this order. Capture what PayPal shows for each of the three, in PayPal's own words:

- the $25.00 authorization;
- the $15.00 capture;
- the void of what was left.

The developer dashboard's API call log shows the same three requests with their debug IDs; capture that as well if it is to hand.

Back in the app, **Check with PayPal** on the record compares each step with PayPal's order. Press it once and capture its answer (screenshot 5). Against the fake it answers **Checked · matches PayPal**; anything else is a finding.

Keep the screenshots outside Git until you have checked that none shows a sign-in, an account email or a full account identifier.

## 9. If something does not match

- **No answer, or an outcome the page calls unknown:** nothing was credited. Use **Check with PayPal** on the record. Do not place a new hold to try again.
- **An error under the Ledger with a PayPal debug ID:** write the ID down and stop.
- **The header moved before a release, or a trail differs from the ones above:** stop and capture it. That is a finding, and it is worth more than a clean run.

Whatever happens, keep the data folder. It is the record of the run, it holds real sandbox order identifiers, and it stays private.

## 10. Afterwards

Stop the server with Ctrl+C. Write down the date, the commit from step 1, the amounts and which of step 6's two endings you took.

In [PAYMENT-HOLDS.md](PAYMENT-HOLDS.md), the Status paragraph ends "**No real sandbox hold, capture, reauthorization or void has been made with any of it.**" Replace that sentence with this one, filled in:

> On November __, 2026 the owner placed one real PayPal sandbox hold of $25.00 on `main` at `_______`, released $15.00 while keeping the rest held, and returned the remaining $10.00; the Ledger trail and PayPal's own record of the order agreed. No extension (reauthorization) and no second or third release has been made with the real sandbox.

If the run did not go as written, say what happened instead. Do not paste the sentence for a run that differed.

## What this run does not show

- An extension, or anything that follows one: captures from the new authorization, or which authorization a void must name.
- A second or third release, or a final release that sends the rest back by itself.
- Hold webhooks, which need a public endpoint this project does not run.
- An expired hold, a declined capture or an unanswered request.

Those keep their fake-provider evidence only, as [PAYMENT-HOLDS.md](PAYMENT-HOLDS.md#what-only-the-owner-can-establish) says.
