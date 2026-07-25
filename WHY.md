<div align="center"><a name="why-top"></a>

# 🎯 Why Stoklore

**The gap this closes:** events and news live in ten different tabs,
your watchlist lives in your head, and by the time you've cross-referenced
all of it the moment to act has usually passed.

</div>

<details>
<summary><kbd>Table of Contents</kbd></summary>

#### TOC

- [👋🏻 The Problem](#-the-problem)
- [🎯 The Bet](#-the-bet)
- [🧭 What "One Place" Actually Means](#-what-one-place-actually-means)
- [🚫 What This Isn't](#-what-this-isnt)
- [🙋 Who It's For](#-who-its-for)

####

</details>

## 👋🏻 The Problem

A retail investor or trader tracking even a modest watchlist ends up
stitching together the same picture by hand, every day:

- A price app for the number
- A news site (or three) for what moved it
- A broker app for what you actually hold
- A notes file, or memory, for the "rule" you told yourself you'd follow
  before you bought

None of these talk to each other. The news doesn't know it's about a stock
you hold. The price move doesn't explain itself. And "should I look into
this" always means opening a browser tab and searching — which is exactly
the moment attention leaks and the decision gets deferred to "later."

<div align="right">

[![][back-to-top]](#why-top)

</div>

## 🎯 The Bet

Stoklore's point of view: the gap between **events/news** and **a decision**
is a *plumbing* problem, not an intelligence problem. Most of what a retail
investor needs isn't a smarter opinion — it's the right facts, about the
right stocks, at the right time, in the same place as the position they're
already tracking, without a search-engine detour in between.

So the app is built around one loop: **watchlist → what changed → why it
changed → does it match a rule I already set for myself** — entirely inside
one tab, with the option to ask a chat agent to go dig further without
leaving the page.

<div align="right">

[![][back-to-top]](#why-top)

</div>

## 🧭 What "One Place" Actually Means

Concretely, in terms of what's already built:

- **Watchlists carry the context.** Events, Top News, and price data are
  all scoped to *your* watchlist, not a generic firehose — see
  [`5` Watchlist Events Feed](README.md#5-watchlist-events-feed) and
  [`9` Top News](README.md#9-top-news).
- **News and announcements come to the stock, not the other way round.**
  Corporate actions, price/volume triggers, and matched news show up
  directly against the symbol you're tracking — no separate search per
  headline.
- **"Analyse it" doesn't mean "leave the app."** `scrape_url` and
  `/sentiment <url>` let you hand the agent a link from any event/news
  card and get sentiment + a rationale back inline — see
  [`2` AI Chat Agent](README.md#2-ai-chat-agent-with-tool-calling) and
  [`6` Sentiment Analysis](README.md#6-sentiment-analysis).
- **"Is this worth acting on" is a rule you own, not a model's opinion.**
  [`8` Watch Rules](README.md#8-watch-rules) turns your own stated criteria
  into a pass/fail check the agent can run for you on demand.
- **It runs on your machine, on your data.** Nothing about your holdings or
  watchlist leaves localhost unless you explicitly point a model at a
  remote API — see the top of [README.md](README.md).

The throughline: every feature earns its place by shortening the distance
between "something happened" and "I know if it matters to me" — not by
adding another feed to check.

<div align="right">

[![][back-to-top]](#why-top)

</div>

## 🚫 What This Isn't

- **Not investment advice.** Watch Rules check *your own* criteria; the
  agent reports pass/fail, never "buy" or "sell."
- **Not a broker.** Holdings sync (Dhan for now, Kite planned) is read-only —
  it mirrors what you already hold, it never places an order or moves funds.
- **Not a replacement for your own judgment** — it's a shortcut to the
  facts your judgment needs, faster than a browser tab.

<div align="right">

[![][back-to-top]](#why-top)

</div>

## 🙋 Who It's For

A retail investor or trader who already keeps a watchlist and checks it
often, and who's tired of the ritual of opening five sites to answer one
question: *"did anything change today that I should care about?"*

<div align="right">

[![][back-to-top]](#why-top)

</div>

[back-to-top]: https://img.shields.io/badge/-BACK_TO_TOP-151515?style=flat-square
