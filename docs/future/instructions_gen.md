# Instruction Maker - Product Concept

## Background and motivation

In the project demos, building a usable agent often hinges less on recording the workflow itself and more on writing a clear Custom Instructions definition in a Claude Project: who the assistant is, what it should read, how it should work, what it should return, and what it must never do automatically. The team has already validated a five-section structure - IDENTITY, CONTEXT, STEPS, OUTPUT, and GUARDRAILS - and used it for scenarios such as Chief of Staff and Competitive Research.

The friction is that target users (operations staff, EAs, managers, and other non-prompt specialists) can usually describe the business need, but struggle to produce a complete, well-bounded instruction in one pass. Today that step still depends on manual drafting or external prompt-writing experience, which raises the barrier and makes the pattern hard to reuse at scale.

The proposed **Instruction Maker** would sit on the WorkTrace dashboard, call an LLM, and let users describe a need in natural language or a short form. The system would then generate an agent prompt in the prescribed format. It would not replace human judgement; it would productise the step from “business request” to “usable agent definition”.

## What it is

Instruction Maker is a generation and editing entry point for agent definitions, surfaced from the dashboard. After the user describes the assistant they want, the system returns a structured Custom Instructions text that can be previewed, edited, and copied into Claude or a similar Project / system-prompt configuration.

The core deliverable is not an SOP and not a capture transcript. It is an **agent instruction**: a behavioural specification for an assistant.

Output should always follow the same format:

- **IDENTITY** - role, tone, and who the assistant serves
- **CONTEXT** - information and tool context to read before acting
- **STEPS** - suggested working steps and decision order
- **OUTPUT** - structure of the response or deliverable
- **GUARDRAILS** - forbidden actions, and actions that require explicit user confirmation

This keeps generated prompts aligned with the agent-design convention already proven in demos, and makes them portable to external LLM products.

## Relationship to existing capabilities

WorkTrace today is stronger on capturing real work and turning it into reusable SOPs and walkthroughs. Instruction Maker would complement that by helping users define the AI assistant that may later support or execute parts of those workflows.

The relationship can be framed as:

- **Capture + SOP generation** answers: “How is this work actually done?”
- **Prompt coaching / walkthrough** answers: “When pasting instructions into the target product, are critical sections missing?”
- **Instruction Maker** answers: “How does a business need first become a sound agent definition?”

Ideally these form a loop: Maker drafts the instruction → coaching checks for missing guardrails and other gaps → walkthrough guides paste, trial, and save. Even without full integration, Instruction Maker has standalone value as a dashboard capability.

## Intended experience

From the dashboard, the user opens Instruction Maker and either picks a scenario template (for example inbox/calendar assistant or competitive-research assistant) or starts from a blank request. They then describe the goal in natural language, or fill in a few key fields: who the assistant serves, what context it works with, what output is expected, and which actions must never run automatically.

The system calls an LLM, generates a five-section draft, shows each section in the UI, and also provides a merged full text for one-click copy. Users should be able to edit any section directly, especially GUARDRAILS and OUTPUT, because those most affect safety and usefulness.

A light validation pass can follow generation: whether all five sections are present, whether GUARDRAILS is too thin, and whether high-risk phrasing appears (for example automatically accepting meetings, archiving mail, or sending outbound messages). Validation would not make decisions for the user; it would flag that the instruction is not yet safe to ship.

## Why the concept is valuable

First, it addresses a real friction exposed in demos: knowing how to open a Claude Project is not the same as knowing how to write good Custom Instructions. Bringing that step into the product would lower the barrier to building agents.

Second, it hardens the five-section agent convention the team already validated into a default system output, instead of relying on ad-hoc individual craft each time. That is more stable for reuse inside the team and for client-facing enablement.

Third, it strengthens the WorkTrace product narrative: the system does not only record and standardise human workflows; it can also help users define the AI assistants that will later support those workflows. That is a natural future direction and sits on the same product line as SOP, walkthrough, and coaching.

Finally, from a quality and safety perspective, requiring GUARDRAILS and defaulting toward “suggest only, do not auto-execute” would reduce incomplete or over-authorised agent definitions reaching real use.

## Boundaries to keep

Several boundaries are worth stating up front.

First, Instruction Maker produces a draft, not a final authority. For write-capable domains such as email, calendar, and outbound communication, human review remains necessary, and the UI should explicitly encourage users to check guardrails.

Second, the concept must stay distinct from SOP generation. An SOP describes how a person completes a process; an instruction describes how an assistant should think and respond. The two can inform each other, but they should not be collapsed into one output type.

Third, privacy guidance should discourage pasting real customer email or other sensitive internal material as generation input. Examples and prompts should default to fictional or redacted scenarios.

Fourth, the system’s default stance should be assistance and suggestion, not granting agents permission to change business-system state on their own. Calendar and inbox scenarios in particular should retain the safety posture already emphasised in the demos.

## Positioning statement

Instruction Maker would turn the demo pattern of “hand-writing Custom Instructions in a Claude Project” into a structured generation capability on the dashboard: the user states a business need, and the system produces an editable, checkable, copyable agent prompt in IDENTITY / CONTEXT / STEPS / OUTPUT / GUARDRAILS form. That lowers the cost of building AI assistants and complements existing SOP and walkthrough capabilities.
