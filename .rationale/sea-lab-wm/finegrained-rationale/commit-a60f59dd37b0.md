---
commit: "https://github.com/sea-lab-wm/finegrained-rationale/commit/a60f59dd37b03189510779f9cabaf1371380853d"
commit_sha: "a60f59dd37b03189510779f9cabaf1371380853d"
repository: "sea-lab-wm/finegrained-rationale"
provider: "codex"
model: "gpt-6-luna"
runs: 1
generated_at: "2026-09-24T14:21:13.532Z"
---

# Rationale for sea-lab-wm/finegrained-rationale@a60f59dd37b0

## GOAL

Replace the reactive Cloud Foundry `WebFilterChainPostProcessor` with a highest-precedence `SecurityWebFilterChain` that permits `/cloudfoundryapplication/**`, disables CSRF, and applies CORS. Update the tests to cover permitted paths, CSRF, and cross-origin requests.

## NEED

The post-processor created a new `WebFilterChainProxy`, discarding custom firewall beans and direct firewall settings. Its default strict firewall could reject valid requests, making Cloud Foundry applications behave differently and forcing users to disable Cloud Foundry management endpoints.

## ALTERNATIVE

The discussion considered obtaining the existing firewall or using a filter-chain decorator, but those approaches could not preserve all customizations. Injecting a firewall bean would miss direct proxy settings. The team also considered delaying the fix, then chose a higher-precedence chain modeled on the servlet configuration.
