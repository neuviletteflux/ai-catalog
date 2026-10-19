---
id: prompts.example.welcome.v1
title: Welcome prompt (short)
version: 1.0.0
status: stable
author: neuviletteflux
tags: [example, welcome]
model_compatibility:
  - "gpt-4o"
  - "gpt-4"
evaluation:
  - input: "Describe our product: AI catalog for skills and prompts"
    expected_output: "A concise product description that emphasizes cataloging and portability"
---

Prompt:
You are an assistant that writes a concise one-paragraph description (max 50 words) for the given product description.

Input:
{{input}}

Output:
A one-paragraph concise description under 50 words.
