---
title: "FOR UPDATE SKIP LOCKED — and when it stops working"
description: "How to calculate the throughput ceiling of SKIP LOCKED, recognize the four degradation signals, and graduate to partition assignment when contention wins."
pubDatetime: 2026-03-06T12:00:00Z
draft: false
tags:
  - "postgres"
  - "distributed-systems"
  - "system-design"
  - "software-architecture"
---

`SELECT ... FOR UPDATE SKIP LOCKED` turns Postgres into a work queue with zero external dependencies. No Redis, no Kafka, no Zookeeper. It works beautifully. Until it doesn't.

At some point your p99 claim latency climbs, workers burn CPU but throughput stays flat, and `pg_stat_activity` fills with lock waits. `SKIP LOCKED` didn't break. You outgrew it.

## Table of contents

## How `SKIP LOCKED` actually works

The standard pattern looks like this: a worker runs a `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction, processes the rows it claimed, updates their status, and commits. The next poll cycle repeats.

```sql
BEGIN;

SELECT * FROM executions
WHERE status = 'PENDING'
  AND scheduled_at <= now()
FOR UPDATE SKIP LOCKED
LIMIT 500;

-- claim them: set status = 'CLAIMED', claimed_at = now()
-- deliver the payload (Kafka produce, HTTP webhook, etc.)
-- set status = 'COMPLETED'

COMMIT;
```

When Postgres encounters `FOR UPDATE`, it tries to acquire a row-level lock on each matching row. Without `SKIP LOCKED`, a second worker running the same query would block, waiting for the first worker's transaction to release its locks. With `SKIP LOCKED`, the second worker silently skips any row that's already locked and moves on to the next one.

This is what makes it work as a queue. Worker A locks rows 1–500. Worker B runs the same query, skips 1–500 (already locked), and gets rows 501–1000. No coordination layer. No external lock manager. Postgres handles the concurrency for you.

There are two properties that make this elegant:

**Self-coordinating:** Workers don't need to know about each other. They don't register, they don't heartbeat, they don't get assigned partitions. They just query the same table and the database sorts it out.

**Self-healing:** If a worker crashes mid-transaction, Postgres rolls back the transaction and releases the row locks automatically. Those rows become visible to the next worker's poll cycle. No stuck jobs, no manual intervention.

## How much throughput can you get?

Most posts about `SKIP LOCKED` stop at "it works." They don't tell you *how much* it can handle. Here's how to calculate it.

Start with a single worker's poll cycle:

| Step | Time |
|---|---|
| `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 500` | ~2–5ms |
| `UPDATE status = 'CLAIMED'` on 500 rows | ~3–5ms |
| `UPDATE status = 'COMPLETED'` on 500 rows | ~3–5ms |
| **Total cycle time** | **~10–15ms** |

One worker processes 500 jobs per cycle. At 10–15ms per cycle, that's roughly 65–100 cycles per second, or **33,000–50,000 jobs per second per worker.**

Scale that up:

| Workers | Theoretical throughput |
|---|---|
| 1 | ~33k–50k jobs/sec |
| 3 | ~100k–150k jobs/sec |
| 5 | ~165k–250k jobs/sec |

These numbers are theoretical maximums. In practice, throughput is lower, and it gets worse in a way that's not obvious.

### Why scaling is sub-linear

When you add a second worker, you don't double throughput. Here's why.

Both workers issue the same `WHERE` clause. They hit the same B-tree index. Worker A scans and locks rows 1–500. Worker B starts its scan at the same point in the index, finds rows 1–500 locked, skips them, and picks up 501–1000. Worker B did the scan work for 1,000 rows but only got 500.

Add a third worker. It scans 1–1000 (all locked), skips them, gets 1001–1500. It did triple the index scan work of Worker A for the same 500 rows.

The skip cost grows linearly with the number of workers. Each additional worker does more wasted work to find unclaimed rows. The 5th worker adds less throughput than the 2nd. The 10th adds even less.

### Other factors that reduce real throughput

**Connection pool pressure.** Each poll cycle holds a database connection for the full transaction duration. If your pool has 20 connections and 10 workers are polling aggressively, you're consuming half the pool just for job claiming. That leaves less room for other queries.

**Delivery time inside the transaction.** If you deliver the payload (HTTP call, Kafka produce) while the transaction is open, the lock duration extends from ~15ms to potentially hundreds of milliseconds. This dramatically increases how many rows other workers have to skip. Always deliver *outside* the transaction.

**Vacuuming.** Postgres implements `UPDATE` as a delete-and-insert under MVCC. Every status change creates a new tuple version and leaves a dead tuple behind. Two transitions per job (PENDING → CLAIMED → COMPLETED) means ~100k dead tuples per second at 50k jobs/sec. Autovacuum needs to keep up, or the table bloats and index scans slow down. (See [Tuning Postgres for queue tables](#tuning-postgres-for-queue-tables) below for specific settings.)

The realistic ceiling for `SKIP LOCKED` with 3–5 workers on a well-tuned Postgres instance is roughly **30k–80k jobs/sec.** Beyond that, you're fighting contention.

## What breaks: the four degradation signals

`SKIP LOCKED` doesn't fail with an error. It degrades gracefully, which makes it harder to notice. Here are the four signals, in the order you'll typically see them.

### Signal 1: Poll cycle time inflation

This is the earliest and most direct indicator.

| State | Poll cycle p99 |
|---|---|
| Healthy | 10–15ms |
| Degrading | 30–50ms |
| Trouble | 100–200ms |
| Broken | 500ms+ |

The cause is always the same: workers are scanning more rows to find unclaimed ones. As contention increases, each worker's `SKIP LOCKED` scan has to walk past more locked rows before finding its batch.

Instrument your poll loop. Track `poll_cycle_duration_ms` as a histogram. If p99 doubles and stays there, contention is building.

### Signal 2: Lock waits in `pg_stat_activity`

Query `pg_stat_activity` and look for `wait_event_type = 'Lock'` on your poller connections. In a healthy system, `SKIP LOCKED` avoids lock waits entirely. That's the whole point. If you see them, it means workers are somehow contending on the same rows, which can happen when the index scan pattern breaks down under high concurrency.

```sql
SELECT pid, wait_event_type, wait_event, query
FROM pg_stat_activity
WHERE query LIKE '%executions%'
  AND wait_event_type = 'Lock';
