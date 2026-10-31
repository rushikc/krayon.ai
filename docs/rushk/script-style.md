# rushk: script style

How a rushk reel is written and spoken. Kept separate from the visuals: see [`visual-style.md`](./visual-style.md) for how the script is shown on screen. Derived from the Airbnb (54 s) and Uber (93 s) reference reels; the narration was transcribed by a video-analysis pass, so treat the exact words as close, not verbatim.

## 1. Principle

One system-design idea per reel, told as a short story with a point of view: here is the claim, here is why it works or breaks, here is the right way. Written to be heard, in short spoken sentences, with a keyword in nearly every sentence that can become one visual.

## 2. Formula

| Section | Length | Job |
| --- | --- | --- |
| Hook | 4 to 8 s | A surprising claim, a named company, or a mistake in someone else's explanation. The first sentence must work with no context. |
| Setup | about 10 s | The old way or the flawed approach, and why it hurts. |
| Body | 28 s (short reel) to about 70 s (long reel) | The mechanism, explained step by step. Then proof, then consequence, then the right approach. |
| Payoff | 8 to 15 s | Concrete results or the correct use case. |
| CTA | about 3 to 4 s | Fixed outro line. |

Two proven shapes:

1. **Case-study shape** (Airbnb, 54 s): hook with a headline result -> "Today let's talk about X" -> old way and its cost -> the new model, step by step -> results as three metrics -> CTA.
2. **Myth-bust shape** (Uber, 93 s): "There was a mistake in <source>" -> what they claimed -> "on paper it sounds nice, but in reality it breaks" -> why (mechanism) -> proof (official docs) -> consequence -> the industry-standard answer -> "so when should you actually use X?" -> proper use case -> CTA.

## 3. Example hooks (from the references)

- "Airbnb deleted 60% of their authentication code while actually increasing successful logins."
- "There was a mistake in Hello Interview's video explaining Uber system design."

Pattern: a named company or channel, plus a number or a claim of error. No greeting, no "hey guys".

## 4. Sentence and word style

- Short spoken sentences, mostly one idea each, 8 to 20 words.
- Plain words, light contractions, Indian-English cadence. Technical terms are said once, plainly, then reused (for example "TTL", "policy engine").
- Signposts used often: "Today, let's talk about…", "Historically…", "Step one… Step two…", "On paper it sounds nice, but in reality…", "Instead…", "And the result?", "So when should you actually use…?", "This is exactly why…".
- Numbers are concrete and spoken as numbers: "60%", "27% fewer duplicate accounts", "a 100kb smaller web bundle", "20 plus AB tests in days rather than weeks", "up to 48 hours".
- Contrast pairs are a favourite device: weeks vs days, hardcoded vs server-defined, precise vs eventual, Redis vs DynamoDB.
- Cite an authority for the proof beat ("Amazon officially states…") and show it as a screenshot.
- No filler, no jokes, no slang, no emojis in the script.

## 5. Writing for the visuals (the link to visual-style.md)

- Every sentence should contain one or two nameable things that will pop on screen when spoken (a service, a state, a number, a verdict).
- Prefer concrete nouns on the word that should trigger the pop. Put the keyword at or near the end of the clause so the visual lands on it.
- One diagram per concept. When a concept is finished, the script moves on with a clear signpost ("Instead…", "And the result?") because the card clears there.
- Keep each section to about 10 to 15 s so the card does not overflow.
- Do not say things that cannot be shown: avoid long abstract passages. If it cannot be drawn as a box, label, number or badge, shorten it.

## 6. Voice and delivery

- Male voice, confident, clear, brisk but intelligible. No music bed, no sound effects.
- Even pace with short pauses at section boundaries (that is where the card clears).
- The voiceover is recorded first and edited tight; visuals are cut to it.

## 7. Outro (fixed)

> "Hey, I'm Rushi. If you liked it, do save it and follow me for more tech content."

Shown over the name card (`Rushi`, `Senior SDE @Warner Bros`). Same line in both reels. Do not change it per reel.

## 8. Length targets

