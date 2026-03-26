---
title: "The dependency that's 'up' is taking you down"
description: "A dead dependency fails fast. A slow one holds threads, exhausts connection pools, and cascades failure to everything upstream. How to treat slow the same as dead with timeouts, bulkheads, and fast-fail."
pubDatetime: 2026-03-18T12:00:00Z
draft: false
tags:
  - "distributed-systems"
  - "system-design"
  - "software-architecture"
  - "resilience"
---

A dead dependency fails fast. You get an error in milliseconds, circuit breaker opens, fallback kicks in. A slow dependency holds threads, exhausts connection pools, and cascades failure to everything upstream. The fix: treat slow the same as dead. Aggressive timeouts, bulkheads, and fast-fail.

## Table of contents

## The 3 AM page

It's 3 AM. You get paged. Your API is returning 500s. You pull up the dashboard. Your downstream payment service isn't down. It's responding. Just taking 8 seconds instead of 200ms.

Every thread in your application is blocked, waiting for a response that will eventually come. Your connection pool is exhausted. New requests pile up behind threads that are doing nothing. Your service is effectively dead, killed by a dependency that's technically alive.

You restart the pods. They come back, immediately fill their thread pools with slow calls, and die again. You're in a loop. The dependency that's "up" is taking you down harder than if it had crashed.

This is the most dangerous failure mode in distributed systems: the slow dependency. It's worse than a dead one in every way that matters.

## Why dead is easy

When a dependency dies, you know immediately. The call fails in milliseconds and you get a clear error.

Your circuit breaker detects it within a few failed requests. It opens. Subsequent calls short-circuit immediately. Your fallback logic kicks in: return a cached value, degrade gracefully, return 503. Whatever you've designed.

The critical property of a dead dependency is that **it gives your threads back immediately.** A call that fails in 2ms frees that thread to serve the next request. Your service stays responsive to traffic that doesn't touch the dead dependency. Alerting fires. An engineer fixes the downstream issue. You recover.

Dead is loud, fast, and recoverable.

## Why slow is deadly

A slow dependency gives you none of those properties. There's no error signal. Just waiting. The TCP connection is open. Bytes are (eventually) flowing. From your application's perspective, the call is in progress. There's nothing to catch, nothing to retry, nothing to circuit-break on.