```

Any consistent results here are a warning sign.

### Signal 3: DB CPU high but throughput flat

This is the classic contention signature. The database is working hard, CPU at 70–90%, but the number of jobs processed per second isn't increasing.

The CPU is being spent on lock management, index scanning past locked rows, and transaction coordination. It's overhead, not useful work. Adding more workers at this point makes it worse, not better.

### Signal 4: SLA slippage

Your business metric (e.g., "fire within 5 seconds of scheduled time") starts degrading. This is the trailing indicator. By the time it alerts, signals 1–3 have been active for hours.

## The burst problem: why time clustering kills you

Here's the scenario that breaks `SKIP LOCKED` even at moderate average throughput.

You run a billing system. Every night at midnight UTC, 200,000 subscription renewals are scheduled. Or your marketing team sends a campaign, and 500,000 delayed notifications are all set to fire at the same second.

Under steady load, jobs spread evenly across time, and `SKIP LOCKED` works fine. The index on `(status, scheduled_at)` distributes workers across different pages. But when 200k jobs share the same `scheduled_at` value, every worker's `WHERE scheduled_at <= now()` query hits the exact same index range.

Worker A scans the range and locks rows 1–500. Worker B starts at the same index position, walks past 500 locked rows, gets 501–1000. Worker C walks past 1,000 locked rows, gets 1001–1500.

With 10 workers, Worker 10 walks past 4,500 locked rows to find its 500. With 20 workers, Worker 20 walks past 9,500 rows. The scan cost grows linearly with the number of competing workers, and they're all fighting over the same narrow index range.

**`SKIP LOCKED` doesn't degrade based on total volume. It degrades based on how many jobs cluster into the same index range at the same time.**

You can have 100k jobs/sec of uniformly distributed traffic and be fine. You can have 30k jobs/sec with a midnight spike and be in trouble.

### The cheapest fix: jitter

Before reaching for a new architecture, try this: when inserting jobs, add a small random offset to the fire time.

```sql
INSERT INTO executions (scheduled_at, ...)
VALUES (
  :scheduled_at + (random() * INTERVAL '5 seconds'),
  ...
);
```

If your SLA is "fire within 5 seconds," adding 0–5 seconds of jitter keeps you within the SLA while spreading 200k jobs across a 5-second window instead of a single second. Workers' index scans now land on different pages naturally.

This costs nothing. No infrastructure changes. No new dependencies. It buys you 2–3x headroom on burst scenarios. It's the kind of trick you should always try before escalating to a new pattern.

## Graduating to partition assignment

At some point you need to move past `SKIP LOCKED`. Whether because of sustained high throughput, bursty workloads, or both. The next pattern is partition assignment: instead of having all workers compete over the same table, you give each worker a deterministic slice.

### How it works

Add a `bucket` column to your executions table. When inserting a job, assign it a bucket in application code:

```sql
ALTER TABLE executions ADD COLUMN bucket SMALLINT NOT NULL DEFAULT 0;

