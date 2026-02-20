---
title: "DeutschDeck"
description: "Offline-first German spaced repetition app (Web PWA + iPhone) with German-specific card templates, built-in scheduling, and optional cross-device sync."
pubDatetime: 2026-02-17T00:00:00Z
draft: false
techStack:
  - "Next.js (PWA)"
  - "TypeScript"
  - "Dexie / IndexedDB"
  - "SwiftUI"
  - "Core Data"
  - "Spring Boot 3 (REST API)"
  - "PostgreSQL"
  - "Flyway"
  - "Stripe (subscriptions)"
  - "Docker / Kubernetes"
liveUrl: ""
githubUrl: ""
# image: ../../assets/images/deutschdeck.png
keywords:
  - "German flashcard app"
  - "spaced repetition German"
  - "learn German vocabulary"
  - "German language learning app"
  - "offline flashcard app"
  - "spaced repetition app"
  - "der die das practice"
  - "German noun gender learning"
---

DeutschDeck is a **German-first spaced repetition system** designed for adult learners living in Germany.

It combines spaced repetition scheduling with German-specific vocabulary templates and offline-first architecture across Web and iPhone.

## What it does

- Offline-first study on **Web (PWA)** and **iPhone (native)**
- German-optimized note types (nouns with article/plural, verbs with forms, adjectives)
- Deterministic scheduler shared across clients
- Recognition, production, and grammar drill card templates
- Fast capture workflow (add a word in under 10 seconds)
- CSV import and Anki-compatible TSV export
- Optional cross-device sync via operation log
- Versioned scheduling state + immutable review events
- Designed for future AI enrichment (without coupling to core logic)

## Why it matters

Generic flashcard tools force German learners to manually manage grammar-bound attributes like **der/die/das**, plural forms, and verb variations. This leads to inconsistency and friction.

DeutschDeck reduces setup cost and cognitive load by:

- Providing the *right fields by default*
- Optimizing drills for common German pain points
- Ensuring reliable scheduling behavior across devices
- Allowing users to stay productive without mandatory accounts

The system is built around a **local-first philosophy**: learning data lives on the device and sync is optional — not required.

DeutschDeck acts as a focused learning engine for serious German learners who want structure, speed, and long-term retention without unnecessary complexity.
