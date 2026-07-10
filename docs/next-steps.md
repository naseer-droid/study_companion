# Next steps — owner actions (Naseer)

Things only you can do. Tick them here **and** update the matching line in `CLAUDE.md → ## Status` when done.

- [ ] **Put a real API key in `.env.local`**
  - *Why only you:* Claude can't hold or paste your secrets.
  - *How:* open `E:\code_repos\study_companion\.env.local` and set:
    - `LLM_PROVIDER=openrouter` and `LLM_API_KEY=<your OpenRouter key>` (model `LLM_MODEL=anthropic/claude-sonnet-4.6` — confirm the exact slug at https://openrouter.ai/models), **or**
    - `LLM_PROVIDER=deepseek`, `LLM_API_KEY=<your DeepSeek key>`, `LLM_MODEL=deepseek-chat`
  - *Verify:* `npm run dev`, create a topic — you should get a real brief/roadmap, not the "mock brief for local testing" text.

- [ ] **Run the acceptance test for the memory loop** (handoff §8)
  - *Why only you:* it needs your key and human judgment of reply quality.
  - *How:* create a topic → add 3 journal entries and 2 questions.
  - *Verify:* the "What we've learned together" panel compactly references all five interactions, and the next companion reply demonstrably uses that context.

- [ ] *(Optional, later)* **Get an Anthropic API key** for the native path
  - *Why only you:* account creation + billing at https://console.anthropic.com.
  - *How:* set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY=...` in `.env.local` (model defaults to `claude-sonnet-4-6`).
  - *Verify:* same as above; responses now come via the official SDK.