-- At insert time:
INSERT INTO executions (bucket, scheduled_at, status, ...)
VALUES (floor(random() * 64), :scheduled_at, 'PENDING', ...);
```

Create a partial index that covers the poll query:

```sql
CREATE INDEX idx_executions_bucket_poll
  ON executions (bucket, scheduled_at)
  WHERE status = 'PENDING';
```

Each worker is assigned a subset of buckets. With 4 workers and 64 buckets:

- Worker 0 owns buckets 0–15
- Worker 1 owns buckets 16–31
- Worker 2 owns buckets 32–47
- Worker 3 owns buckets 48–63

Each worker's poll query filters on its assigned buckets:

```sql
SELECT * FROM executions
WHERE bucket IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15)
  AND status = 'PENDING'
  AND scheduled_at <= now()
LIMIT 500
```

Notice what's missing: `FOR UPDATE SKIP LOCKED`. You don't need it. No other worker will ever touch these rows. There's no contention to skip.

### Why this scales linearly

With `SKIP LOCKED`, adding workers increases contention. With partition assignment, adding workers increases throughput proportionally because each worker operates on an independent slice. The 5th worker adds exactly the same throughput as the 2nd.

There's no index scan overlap. No rows to skip. No lock management overhead. Each worker reads its own subset as if it were the only one.

### Why 64 buckets and not N

If you set the bucket count equal to the number of workers, you have to repartition every time a worker joins or leaves. With fixed logical buckets, you just redistribute the assignment.

Worker 2 dies? Redistribute its 16 buckets across the three survivors. A new worker joins? Take 4 buckets from each existing worker and assign them to the newcomer. The bucket count never changes, only the mapping.

Choose a bucket count that's large enough to distribute evenly across your maximum expected worker count. 64 or 128 is a common choice.

### The cost: you need a coordinator

With `SKIP LOCKED`, Postgres is the coordinator. With partition assignment, you need to build one. Something has to:

1. **Track which workers are alive.** Workers send heartbeats (every 5–10 seconds). A worker that misses 3 heartbeats is considered dead.
2. **Assign buckets to workers.** On startup, or when a worker dies, buckets are redistributed.
3. **Handle rebalancing.** When a new worker joins, some buckets need to move.

This is the same problem that Kafka consumer groups solve with the group coordinator protocol. You can implement it several ways:

- **Postgres advisory locks.** Each worker acquires advisory locks for its assigned buckets. Simple, no new infrastructure, but advisory locks have quirks (session-level vs. transaction-level, no built-in expiry).
- **Redis leases.** Each worker holds a Redis key with a TTL for each bucket. If the key expires, another worker can claim it. Simple and battle-tested.
- **Zookeeper / etcd.** Ephemeral nodes or lease-based registration. More infrastructure to maintain, but well-understood coordination primitives.

The choice depends on what's already in your stack. If you have Redis, use Redis. If you don't, Postgres advisory locks work fine at moderate scale.

### Comparison

| | `SKIP LOCKED` | Partition assignment |
|---|---|---|
| Coordination | Postgres handles it | You build a coordinator |
| Contention | Grows with worker count | Zero |
| Scaling | Sub-linear | Linear |
| Burst handling | Degrades with time clustering | Unaffected |
| Failure recovery | Automatic (locks release on crash) | Need rebalancing logic |
| Practical ceiling | ~50k jobs/sec | ~200k+ jobs/sec |
| Operational cost | None | Moderate |

The trade is explicit: you're replacing invisible database contention with visible coordination complexity. The coordination is more work to build, but its behavior is predictable and its limits are higher.

## Decision framework: when to graduate

Instead of "it depends," here are concrete decision rules.

### Stay on `SKIP LOCKED` when:

- Your sustained throughput is under 50k jobs/sec
- You don't have severe time clustering, or you've added jitter
- You're running 5 or fewer workers
- You don't want to build or maintain coordinator infrastructure
- Your poll cycle p99 is under 30ms

This is a good place to be. Most job scheduling systems never outgrow this. Don't over-engineer.

### Graduate to partition assignment when:

- Poll cycle p99 consistently exceeds 50ms
- Adding more workers stops increasing throughput (or makes it worse)
- You have bursty workloads that cluster into the same second
- You're planning to shard the database (partition assignment maps naturally to shards, so each worker's slice can live on a different DB instance)

### Skip both and use a message broker when:

- You need sustained throughput above 200k jobs/sec and Kafka is already in your stack
- You're willing to give up the database as the single source of truth for job state. The DB becomes a fallback for failure recovery, not the primary coordination mechanism

## Tuning Postgres for queue tables

Default Postgres settings are tuned for general OLTP, not high-churn queue tables. Four changes extend the life of `SKIP LOCKED` (or partition assignment) significantly.

### 1. Use a partial index to keep the scan tight

**Problem:** A composite index on `(status, scheduled_at)` includes every row in the table. Millions of `COMPLETED` rows that no worker will ever touch. The index bloats, scans slow down.

**Solution:** Use a partial index that only covers the rows workers care about.

```sql
CREATE INDEX idx_pending_poll ON executions (scheduled_at)
  WHERE status = 'PENDING';