| Reel type | Duration | Roughly |
| --- | --- | --- |
| Short case study | 45 to 60 s | 120 to 150 spoken words |
| Long myth-bust or deep dive | 80 to 95 s | 220 to 260 spoken words |

Word counts are estimates from the two references, not measured rules.

## 9. Script template

```text
HOOK (4-8 s)
  <Company> <did/claimed a surprising thing>, <with a number or a counter-intuitive twist>.

SETUP (about 10 s)
  Today let's talk about <concept>. Historically, <old way>. This meant <cost>.

BODY (28-70 s, one card per paragraph)
  <Mechanism step 1>. <Step 2>. <Step 3>.
  [Proof] <Authority> officially says <fact>.
  [Consequence] So if <scenario>, <bad outcome>.
  [Right way] <Better approach> works because <reason>.

PAYOFF (8-15 s)
  And the result? <metric 1>, <metric 2>, and <metric 3>.
  -- or --
  So when should you actually use <X>? <Proper use case>. <Why that is fine there>.

CTA (3-4 s)
  Hey, I'm Rushi. If you liked it, do save it and follow me for more tech content.
```

## 10. Reference scripts

Two scripts as transcribed from the reels are in the transcript sections below, for pattern study.

### Airbnb: server-driven auth flows (about 54 s)

1. Airbnb deleted 60% of their authentication code, while actually increasing successful logins.
2. Today, let's talk about server driven authentication architecture.
3. Historically, login flows were hardcoded on the client. If you wanted to test a WhatsApp OTP in Brazil, you had to rewrite the frontend logic and wait for weeks for app store approvals.
4. Airbnb fixed this with an Identify-Then-Challenge type of model.
5. Step one, you type your email.
6. Step two, the client doesn't guess what to do next. It sends a request to a backend.
7. A server side policy engine looks at your context, based on region, device, and history, and returns the exact UI schema for the most likely successful challenge.
8. The client reads this response and instantly turns into an OTP screen.
9. This way the client side logic is stripped down and it just renders server defined screens. Hence no more complex front end state machines figuring out authentication flows.
10. And the result? 27% fewer duplicate accounts, a 100kb smaller web bundle, and the ability to run 20 plus AB tests in days rather than weeks.
11. Hey, I'm Rushi. If you liked it, do save it and follow me for more tech content.

### Uber: DynamoDB TTL vs Redis (about 93 s)

1. There was a mistake in Hello Interview's video explaining Uber system design.
2. The use case was to lock the driver ID for a very short window, like 5 to 10 seconds, while a ride request is routed.
3. To do this, they swapped out Redis and decided to use DynamoDB, specifically relying on the DynamoDB Time to Live, or TTL, feature.
4. On paper it sounds nice, but in reality it completely breaks.
5. DynamoDB TTL is not a precise real-time timer. It does not trigger an immediate callback the exact millisecond your time expires.
6. Instead, it works more like a background cron job. A sweeper process scans your table periodically to look for stale items and deletes them based on its own internal schedule and capacity.
7. Amazon officially states that it can take up to 48 hours for an expired item to actually be deleted from the table.
8. If you set a 10-second lock on a driver, that driver could theoretically remain locked for hours. Your application would still read the expired record unless you write custom filtering logic to ignore the stale timestamps.
9. This is exactly why Redis is the industry standard for this use case. Redis TTL is highly precise. When a key hits its expiration limit, Redis ensures it is immediately invalidated, and if your application tries to access it, it will not be returned.
10. This active and passive eviction makes it perfect for strict, short-lived requirements like a 10-second driver lock.
11. So when should you actually use DynamoDB TTL? It is best suited for data archival. If you want to automatically clean up session logs after 30 days, or clear out old ride receipts after 24 hours, it is the perfect tool.
12. In those cases, you generally do not care if the record is deleted at the 25th hour or delayed by up to 48 hours. Eventual deletion is perfectly fine for these kinds of use cases.
13. For precise, real-time distributed locking, always stick to Redis.
14. Hey, I'm Rushi. If you liked it, do save it and follow me for more tech content.