Meanwhile, every thread making that call is blocked. It can't serve other requests. It can't time out (unless you've set one, and most people set them too high or not at all). It just... waits.

If you're on a non-blocking stack (Netty, WebFlux, Node.js), you might think you're immune because you don't have a thread-per-request model. You're not. Non-blocking I/O saves your worker threads, but it doesn't save your downstream connection pool or the memory consumed by the growing backlog of pending requests. A slow dependency still saturates the pool and exhausts the pending-request queue. The failure mode shifts from "blocked threads" to "unbounded backpressure," but the outcome is the same: your service stops making progress.

Here's where the math gets brutal.

### Thread pool exhaustion

Spring MVC (Tomcat) defaults to 200 worker threads. Under normal conditions, a request that calls a downstream service takes 200ms round-trip. Each thread handles ~5 requests per second. Your pool of 200 threads serves **~1,000 requests per second.**

Now the downstream service slows down. Latency goes from 200ms to 8 seconds. Not unrealistic for a service under load or one experiencing a full GC pause.

Each thread now handles roughly one request every 8 seconds. Your pool of 200 threads serves **~25 requests per second.** You've lost ~97% of your capacity. The remaining requests get no thread. They queue, then time out, then fail.

| Dependency latency | Requests/sec (200 threads) | Capacity used |
|---|---|---|
| 200ms (normal) | ~1,000/sec | 100% |
| 1s | 200/sec | 20% |
| 3s | ~67/sec | ~7% |
| 5s | 40/sec | 4% |
| 8s | 25/sec | 2.5% |

And it happens fast. At 1,000 req/sec inbound and 5-second downstream latency, all 200 threads fill almost instantly. Every request after that queues, and no thread frees up for another 5 seconds. Your monitoring interval is probably 30 seconds. The damage is done long before your first alert.

A dependency doesn't have to be dead to kill you. It just has to be slow enough to hold your connections hostage.

### The gray failure problem

This is what makes slow dependencies insidious. Your health checks pass. The service is up, it can reach the database, it returns 200 on `/health`. Your metrics might even look normal for a few minutes: request count is up (because requests are queuing), error rate is low (because nothing has technically failed yet), CPU is fine (threads are blocked, not computing).

By the time errors start appearing (connection pool timeouts, 503s, upstream cascading failures), the system is already deep in trouble. The failure was invisible until it was catastrophic.

One metric catches this early: **outbound request latency per dependency** — specifically the p99, not the average. If your calls to a downstream service jump from 200ms to 2 seconds, the p99 moves long before the average does. Monitor this — not just `/health`.

Dead services announce themselves. Slow services hide.

## The cascade: how one slow service kills everything

This is the part that turns a single slow dependency into a multi-service outage.

Trace the failure path:

1. **Service B slows down.** Response time goes from 200ms to 5 seconds. It's not down. Just slow.
2. **Service A calls Service B.** A's threads block for 5 seconds per call instead of 200ms. A's thread pool fills up.
3. **Service A stops responding.** It's not down either. It's just not processing new requests because all threads are occupied.
4. **Service C calls Service A.** C's threads block. C's connection pool fills.
5. **The cascade continues.** Every service upstream of B inherits B's latency and adds its own queuing delay on top.

The latency is additive. If B is at 5 seconds, A is at 5+ seconds, C is at 10+ seconds (waiting for A, which is waiting for B). Each hop amplifies the problem.

And every service in the chain experiences the same pool exhaustion math from above. Service A's pool fills almost instantly. Service C, now waiting on a blocked Service A, fills its pool just as fast. The cascade doesn't propagate at the speed of your monitoring. It propagates at the speed of your inbound request rate.

## The fix: treat slow as dead

The core insight is this: **a slow dependency should trigger the same protective responses as a dead one.** Don't wait for it. Don't hope it recovers. Cut the call, free the thread, and move on.

Four patterns, layered together, make this work.

### 1. Aggressive timeouts

The first line of defense. Every call to an external dependency needs two timeouts:

- **Connection timeout:** how long to wait for the TCP handshake. This is just the doorbell. If the service doesn't answer quickly, it's either down or unreachable. For internal services (same VPC/datacenter), 1 second is plenty. For external services (third-party APIs, cross-region calls), allow 3–5 seconds since cross-internet handshakes through DNS chains, proxies, or VPNs legitimately take longer.
- **Read timeout:** how long to wait for a response after the connection is established. This is where the actual work happens and where threads hang during a slowdown. Set it to a few multiples of your p99 latency, not your worst case.

Here's an OkHttp client configured for a downstream service:

```kotlin
val client = OkHttpClient.Builder()
    .connectTimeout(1, TimeUnit.SECONDS)
    .readTimeout(1, TimeUnit.SECONDS)
    .build()
```

The defaults for most HTTP clients are 10–30 seconds. Most developers assume their framework's defaults are best practices. They're not. Defaults like 30 seconds are chosen to prevent accidental failures in low-traffic, high-latency environments. In a high-scale distributed system, a 30-second default is a suicide pact. That's 30 seconds of a blocked thread, during which hundreds of other requests have piled up behind it.

**The rule:** set your timeout to a few multiples of your p99 latency, not your worst case. If your downstream service's p99 is 300ms, a 1-second read timeout gives you enough headroom for normal variance while still failing fast under genuine overload. Don't set it to your p99.9 or your worst-ever observed latency. Those are the exact scenarios where you *need* to fail fast.

The same principle applies to database connection pools. HikariCP's default `connection-timeout` is 30 seconds. A request will block for 30 seconds waiting for a pool connection before failing. Set it to 2 seconds:

```yaml
spring:
  datasource:
    hikari:
      connection-timeout: 2000   # 2s, fail fast if pool is exhausted
```

And for socket-level query timeouts, use JDBC's `socketTimeout`:

```
jdbc:postgresql://host:5432/db?socketTimeout=2
```

This kills any query that takes longer than 2 seconds, regardless of whether the connection pool had room. Teams often fix the HikariCP timeout (waiting for a seat at the table) but forget the JDBC socket timeout (waiting for the food to arrive). If you only fix the pool timeout, a single slow query can still hold a connection hostage for minutes once it's been checked out.

A timeout is not just a safety net. It's a contractual limit on how much of your capacity you're willing to bet on a single call.

### 2. Bulkhead (semaphore isolation)

Timeouts protect individual calls. But even with a 2-second timeout, if you have 200 threads each waiting 2 seconds, you have 200 blocked threads. The timeout limits *how long* each thread is stuck. The bulkhead limits *how many* threads can be stuck at once.

The pattern: wrap every call to a shared dependency in a semaphore that limits concurrency. If all permits are taken, fail immediately instead of queuing.

```kotlin
@Component
class Bulkhead(
    private val maxConcurrent: Int = 50
) {
    private val permits = Semaphore(maxConcurrent, true)
    private val rejected = AtomicLong(0)

    fun <T> run(block: () -> T): T {
        if (!permits.tryAcquire()) {
            rejected.incrementAndGet()
            throw BulkheadRejectedException("bulkhead_full")
        }
        try {
            return block()
        } finally {
            permits.release()
        }
    }

    fun availablePermits(): Int = permits.availablePermits()
    fun rejectedCount(): Long = rejected.get()
}

class BulkheadRejectedException(message: String) : RuntimeException(message)
```

The critical detail is `tryAcquire()` with no wait. If all permits are in use, it rejects immediately rather than queuing behind slow calls — which is exactly the behavior you want when a dependency is degraded.

The bulkhead here is set to 50 permits. The right number depends on the dependency. For a database, start at or slightly above your pool size. For an HTTP dependency, base it on how many concurrent outbound calls your service can tolerate before latency degrades. The key is that it's a hard cap, not a suggestion.

You create a bulkhead per dependency and wrap every call through it:

```kotlin
val paymentBulkhead = Bulkhead(maxConcurrent = 30)

val result = paymentBulkhead.run {
    paymentClient.charge(order)
}
```

Under normal load, permits are always available and the bulkhead is invisible. Under overload, it's the difference between 30 threads blocked and 500 threads blocked.

### 3. Fast-fail (load shedding)

When the bulkhead rejects a request, what happens? You could retry, you could queue, you could block. The right answer: **return 503 immediately.**

```kotlin
@RestControllerAdvice
class GlobalExceptionHandler {

    @ExceptionHandler(BulkheadRejectedException::class)
    fun handleBulkheadRejected(ex: BulkheadRejectedException): ResponseEntity<Map<String, Any>> {
        return ResponseEntity.status(503).body(
            mapOf<String, Any>(
                "error" to "overloaded",
                "reason" to ex.message.toString(),
                "retryable" to true
            )
        )
    }
}
```

This is counter-intuitive. You're *choosing* to fail requests. How does failing requests improve availability?

Because **the requests you do accept still succeed at normal latency.** Without load shedding, every request enters the pool queue, threads block, latency spirals, and eventually everything times out. 100% of traffic fails. With the bulkhead, only as many requests as you have permits are in-flight at once. The rest get an immediate 503. The in-flight requests complete normally, the shed requests know to retry with backoff, and your service stays responsive instead of collapsing.

Shedding load is not a failure of your system. It's your system working correctly under pressure.

One caveat: fast-fail only works if your callers handle 503s correctly. If upstream services blindly retry every 503 without backoff, you've replaced a slow death with a retry storm, a self-inflicted DDoS on a dependency that's already struggling. Every caller retrying a 503 should use **exponential backoff with jitter.** Without it, the moment the slow dependency starts recovering, a thundering herd of retries pushes it right back under.

### 4. Circuit breaker

The patterns above protect against sudden slowdowns. A circuit breaker protects against *sustained* failure. After N timeouts or errors within a time window, the circuit breaker opens and stops calling the dependency entirely for a cooldown period.

The state machine:

- **Closed** (normal): requests flow through. Failures are counted.
- **Open** (tripped): all requests fail immediately without calling the dependency. A timer runs.
- **Half-open** (testing): after the timer expires, one request is allowed through. If it succeeds, the circuit closes. If it fails, it re-opens.

When to use circuit breaker vs. bulkhead:

**Bulkhead** limits concurrent calls to prevent thread exhaustion. It's always active, protecting against bursts. It answers: *"How many calls can be in-flight at once?"*

**Circuit breaker** stops all calls after detecting sustained failure. It's reactive, protecting against persistent outages. It answers: *"Should we even try calling this dependency right now?"*

They solve different problems. Use both. The bulkhead protects you during the first few seconds of a slowdown. The circuit breaker kicks in once the pattern is established and prevents wasting resources on a dependency that's clearly impaired.

Circuit breakers are most valuable for external services and webhooks — dependencies you don't control and that can be down for minutes or hours.

## Proving it: load test before you ship

None of these patterns matter if you don't verify them under realistic conditions. Timeouts, bulkheads, and circuit breakers are configuration, and configuration that's never been tested under load is just a guess. Run a load test that deliberately injects latency into your dependencies and ramps traffic past your capacity. You need to see your bulkhead shed requests, your timeouts fire, and your circuit breaker trip. In a staging environment, not at 3 AM in production. If you've never seen your system fail gracefully under controlled overload, you have no reason to believe it will.

## Summary

A dead dependency is a solved problem. Connection refused, circuit open, fallback served, move on. You've probably already built for this.

A slow dependency is an unsolved problem hiding behind a "healthy" status check. It holds your threads, drains your pools, and cascades failure upstream. All while technically responding.

Set your timeouts. Add a bulkhead. And make your system treat a slow dependency the same way it treats a dead one: by not waiting.
