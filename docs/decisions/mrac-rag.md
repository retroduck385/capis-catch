# MRAC policy check and policy RAG

Date: 2026-11-11 (built by a teammate 2026-11-08 to 2026-11-10, on main). Status: decided by implementation, partly built. Covers F16, Sprint 4, hard rules 7 and 8. Q-19, Q-20 and Q-21 stay open.

## Decided (by implementation)
- **Vector store:** Supabase pgvector (`policy_chunks`, 384-dimension embeddings plus full-text search, fused in `search_policy()`), not a local Chroma store. Only institutional policy text is embedded, never applicant data (hard rule 7). The policy source files stay out of git (`mrac-service/.gitignore`).
- **Worker:** `mrac-service/` (Python, service role) claims runs from `mrac_runs`. Two kinds: a CHECK of the Financial Package's figures against the MRAC criteria (`request_mrac_check()`, assigned CO only) and a policy question from any staff member (`ask_policy()`).
- **Suggestion only.** A check result never writes to the exceptions, the approval authority or the Credit Result. The CO adds a suggested exception to FP V. Exception/s with one click and edits it. No auto-reject (matches Q-19's "flag only" reading; Q-19 is still open with the bank).
- **Cited.** Every criterion result that isn't a clean pass carries the policy clause it comes from, and suggested exceptions carry their clauses (hard rule 8). The explanation is template text, no LLM.
- **Criteria are loaded disabled.** Credit policy enables them one by one; until then the check shows policy passages only. Passages start as drafts until a reviewer approves them.
- **Embeddings:** the default `EMBEDDING_PROVIDER=hash` is an offline stub, not semantic; real retrieval needs the local sentence-transformers model.

## Built (main)
- `catch/supabase/migrations/20261105_mrac_rag.sql`, `20261109_mrac_search_products.sql`; `mrac-service/` (worker, rules engine, retrieval, ingestion, tests); front end `src/pages/mrac/` (panel on the Financial Package, "Ask policy").
- Results are stored in `mrac_runs.result`. Since 2026-11-11 (branch `fix/money-cents`) money values and requirements in new results read like ₱40,000.00.

## Watch out
- Public repo NDA review pending.
- Who reviews flags (Q-20) is not decided with the bank; today the CO sees and adopts them.
- `mrac-service/OPEN_QUESTIONS.md` lists policy questions for the bank (the DBR basis among them; see Q-14).
