# COMFLY Remove Background Root Cause Evidence

## Summary

- Baseline failure time: `2026-04-02 10:43` Asia/Shanghai
- Baseline log: `/Volumes/ZO/ZO.DESIGN/logs/2026-04-02/02-43-44-0v270m.app.log`
- Requested path: `POST /recraft/v1/images/removeBackground`
- Runtime endpoint actually used: `https://ai.comfly.org/recraft/v1/images/removeBackground`
- Upstream result: `500 Internal Server Error`
- Upstream body: `{"code":"custom_router_error","message":"unknown error","data":null}`

## Source Image

- File: `/Volumes/ZO/ZO.DESIGN/public/uploads/img-1774411429431-ft8hyt.png`
- MIME: `image/png`
- Bytes: `1224000`
- Dimensions: `1024x1024`

This image is within the public Recraft remove-background constraints and is not a likely root cause by itself.

## Baseline Evidence

1. UI request reached the local route and created a `request.start` log entry at `2026-04-02T02:43:44.228Z`.
2. The local route created a `supplier.dispatch` log entry with endpoint `https://ai.comfly.org/recraft/v1/images/removeBackground`.
3. The COMFLY upstream returned `500 Internal Server Error` with `content-type: application/json; charset=utf-8`.
4. The returned payload body preview was `{"code":"custom_router_error","message":"unknown error","data":null}`.
5. The local route classified the failure as `supplier.error`, not `supplier.parse_error`, `supplier.payload_invalid`, or `download_result`.

## Reproduction Matrix

| Entry | Target | Result | Key Evidence |
| --- | --- | --- | --- |
| Canvas UI -> local route -> COMFLY | `https://ai.comfly.org/recraft/v1/images/removeBackground` | `500` | Local route logs `supplier.error` with `custom_router_error` |
| Smoke script documented path | `https://ai.comfly.org/recraft/v1/images/removeBackground` | `500` | Same upstream body preview as UI path |
| Smoke script wrong candidate | `https://ai.comfly.org/v1/recraft/v1/images/removeBackground` | `404` | Upstream says `Invalid URL` and points back to `POST /recraft/v1/images/removeBackground` |

## Minimal Reproduction Curl

Correct documented path:

```bash
curl -X POST "https://ai.comfly.org/recraft/v1/images/removeBackground" \
  -H "Authorization: Bearer $COMFLY_API_KEY" \
  -F "file=@/Volumes/ZO/ZO.DESIGN/public/uploads/img-1774411429431-ft8hyt.png;type=image/png" \
  -F "response_format=url"
```

Known incorrect candidate for contrast:

```bash
curl -X POST "https://ai.comfly.org/v1/recraft/v1/images/removeBackground" \
  -H "Authorization: Bearer $COMFLY_API_KEY" \
  -F "file=@/Volumes/ZO/ZO.DESIGN/public/uploads/img-1774411429431-ft8hyt.png;type=image/png" \
  -F "response_format=url"
```

## Why This Rules Out An Interface Typo

- The documented path and the runtime path are the same: `/recraft/v1/images/removeBackground`.
- The wrong candidate path returns `404` and explicitly says the correct path should be `POST /recraft/v1/images/removeBackground`.
- The correct documented path does not return `404` or `405`; it reaches COMFLY and fails inside their router with `custom_router_error`.
- The request is sent as `multipart/form-data` with `file` and `response_format=url`, matching the documented remove-background contract.

## Current Root Cause Verdict

The strongest current hypothesis is:

`our request construction is correct -> COMFLY documented route is correct -> COMFLY proxy/router or its downstream Recraft forwarding fails internally`

Based on the current evidence, this is not primarily an endpoint naming mistake.

## Attachments

- Smoke results JSON: `/Volumes/ZO/ZO.DESIGN/docs/remove-background/2026-04-02-comfly-smoke-results.json`
- Baseline route log: `/Volumes/ZO/ZO.DESIGN/logs/2026-04-02/02-43-44-0v270m.app.log`
