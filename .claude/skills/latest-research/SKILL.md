---
name: latest-research
description: Corncam research protocol. Use when researching models, repos, datasets, papers or tools for the deepfake Forger/Detective (image, video, audio, text). Enforces the team's recency and reputation rules, Context7-first docs, reading real code, and writing findings into docs/.
---

# Corncam research protocol

Topic to research: $ARGUMENTS

## Rules (team requirements — do not skip)
1. **Recency:** only use as dependencies repos/models/docs pushed or released in the last ~12 months. Older work = history or lesson only, labelled as such.
2. **Reputation:** prefer repos with high stars **and** forks **and** recent pushes. Always report ★ / forks / last push.
3. **Context7 first** for any library/API docs (`resolve-library-id` → `query-docs`). If Context7 doesn't index a project, read its code with `gh api`.
4. **Read the code**, not just the README: model class, inference script, device handling (must run on Apple Silicon M4, 16 GB, MPS/CPU), dependencies, license.
5. **Independent evidence over vendor claims:** look for benchmarks with held-out labels (e.g. podonos audio benchmark, NTIRE challenges, Smaug's same-test-set table). Flag vendor-reported numbers.

## Mandatory sources (in this order)
1. Context7: enterprise docs (Hive, Sightengine, Resemble, Reality Defender) for how production does it.
2. GitHub: reputable, active repos; read code.
3. Chinese labs: CUHK-Shenzhen (SCLBD/DeepfakeBench, YZY-stack/DF40, Effort), Sichuan Univ (scu-zjz/IMDLBenCo, ForensicHub), PKU (FakeShield), ModelScope. Don't rely on Chinese-keyword GitHub search (spam).
4. Benchmarks/challenges with held-out labels.
5. Verify on our own data before trusting.

## Search recipes
- GitHub, recent + reputable:
  `gh search repos "<topic> created:>YYYY-MM-DD" --sort stars --limit 25 --json fullName,stargazersCount,forksCount,pushedAt,description`
  then filter `pushedAt` within 12 months.
- Repo facts: `gh api repos/OWNER/REPO --jq '"\(.stargazers_count) \(.forks_count) \(.pushed_at)"'`
- Read files: `gh api repos/OWNER/REPO/readme --jq .content | base64 -d`; tree: `gh api "repos/OWNER/REPO/git/trees/HEAD?recursive=1"`.
- Hugging Face: `curl -s "https://huggingface.co/api/models?search=<q>&sort=downloads&direction=-1&limit=40&expand[]=downloads&expand[]=createdAt&expand[]=lastModified"`; model card at `https://huggingface.co/<id>/raw/main/README.md`.
- Papers/challenges: web search for the current year's CVPR/ICLR/ICML/NeurIPS/NTIRE results; prefer arXiv + code links.

## Output
- Write or extend a dated doc in `docs/` (next `RESEARCH_V*_*.md`), with a sources list of everything actually read.
- State what it changes in the current plan (which pick it replaces and why).
- Update the pointer section in `CLAUDE.md` if a doc overrides earlier picks.
