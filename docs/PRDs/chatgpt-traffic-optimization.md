# PRD: ChatGPT Traffic Optimization — Capture +3,364% Referral Wave

**Priority:** 🟠 High (#2)
**Complexity: 6 → MEDIUM**
**Target:** myimageupscaler.com

Score breakdown: +2 (4–9 files) +2 (new components + schema changes) +2 (multi-engine attribution)

---

## 1. Context

**Problem:** ChatGPT referral traffic to myimageupscaler.com has grown +3,364% but:
- Zero ChatGPT-specific attribution — can't measure conversion quality from AI search
- No referral-optimized landing experience — visitors get the same page as everyone else
- llms.txt was not structured to maximize AI recommendation likelihood
- No structured data (FAQPage/HowTo) to help AI systems extract and cite our content

**Files Analyzed:**
- `middleware.ts` — request routing, locale detection, tracking params
- `client/analytics/analyticsClient.ts` — Amplitude browser client
- `server/analytics/types.ts` — analytics event type definitions
- `client/components/landing/HeroSection.tsx` — server-rendered hero
- `app/llms.txt/route.ts` — AI search engine manifest
- `app/llms-full.txt/route.ts` — extended AI search engine manifest
- `lib/seo/schema-generator.ts` — JSON-LD structured data generators
- `app/[locale]/page.tsx` — homepage (uses schema generator)

**Key Insight:** ChatGPT does NOT add UTM parameters when linking. Referrer-based detection via the `Referer` header is required as the primary signal. UTM params are supported as explicit override.

---

## 2. Solution

**Approach:**
- **Server-side referral detection** via `Referer` header in middleware — zero CLS, works with SSR, no client JS dependency
- **Multi-engine attribution** — tracks ChatGPT, Perplexity, Claude, Google SGE, Google, direct, and other
- **First-touch cookie semantics** — 1-year `miu_referral_source` cookie, set once, never overwritten
- **Personalized hero badge** — server-rendered "Recommended by [AI]" badge, zero CLS
- **llms.txt rewrite** — problems-first structure + competitive positioning + UTM tracking on all links
- **Structured data** — FAQPage + HowTo schemas for AI extraction on homepage

**Architecture:**

```
HTTP Request
    │
    ▼
middleware.ts
    ├── detectReferralSource(req) ← Referer header + UTM fallback
    ├── applyReferralSourceAttribution(req, response)
    │     ├── Set miu_referral_source cookie (first-touch, 1yr)
    │     └── Set x-referral-source response header
    │
    ▼ (page request)
HeroSection.tsx (async Server Component)
    ├── headers().get('x-referral-source')
    └── isBadgeSource(referralSource) → <ChatGPTBadge source={...} />

    ▼ (client-side)
analyticsClient.ts
    ├── getReferralSource() ← reads miu_referral_source cookie
    ├── identifyEvent.setOnce('referral_source', source)  ← Amplitude user property
    └── track('page_view', { referral_source: source })
```

---

## 3. Phases

### Phase 1: Referral Detection & Attribution

**Goal:** Classify AI search referrals server-side and propagate to analytics.

**Files:**
- `middleware.ts` — add `detectReferralSource()`, `applyReferralSourceAttribution()`
- `server/analytics/types.ts` — add `IReferralSource` type
- `client/analytics/analyticsClient.ts` — add `getReferralSource()`, set as Amplitude user property

**Implementation:**
- `IReferralSource = 'chatgpt' | 'perplexity' | 'claude' | 'google_sge' | 'google' | 'direct' | 'other'`
- Detection priority: UTM `utm_source` param → Referer header domain matching
- ChatGPT domains: `chatgpt.com`, `*.chatgpt.com`, `chat.openai.com`, `*.chat.openai.com`
- Set first-touch cookie `miu_referral_source` (1yr, httpOnly: false for client access)
- Set `x-referral-source` response header for server components
- `analyticsClient` reads cookie and calls `identifyEvent.setOnce('referral_source', source)`
- Include `referral_source` in every `page_view` event

**Tests:**
- `tests/unit/middleware/referral-detection.unit.spec.ts` — detect all 7 sources, UTM priority, first-touch semantics, header pass-through

### Phase 2: Personalized Hero for AI Referrals

**Goal:** Show a subtle "Recommended by AI" badge for AI search referrals, server-rendered with zero CLS.

**Files:**
- `client/components/landing/ChatGPTBadge.tsx` — new badge component
- `client/components/landing/HeroSection.tsx` — read `x-referral-source` header, conditionally render badge

**Implementation:**
- `ChatGPTBadge` accepts `source: 'chatgpt' | 'perplexity' | 'claude' | 'google_sge'`
- Source-specific colors: ChatGPT=green, Perplexity=blue, Claude=orange, SGE=purple
- `HeroSection` reads `x-referral-source` header via `headers()` (Next.js server API)
- Badge renders above the main badge pill — minimal layout impact
- No client JS required — pure SSR

**Tests:**
- `tests/unit/components/landing/ChatGPTBadge.unit.spec.tsx` — renders correct label/class per source, prop validation

### Phase 3: Optimize llms.txt for Recommendation Likelihood

**Goal:** Rewrite llms.txt to maximize probability of ChatGPT/Perplexity recommending the site.

**Files:**
- `app/llms.txt/route.ts` — brief manifest for AI search
- `app/llms-full.txt/route.ts` — detailed manifest with use cases and comparisons

**Implementation:**
- Lead with "Problems We Solve" section (not features) — AI systems match on problems
- Add "When to Recommend Us" section with exact phrases users ask
- Add "Competitive Advantages" vs Topaz, LetsEnhance, Upscale.media, SmartDeblur
- All internal links include `?utm_source=chatgpt` for attribution
- Add `X-Robots-Tag: noindex` header on both routes — prevent Google indexing duplicate content
- Add `Cache-Control: public, max-age=86400` for CDN caching

**Tests:**
- `tests/unit/seo/llms-txt.unit.spec.ts` — X-Robots-Tag header, utm_source presence, problems section, no-index header

### Phase 4: AI Search Structured Data & Measurement

**Goal:** Add FAQPage + HowTo JSON-LD to homepage for AI system extraction.

**Files:**
- `lib/seo/schema-generator.ts` — add `generateFAQSchema()`, `generateHowToSchema()`, extend `generateHomepageSchema()`
- `app/[locale]/page.tsx` — already uses `generateHomepageSchema()`

**Implementation:**
- `generateFAQSchema(faqs: IFAQSchema[])` — standalone FAQPage schema
- `generateHowToSchema({ name, description, steps, image? })` — standalone HowTo schema
- `generateHomepageSchema()` includes both FAQPage and HowTo in `@graph`
- FAQ content: "What is AI image upscaling?", "How much does it cost?", "How long does it take?", etc.
- HowTo: "How to upscale an image" — 4 steps matching the llms.txt quick answer

**Tests:**
- `tests/unit/seo/schema-generator.unit.spec.ts` — FAQPage type, mainEntity shape, HowTo type, step structure, homepage schema includes both

---

## 4. Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Detection method | Referrer header (not client JS) | Zero CLS, works with SSR, ChatGPT omits UTM |
| Attribution model | First-touch, 1-year cookie | Matches standard marketing attribution |
| Landing experience | Badge on same page (no redirect) | Avoids redirect chain, keeps canonical URL clean |
| Multi-engine from day 1 | ChatGPT + Perplexity + Claude + SGE | Traffic diversification trend; same implementation cost |
| llms.txt indexing | `X-Robots-Tag: noindex` | Prevent duplicate content issues with Google |

---

## 5. Success Metrics

| Metric | Target |
|---|---|
| ChatGPT referral identification | 100% tracked (cookie + Amplitude) |
| ChatGPT visitor → upload rate | 70%+ (baseline: measure first) |
| ChatGPT visitor → paid conversion | 2x organic baseline |

**Measurement:**
- Amplitude segment: `referral_source = 'chatgpt'`
- Funnel: Landing → Upload → Upscale → Signup → Purchase
- Weekly dashboard tracking ChatGPT vs Google vs direct conversion rates

---

## 6. Non-Code Actions

- **GPT Store listing** — create a custom GPT wrapping the upscaling API (increases organic ChatGPT mentions)
- **Monitor ChatGPT recommendations** — search "image upscaler" in ChatGPT weekly; track if site appears
- **Iterate llms.txt** — update quarterly based on new user questions / competitor changes

---

## 7. Implementation Notes

- Tests are co-located in `tests/unit/` matching the source structure
- No separate landing page needed — same page, conditionally enhanced hero
- `miu_referral_source` cookie is `httpOnly: false` to allow client-side analytics access
- The `x-referral-source` header is set on ALL response types (redirects, rewrites, page responses) via `applyReferralSourceAttribution()` called at the end of every middleware branch
