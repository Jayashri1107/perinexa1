# Choosing the AI service for Perinexa (prices checked 30 Sep 2026)

For smart features 4–9 (visit summary, advice translation, letters, smarter risk, reading reports, asking the
records). Prices are the providers' published pay-as-you-go API rates, in US dollars per **1 million tokens**
(1 token ≈ ¾ of an English word). Rupees at about ₹88 per $1. Prices change often: check again before signing up.

## Price per 1 million tokens

| Provider | Model | Input | Output | ≈ One visit summary* | India data residency |
|---|---|---|---|---|---|
| **Anthropic (Claude)** | Claude Opus 5.5 (most capable) | $4.00 | $20.00 | ≈ ₹1.60 | Through AWS Bedrock: India cross-region routing (Mumbai + Hyderabad) |
| | Claude Sonnet 5.5 (balanced) | $2.00 | $10.00 | ≈ ₹0.80 | same |
| | Claude Haiku 4.5 (fast, cheap) | $1.00 | $5.00 | ≈ ₹0.40 | same |
| **OpenAI (ChatGPT)** | GPT-5.5 | $2.50 | $15.00 | ≈ ₹1.05 | India = storage only; processing may happen abroad; needs sales approval |
| | GPT-5.4 mini | $0.375 | $2.25 | ≈ ₹0.15 | same |
| **Google (Gemini)** | Gemini 3.1 Pro (preview) | $2.00 | $12.00 | ≈ ₹0.85 | Vertex AI Mumbai region (asia-south1) |
| | Gemini 3.8 Flash (offer price to 31 Dec 2026) | $0.75 | $3.75 | ≈ ₹0.30 | same |
| **Sarvam AI (Indian)** | Sarvam 105B | ₹29.28 | ₹73.20 | ≈ ₹0.11 | Indian company, data in India |
| **On our own computer** | Open model (e.g. Llama / Gemma) | free | free | ₹0 (electricity) | Nothing leaves the computer |

\* One visit summary ≈ 3,000 tokens in (the record) + 300 tokens out. The models "think" before answering,
which adds output tokens, so real cost can be 2–3 times this. Example: 30 patients a day × 25 days = 750
summaries a month ≈ ₹600–1,800 a month on Claude Sonnet 5.5. Reading a photo or PDF of a report costs more
(a page is ~1,500–3,000 tokens).

Discounts: all three big providers take 50% off for "batch" work (answers within hours, not seconds – fine for
e.g. overnight worklist summaries) and charge much less for repeated text ("caching").

## Other things that matter for a medical app

| | Claude | OpenAI | Gemini | Sarvam | Own computer |
|---|---|---|---|---|---|
| Quality on medical text and long records | Very high | Very high | High | Medium | Low–medium |
| Marathi / Hindi | Good | Good | Good | Very good (India-focused) | Weak |
| Reads photos/PDFs of reports | Yes | Yes | Yes | Limited | Limited |
| Paid API data used for training | No | No | No (paid tier only) | Check terms | n/a |
| Health-data agreements | HIPAA-ready offering (Enterprise); Bedrock covered by AWS agreements | Zero-retention on approval | Zero-retention terms on Vertex (enterprise) | Check | n/a |
| Easiest to start with fake data | Yes (API key) | Yes | Yes | Yes | Needs a powerful computer |

Notes
- India's DPDP Act 2023 applies to patient data. For real patients, choose an option that keeps processing in
  India (AWS Bedrock India routing for Claude, or Google Vertex Mumbai for Gemini) and sign the provider's data
  agreement. Until then Perinexa uses fake data only.
- Perinexa can be built so the provider can be changed later; the first choice is not permanent.
- Disclosure: this comparison was prepared by Claude, which is made by Anthropic.

Sources: [Claude pricing](https://claude.com/pricing), [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing),
[OpenAI prices (pricepertoken, 29 Sep 2026)](https://pricepertoken.com/pricing-page/provider/openai),
[OpenAI data residency in India](https://creuto.com/openai-data-residency-india-uae),
[OpenAI: data residency in Asia](https://openai.com/index/introducing-data-residency-in-asia/),
[Claude on Amazon Bedrock – India cross-region inference](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-expands-claude-model-availability-to-india-cross-region-inference/),
[Vertex AI locations](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations),
[Sarvam API pricing](https://docs.sarvam.ai/api/getting-started/pricing).
