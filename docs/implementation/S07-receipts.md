# S07 — Multi-receipt ingestion and recovery

Status: in progress; [milestone 4 evidence](M04-receipts-evidence.md). Depends on S06 and G03 client-file evidence.

## Deliver

Implement [receipt contract](../contracts/receipts.md): multi-file input, bounded secure ingestion, per-item company/data validation, duplicate candidates, review selections, Fortnox upload/linking and per-step execution state. Support retrieving existing receipt/attachment references with proper company authorization.

Keep file interpretation in the client. Missing/unclear amount, date or company returns `needs_input`; never silently infer financial facts. Handle upload, voucher creation and linking as separate upstream steps.

## Acceptance

Run T11–T14 with a batch containing successful, invalid, expired-file and uncertain items. Resume only proven-safe incomplete steps. A failed link after successful voucher creation must not create a second voucher. Verify file format/size limits, file-owner binding, redirect/private-address rejection and temporary cleanup in both runtimes.

Show one item per receipt with explicit selected company, amounts, warnings and status. Verify actual multi-file inputs in ChatGPT rather than a mocked URL-only demonstration.

## Handoff

Update supported file matrix and Swedish examples. Record any unsupported client/format and instructions to recover without duplicating bookkeeping.