```

**The benefit:** The index stays small. Only pending rows. When a job moves to `CLAIMED` or `COMPLETED`, it exits the index entirely. Workers scan a tight, relevant index instead of wading through dead weight.

### 2. Reserve page space with FILLFACTOR

**Problem:** Postgres pages fill to 100% by default, leaving no room for new row versions on the same page.

**Solution:** Lower FILLFACTOR to reserve headroom for in-place updates.

```sql
ALTER TABLE executions SET (fillfactor = 70);
```

**Impact:** Once a row exits the partial index (PENDING → CLAIMED), subsequent updates to non-indexed columns like `claimed_at` and `attempt_count` can become HOT (Heap Only Tuple) updates that skip index maintenance entirely. FILLFACTOR makes room for these on the same page, reducing I/O.

### 3. Aggressive autovacuum for high churn

**Problem:** At 50k jobs/sec, you generate ~150k dead tuples per second. Default vacuuming can't keep up.

**Solution:** Force vacuum to work harder on your queue table.

```sql
ALTER TABLE executions SET (
  autovacuum_vacuum_scale_factor = 0.01,    -- trigger at 1% bloat (default: 20%)
  autovacuum_vacuum_cost_limit = 2000,      -- increase work capacity (default: 200)
  autovacuum_vacuum_cost_delay = 2          -- reduce wait between cycles (default: 2ms in v14+)
);
```

Monitor `pg_stat_user_tables.n_dead_tup`. If dead tuples are consistently growing, vacuum isn't keeping up.

### 4. Archive completed rows

**Problem:** Completed rows accumulate. The table grows to tens of millions of rows. Indexes bloat, vacuum takes longer, every scan gets slower.

**Solution:** Move completed rows to a history table or delete them on a schedule. A queue table should contain the working set, not the archive. Hundreds of thousands of rows, not tens of millions.

## Summary

`FOR UPDATE SKIP LOCKED` is one of the best primitives in Postgres. It turns your database into a work queue with zero external dependencies, automatic failure recovery, and transactional safety. For most workloads, it's all you need.

The mistake isn't using it. The mistake is not knowing when you've outgrown it, and not having the next pattern ready.

Measure your poll cycle time. Watch for the contention signals. Add jitter for bursts. And when the math stops working, graduate to partition assignment: same table, same data model, just a different coordination strategy.
