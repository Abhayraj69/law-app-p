# Legal AI Copilot — Next-Generation Architecture Specification

> **Document Version:** 1.0  
> **Classification:** Architectural Specification — Confidential  
> **Author:** Principal AI Architect & Lead UX Designer  
> **Date:** 2026-08-19

---

## Table of Contents

1. [Executive Vision](#executive-vision)
2. [Part 1: Architectural Foundation & Futuristic Features](#part-1-architectural-foundation--futuristic-features)
   - [1.1 Contextual Intelligence & Workspace Awareness](#11-contextual-intelligence--workspace-awareness)
   - [1.2 Autonomous Legal Workflows](#12-autonomous-legal-workflows)
   - [1.3 Futuristic UX/UI Interaction Models](#13-futuristic-uxui-interaction-models)
   - [1.4 Privacy, Security & Auditability](#14-privacy-security--auditability)
3. [Part 2: Flexible & Model-Agnostic API Engine](#part-2-flexible--model-agnostic-api-engine)
   - [2.1 API Integration Architecture](#21-api-integration-architecture)
   - [2.2 Intelligent Model Routing](#22-intelligent-model-routing)
   - [2.3 UI Configuration Modal](#23-ui-configuration-modal)
4. [Appendices](#appendices)
   - [A. Universal Provider Config Schema](#a-universal-provider-config-schema)
   - [B. Routing Decision Matrix](#b-routing-decision-matrix)
   - [C. Event-Driven Architecture Diagram](#c-event-driven-architecture-diagram)

---

## Executive Vision

**Codename: "AEGIS" — Autonomous Embedded Guidance & Intelligence System**

AEGIS is not a chatbot. It is an **ambient, multi-modal legal intelligence layer** that lives inside the lawyer's workspace, continuously synthesizing context, executing autonomous workflows, and surfacing actionable insights — all while maintaining absolute privilege, cryptographic auditability, and model sovereignty.

> **Design Principle:** *The best AI is the one the lawyer never has to invoke — it's already working.*

---

# Part 1: Architectural Foundation & Futuristic Features

## 1.1 Contextual Intelligence & Workspace Awareness

### 1.1.1 Continuous Context Ingestion Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CONTINUOUS CONTEXT INGESTION LAYER                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐    │
│  │  Document   │   │   Case      │   │  Jurisdic-  │   │  Opposing   │    │
│  │  Watcher    │   │  Tracker    │   │  tion Rules │   │  Counsel    │    │
│  │  (FS/DB)    │   │  (Dockets)  │   │  Engine     │   │  Profiler   │    │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘    │
│         │                 │                 │                 │            │
│         └─────────────────┼─────────────────┼─────────────────┘            │
│                           ▼                 ▼                              │
│              ┌─────────────────────────────────────────┐                   │
│              │      CONTEXT SYNTHESIS ENGINE           │                   │
│              │  (Streaming Vector Index + Knowledge    │                   │
│              │   Graph + Temporal Reasoning Layer)     │                   │
│              └────────────────────┬────────────────────┘                   │
│                                   │                                       │
│                                   ▼                                       │
│              ┌─────────────────────────────────────────┐                   │
│              │      PROACTIVE INSIGHT BROKER           │                   │
│              │  (Risk Heatmaps, Strategy Simulations,  │                   │
│              │   Deadline Alerts, Precedent Matches)   │                   │
│              └─────────────────────────────────────────┘                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.1.2 Real-Time Clause Risk Heatmapping

**Feature:** `ClauseRiskHeatmapEngine`

```typescript
interface ClauseRiskHeatmap {
  documentId: string;
  version: number;
  analysisTimestamp: ISO8601;
  clauses: ClauseRiskAssessment[];
  aggregateRiskScore: number; // 0-100
  jurisdictionContext: JurisdictionProfile;
  opposingCounselPatternMatch: OppositionPattern[];
}

interface ClauseRiskAssessment {
  clauseId: string;
  textSpan: { start: number; end: number };
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'FAVORABLE';
  riskVectors: RiskVector[];
  precedentContrast: PrecedentMatch[];
  negotiationLeverage: number; // -1.0 to 1.0
  suggestedRedline: RedlineSuggestion;
  privilegeFlag: boolean;
}

interface RiskVector {
  category: 'FINANCIAL' | 'REGULATORY' | 'OPERATIONAL' | 'REPUTATIONAL' | 'PRIVILEGE';
  severity: number; // 0-10
  reasoning: string;
  citations: LegalCitation[];
  confidence: number; // 0-1
}
```

**Real-Time Behavior:**
- **Trigger:** Any document open in editor, upload, or version change
- **Latency:** < 500ms for heatmap render (local vector index + cached precedent embeddings)
- **Update Mode:** Streaming — risk scores animate as user types
- **Privilege Awareness:** Automatically masks attorney-client privileged sections from cloud processing

### 1.1.3 Dynamic Trial Strategy Simulation

**Feature:** `TrialStrategySimulator`

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TRIAL STRATEGY SIMULATION ENGINE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  INPUTS                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐            │
│  │ Case Fact Pattern│  │ Judge Analytics │  │ Jury Pool       │            │
│  │ (extracted from │  │ (ruling history,│  │ Demographics +  │            │
│  │  pleadings,     │  │  leanings,      │  │  Venue Analytics│            │
│  │  discovery)     │  │  reversal rates)│  │                 │            │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘            │
│           │                    │                    │                      │
│           └────────────────────┼────────────────────┘                      │
│                                ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │              MONTE CARLO STRATEGY SIMULATOR (10,000+ runs)          │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │  │
│  │  │ Opening     │ │ Witness     │ │ Evidence    │ │ Closing     │   │  │
│  │  │ Strategies  │ │ Sequences   │ │ Admission   │ │ Arguments   │   │  │
│  │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘   │  │
│  └─────────┼────────────────┼────────────────┼─────────────┼────────────┘  │
│            │                │                │             │               │
│            ▼                ▼                ▼             ▼               │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                    OUTCOME DISTRIBUTION                             │  │
│  │  ████████████████████████░░░░░░░░░░░░░░  68% Plaintiff Verdict     │  │
│  │  ████████████████░░░░░░░░░░░░░░░░░░░░░░  42% Summary Judgment      │  │
│  │  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  18% Settlement < $500k    │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  OUTPUT: Interactive Strategy Dashboard with "What-If" Sliders             │
│  • Adjust: Witness credibility, Evidence strength, Jury composition       │
│  • Real-time: Outcome probability shifts, Settlement range updates        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1.2 Autonomous Legal Workflows

### 1.2.1 Multi-Agent Orchestration Framework

```typescript
// Core Agent Types
enum LegalAgentType {
  RESEARCH = 'legal_research_agent',
  OPPOSITION = 'opposition_strategy_agent',
  CITATION = 'citation_verifier_agent',
  DRAFTING = 'contract_drafting_agent',
  DEPOSITION = 'deposition_analysis_agent',
  DISCOVERY = 'discovery_review_agent',
  COMPLIANCE = 'regulatory_compliance_agent',
  BRIEFING = 'brief_writing_agent',
  NEGOTIATION = 'negotiation_strategy_agent'
}

// Agent Capability Registry
interface AgentCapability {
  type: LegalAgentType;
  name: string;
  description: string;
  requiredContext: ContextRequirement[];
  outputSchema: z.ZodSchema;
  estimatedDuration: DurationEstimate;
  confidentialityLevel: 'PUBLIC' | 'CONFIDENTIAL' | 'PRIVILEGED' | 'TOP_SECRET';
  supportedModels: ModelTier[];
  canRunAsync: boolean;
  dependencies: LegalAgentType[];
}

// Example: Legal Research Agent
const legalResearchAgent: AgentCapability = {
  type: LegalAgentType.RESEARCH,
  name: 'Autonomous Legal Researcher',
  description: 'Comprehensive precedent search, statutory analysis, and memo generation',
  requiredContext: [
    { type: 'CASE_LAW', jurisdiction: 'required', dateRange: 'last_10_years' },
    { type: 'STATUTES', jurisdiction: 'required' },
    { type: 'SECONDARY_SOURCES', treatises: true, lawReviews: true }
  ],
  outputSchema: LegalResearchMemoSchema,
  estimatedDuration: { min: 30_000, max: 300_000, typical: 120_000 }, // ms
  confidentialityLevel: 'CONFIDENTIAL',
  supportedModels: [ModelTier.REASONING_HEAVY, ModelTier.LARGE_CONTEXT],
  canRunAsync: true,
  dependencies: [LegalAgentType.CITATION]
};
```

### 1.2.2 Async Workflow Execution Graph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    AUTONOMOUS WORKFLOW ORCHESTRATOR                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  USER INTENT: "Prepare MSJ for Anderson v. Meridian"                       │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    WORKFLOW PLANNER (LLM + Rule Engine)             │   │
│  │  Decomposes intent → DAG of agent tasks with dependencies          │   │
│  └────────────────────────────┬────────────────────────────────────────┘   │
│                               │                                            │
│                               ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        EXECUTION DAG                                │   │
│  │                                                                     │   │
│  │  [Research Agent] ──▶ [Citation Verifier] ──▶ [Brief Writer]       │   │
│  │        │                    │                    │                   │   │
│  │        ▼                    ▼                    ▼                   │   │
│  │  [Opposition Agent] ──▶ [Strategy Sim] ──▶ [Risk Heatmap]          │   │
│  │        │                                                          │   │
│  │        ▼                                                          │   │
│  │  [Discovery Review] ◀──────────────────────────────────────────    │   │
│  │                                                                     │   │
│  └────────────────────────────┬────────────────────────────────────────┘   │
│                               │                                            │
│                               ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    REAL-TIME PROGRESS STREAM                        │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │   │
│  │  │ Research    │ │ Citations   │ │ Opposition  │ │ Draft v1    │   │   │
│  │  │ ████████░░  │ │ ██████████  │ │ ████░░░░░░  │ │ ░░░░░░░░░░  │   │   │
│  │  │ 80% • 2m    │ │ Done ✓      │ │ 40% • 5m    │ │ Queued      │   │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  HITL CHECKPOINTS: Research complete → User reviews → Approve drafting    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2.3 Key Autonomous Workflows

| Workflow | Trigger | Agents Involved | HITL Gates |
|----------|---------|-----------------|------------|
| **MSJ Preparation** | Case status = "MSJ Ready" | Research → Citation → Opposition → Strategy Sim → Brief Writer | After research memo, before filing |
| **Contract Negotiation** | New counter-party draft received | Risk Heatmap → Negotiation Strategy → Redline Generator → Clause Library Match | Each redline batch |
| **Deposition Prep** | Deposition scheduled | Deposition Analysis → Witness Profiler → Exhibit Mapper → Q&A Generator | Final prep packet review |
| **Regulatory Filing** | Deadline approaching | Compliance → Citation → Drafting → Risk Heatmap | Before submission |
| **Discovery Review** | New production received | Discovery Review → Privilege Log → Relevance Scoring → Production Log | Privilege log sign-off |

---

## 1.3 Futuristic UX/UI Interaction Models

### 1.3.1 Ambient Intelligence Sidebar (The "Peripheral Cortex")

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AEGIS AMBIENT SIDEBAR                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ▼ CONTEXTUAL (knows you're editing §4.2 Indemnification)                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 🔴 CRITICAL: Indemnification cap missing — Meridian standard is 2x │   │
│  │    Precedent: Anderson v. Meridian (2024) — uncapped = unenforceable│   │
│  │    [Apply Redline] [View Precedent] [Dismiss]                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ⚠️  DEADLINE: MSJ due in 72h — Brief at 40% completion             │   │
│  │    [Auto-Generate Outline] [Assign Sections] [Request Extension]   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 💡 INSIGHT: Opposing counsel (Sterling & Croft) files 73% MSJs     │   │
│  │    Win rate: 34% — They over-rely on Daubert motions               │   │
│  │    [View Pattern Analysis] [Prep Daubert Response]                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 🎯 SIMULATION: Current strategy → 68% Plaintiff verdict            │   │
│  │    If add expert witness → 82% | If settle now → $340k range       │   │
│  │    [Run What-If] [View Full Simulation]                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ─── VOICE MODE ACTIVE ───  "Add indemnification carve-out for IP claims" │
│  [●] Recording...  [■] Stop  [⌘] Push-to-talk                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3.2 Interactive Argument Graph Visualizer

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ARGUMENT GRAPH VISUALIZER (3D WebGL)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│       ┌─────────────┐                                                       │
│       │  CLAIM:     │                                                       │
│       │  Breach of  │                                                       │
│       │  Contract   │                                                       │
│       └──────┬──────┘                                                       │
│              │ supports                                                     │
│              ▼                                                             │
│       ┌─────────────┐        ┌─────────────┐       ┌─────────────┐        │
│       │ ELEMENT 1:  │◀───────│ EVIDENCE:   │       │ PRECEDENT:  │        │
│       │ Offer       │  cites │ Email chain │       │ Smith v.    │        │
│       │ Acceptance  │        │ (Ex. A-12)  │       │ Jones (2023)│        │
│       └──────┬──────┘        └─────────────┘       └──────┬──────┘        │
│              │                                           │               │
│              │ supports                    supports      │               │
│              ▼                                           ▼               │
│       ┌─────────────┐                           ┌─────────────┐           │
│       │ ELEMENT 2:  │                           │ COUNTER-    │           │
│       │ Consider-   │                           │ ARGUMENT:   │           │
│       │ ation       │                           │ Statute of  │           │
│       └──────┬──────┘                           │ Frauds      │           │
│              │                                  └──────┬──────┘           │
│              │ supports                                 │                │
│              ▼                                           ▼                │
│       ┌─────────────┐                           ┌─────────────┐           │
│       │ ELEMENT 3:  │                           │ REBUTTAL:   │           │
│       │ Breach      │                           │ Partial     │           │
│       └──────┬──────┘                           │ Performance │           │
│              │                                  └──────┬──────┘           │
│              │                                         │                 │
│              └─────────────────┬───────────────────────┘                 │
│                                ▼                                         │
│                       ┌─────────────────┐                                 │
│                       │  CONCLUSION:    │                                 │
│                       │  Liability      │                                 │
│                       │  Established    │                                 │
│                       │  (p=0.87)       │                                 │
│                       └─────────────────┘                                 │
│                                                                             │
│  INTERACTIONS:                                                              │
│  • Click node → Expand evidence/precedent panel                            │
│  • Drag to rearrange → Auto-layout preserves logic                         │
│  • Right-click → "Challenge this link" → Opposition agent tests it         │
│  • Hover → Shows confidence score, supporting docs, privilege status       │
│  • Time-slider → Shows how argument evolved across drafts                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3.3 Real-Time Voice-to-Brief with Entity Extraction

```typescript
interface VoiceToBriefSession {
  sessionId: string;
  startedAt: ISO8601;
  mode: 'DICTATION' | 'BRAINSTORM' | 'DEPOSITION_PREP' | 'CLIENT_INTERVIEW';
  transcript: TranscriptSegment[];
  extractedEntities: ExtractedEntity[];
  generatedSections: BriefSection[];
  privilegeSegments: PrivilegeSegment[];
}

interface TranscriptSegment {
  id: string;
  timestamp: number; // ms from session start
  speaker: 'USER' | 'CLIENT' | 'WITNESS' | 'UNKNOWN';
  text: string;
  confidence: number;
  entities: EntityReference[];
  legalActions: LegalAction[]; // e.g., "CREATE_TASK", "FLAG_PRIVILEGE", "CITE_CASE"
}

interface ExtractedEntity {
  id: string;
  type: 'PERSON' | 'ENTITY' | 'CASE' | 'STATUTE' | 'DATE' | 'MONETARY' | 'LEGAL_CONCEPT';
  value: string;
  normalizedValue: string;
  mentions: EntityMention[];
  relationships: EntityRelationship[];
  confidence: number;
}

// Real-time processing pipeline (runs locally in Web Worker)
class VoiceToBriefPipeline {
  private asr: WhisperWebGPU | CloudASR;
  private ner: LegalEntityRecognizer;
  private privilegeDetector: PrivilegeDetector;
  private briefGenerator: IncrementalBriefGenerator;

  async processAudioChunk(audio: Float32Array): Promise<VoiceUpdate> {
    // 1. Streaming ASR (local Whisper.cpp WebGPU or cloud)
    const transcript = await this.asr.transcribeChunk(audio);

    // 2. Legal NER (fine-tuned Legal-BERT, runs in WebAssembly)
    const entities = await this.ner.extract(transcript.text);

    // 3. Privilege detection (client-side only)
    const privilegeFlags = this.privilegeDetector.analyze(transcript.text, entities);

    // 4. Incremental brief section generation
    const sections = await this.briefGenerator.update(transcript, entities);

    return { transcript, entities, privilegeFlags, sections };
  }
}
```

### 1.3.4 Automated Deposition Analysis Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DEPOSITION ANALYSIS COMMAND CENTER                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  DEPOSITION: James Anderson (Plaintiff) • 2026-07-15 • 3h 42m              │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    INCONSISTENCY RADAR                              │   │
│  │                                                                     │   │
│  │  ⚠️  CONTRADICTION: Para 47 (today) vs. Interrog. Resp. #12 (2025) │   │
│  │     "Never saw the contract" ←→ "Reviewed contract with counsel"   │   │
│  │     [View Side-by-Side] [Create Impeachment Exhibit]               │   │
│  │                                                                     │   │
│  │  ⚠️  EVASION PATTERN: 12 "I don't recall" in 45 min (top 5%)      │   │
│  │     Clusters around: Financial terms, Meridian communications      │   │
│  │     [View Heatmap] [Generate Follow-up Questions]                  │   │
│  │                                                                     │   │
│  │  ✅ ADMISSION: Para 203 — "Meridian controlled payment schedule"   │   │
│  │     Supports: Agency theory, §4.2 breach                          │   │
│  │     [Tag as Key Admission] [Link to Brief]                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐              │
│  │ TOPIC TIMELINE  │ │ WITNESS         │ │ EXHIBIT         │              │
│  │                 │ │ CREDIBILITY     │ │ MAP             │              │
│  │ ████░░ Liability│ │ ████████░░ 82% │ │ Ex A-12 ████    │              │
│  │ ░░████ Damages  │ │ ░░░░░░░░░░ 18% │ │ Ex B-3  ██░░    │              │
│  │ ██░░░░ Discovery│ │ (Demeanor:     │ │ Ex C-7  ██████  │              │
│  │                 │ │  cooperative)   │ │                 │              │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘              │
│                                                                             │
│  [Export Impeachment Packet] [Generate Cross-Exam Outline]                 │
│  [Create Video Clips] [Sync to Trial Presentation]                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1.4 Privacy, Security & Auditability

### 1.4.1 Zero-Data Retention Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ZERO-DATA RETENTION GUARANTEE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  USER DEVICE (Browser/Client)                    CLOUD PROVIDER             │
│  ┌─────────────────────────┐                     ┌─────────────────────┐   │
│  │                         │                     │                     │   │
│  │  ┌─────────────────┐    │   ENCRYPTED       │  ┌────────────────┐  │   │
│  │  │ Local Vector    │◀───┼─── PAYLOAD ONLY ──┼─▶│ Stateless      │  │   │
│  │  │ Index (IndexedDB│    │   (TLS 1.3 +      │  │ Inference      │  │   │
│  │  │  + WASM Search) │    │   Payload Enc)    │  │ Workers        │  │   │
│  │  └─────────────────┘    │                     │  └────────────────┘  │   │
│  │         │               │                     │        │             │   │
│  │         ▼               │                     │        ▼             │   │
│  │  ┌─────────────────┐    │                     │  ┌────────────────┐  │   │
│  │  │ Client-Side     │    │                     │  │ NO PERSISTENT  │  │   │
│  │  │ Privilege       │    │                     │  │ STORAGE        │  │   │
│  │  │ Classifier      │    │                     │  │ (Memory-only)  │  │   │
│  │  └─────────────────┘    │                     │  └────────────────┘  │   │
│  │         │               │                     │        │             │   │
│  │         ▼               │                     │        ▼             │   │
│  │  ┌─────────────────┐    │                     │  ┌────────────────┐  │   │
│  │  │ Local Embedding │    │                     │  │ Ephemeral      │  │   │
│  │  │ Model (MiniLM)  │    │                     │  │ Cache (TTL:    │  │   │
│  │  └─────────────────┘    │                     │  │ 5 min)         │  │   │
│  │                         │                     │  └────────────────┘  │   │
│  └─────────────────────────┘                     └─────────────────────┘   │
│                                                                             │
│  GUARANTEES:                                                                │
│  ✅ Raw documents NEVER leave client unencrypted                           │
│  ✅ Embeddings computed locally for privilege/classification               │
│  ✅ Cloud sees only: task prompt + relevant context chunks (encrypted)     │
│  ✅ Cloud workers: Stateless, no disk, memory wiped after each request     │
│  ✅ Audit log: Cryptographic receipt for every inference (see 1.4.3)       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.4.2 Privilege Protocol Engine

```typescript
class PrivilegeProtocolEngine {
  private classifier: PrivilegeClassifier; // Local, fine-tuned Legal-BERT
  private privilegeLog: PrivilegeLogEntry[];

  async classifyAndProtect(content: string, context: DocumentContext): Promise<PrivilegeResult> {
    // 1. Local classification (never leaves device)
    const classification = await this.classifier.classify(content, context);

    // 2. Apply protection based on classification
    const protectedContent = this.applyProtection(content, classification);

    // 3. Log for audit trail (local, encrypted)
    await this.logPrivilegeDecision({
      timestamp: new Date().toISOString(),
      documentId: context.documentId,
      classification,
      action: 'PROTECTED',
      hash: await this.hashContent(content)
    });

    return {
      protectedContent,
      classification,
      redactedForCloud: classification.level >= 'CONFIDENTIAL'
        ? this.redactPrivileged(content, classification.spans)
        : content
    };
  }

  private applyProtection(content: string, classification: PrivilegeClassification): string {
    switch (classification.level) {
      case 'ATTORNEY_CLIENT':
        return this.encryptWithUserKey(content); // User's public key
      case 'WORK_PRODUCT':
        return this.encryptWithFirmKey(content); // Firm's key
      case 'CONFIDENTIAL':
        return this.encryptWithCaseKey(content); // Case-specific key
      default:
        return content;
    }
  }
}
```

### 1.4.3 Cryptographic Audit Trail (Merkle Audit Log)

```typescript
interface AuditReceipt {
  // Immutable proof of what the AI saw, did, and produced
  receiptId: string;                    // UUID v7 (time-ordered)
  timestamp: ISO8601;
  userId: string;
  sessionId: string;

  // Input integrity
  inputHash: string;                    // SHA-256 of exact input provided to model
  inputMerkleRoot: string;              // Merkle root of all context chunks
  contextChunks: ContextChunkRef[];     // References (not content) to context used

  // Model provenance
  modelFingerprint: ModelFingerprint;   // Provider, model, version, parameters
  providerAttestation: string;          // Signed attestation from provider (if available)

  // Execution integrity
  executionTrace: ExecutionStep[];      // Ordered steps with hashes
  outputHash: string;                   // SHA-256 of model output
  outputMerkleRoot: string;             // If streaming, root of all chunks

  // Cryptographic proof
  signature: string;                    // Ed25519 signature by AEGIS audit service
  publicKey: string;                    // Verification key
  anchorTxId?: string;                  // Optional: blockchain anchor (e.g., OpenTimestamps)

  // Legal metadata
  privilegeClassification: PrivilegeLevel;
  matterId: string;
  taskType: LegalAgentType;
}

// Verification API (runs client-side)
async function verifyAuditReceipt(receipt: AuditReceipt): Promise<VerificationResult> {
  // 1. Verify signature
  const validSig = await verifyEd25519(receipt.publicKey, receipt);

  // 2. Verify Merkle proofs for context chunks
  const contextValid = await verifyMerkleProofs(receipt.contextChunks, receipt.inputMerkleRoot);

  // 3. Verify output hash matches what user received
  const outputValid = receipt.outputHash === await sha256(userReceivedOutput);

  // 4. Check model fingerprint against approved registry
  const modelApproved = APPROVED_MODELS.has(receipt.modelFingerprint);

  return { valid: validSig && contextValid && outputValid && modelApproved, details: {...} };
}
```

---

# Part 2: Flexible & Model-Agnostic API Engine

## 2.1 API Integration Architecture

### 2.1.1 Universal Provider Interface

```typescript
// Core abstraction — every provider implements this
interface AIProvider {
  readonly id: string;
  readonly name: string;
  readonly type: ProviderType;
  readonly capabilities: ProviderCapabilities;

  // Configuration
  configure(config: ProviderConfig): Promise<void>;
  validateConfig(config: ProviderConfig): ValidationResult;

  // Inference
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  streamComplete(request: CompletionRequest): AsyncIterable<StreamChunk>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;

  // Health & Metadata
  healthCheck(): Promise<HealthStatus>;
  listModels(): Promise<ModelInfo[]>;
  estimateCost(request: CompletionRequest): CostEstimate;
}

type ProviderType = 
  | 'anthropic' 
  | 'openai' 
  | 'google' 
  | 'azure' 
  | 'aws-bedrock' 
  | 'ollama' 
  | 'vllm' 
  | 'custom' 
  | 'huggingface' 
  | 'together' 
  | 'fireworks' 
  | 'groq' 
  | 'perplexity';

interface ProviderCapabilities {
  chat: boolean;
  completion: boolean;
  streaming: boolean;
  functionCalling: boolean;
  vision: boolean;
  audio: boolean;
  embeddings: boolean;
  reasoning: boolean;           // o1-style reasoning
  citations: boolean;           // Native citation support
  jsonMode: boolean;
  structuredOutput: boolean;    // JSON Schema constrained output
  maxContextWindow: number;
  maxOutputTokens: number;
  supportedParams: ModelParameter[];
  regionalEndpoints: string[];  // For data residency
}
```

### 2.1.2 Universal Configuration Schema (JSON)

```json
{
  "$schema": "https://aegis.legal/schemas/provider-config/v1.json",
  "version": "1.0",
  "providers": [
    {
      "id": "anthropic-primary",
      "type": "anthropic",
      "name": "Anthropic (Primary)",
      "enabled": true,
      "priority": 1,
      "config": {
        "apiKey": "${env:ANTHROPIC_API_KEY}",
        "baseUrl": "https://api.anthropic.com",
        "organizationId": "${env:ANTHROPIC_ORG_ID}",
        "defaultModel": "claude-3-5-sonnet-20241022",
        "models": {
          "claude-3-5-sonnet-20241022": {
            "maxTokens": 8192,
            "contextWindow": 200000,
            "supportsReasoning": false,
            "costPer1kInput": 0.003,
            "costPer1kOutput": 0.015
          },
          "claude-3-5-haiku-20241022": {
            "maxTokens": 8192,
            "contextWindow": 200000,
            "supportsReasoning": false,
            "costPer1kInput": 0.0008,
            "costPer1kOutput": 0.004
          },
          "claude-3-opus-20240229": {
            "maxTokens": 4096,
            "contextWindow": 200000,
            "supportsReasoning": false,
            "costPer1kInput": 0.015,
            "costPer1kOutput": 0.075
          }
        },
        "parameters": {
          "temperature": { "default": 0.2, "min": 0, "max": 1 },
          "topP": { "default": 0.95, "min": 0, "max": 1 },
          "topK": { "default": 40, "min": 1, "max": 100 }
        },
        "rateLimits": {
          "requestsPerMinute": 50,
          "tokensPerMinute": 100000,
          "concurrentRequests": 10
        },
        "retryPolicy": {
          "maxRetries": 3,
          "baseDelayMs": 1000,
          "maxDelayMs": 30000,
          "retryableErrors": ["rate_limit", "overloaded", "timeout"]
        },
        "dataResidency": {
          "requiredRegion": "us-east-1",
          "allowedRegions": ["us-east-1", "us-west-2"]
        }
      },
      "routing": {
        "preferredFor": ["reasoning_heavy", "large_context", "privileged"],
        "avoidFor": ["ultra_fast", "cost_sensitive"],
        "fallback": ["openai-primary", "local-ollama"]
      }
    },
    {
      "id": "openai-primary",
      "type": "openai",
      "name": "OpenAI (Primary)",
      "enabled": true,
      "priority": 2,
      "config": {
        "apiKey": "${env:OPENAI_API_KEY}",
        "baseUrl": "https://api.openai.com/v1",
        "organizationId": "${env:OPENAI_ORG_ID}",
        "defaultModel": "gpt-4o",
        "models": {
          "gpt-4o": {
            "maxTokens": 4096,
            "contextWindow": 128000,
            "supportsReasoning": false,
            "costPer1kInput": 0.0025,
            "costPer1kOutput": 0.01
          },
          "gpt-4o-mini": {
            "maxTokens": 16384,
            "contextWindow": 128000,
            "supportsReasoning": false,
            "costPer1kInput": 0.00015,
            "costPer1kOutput": 0.0006
          },
          "o1-preview": {
            "maxTokens": 32768,
            "contextWindow": 128000,
            "supportsReasoning": true,
            "reasoningEffort": ["low", "medium", "high"],
            "costPer1kInput": 0.015,
            "costPer1kOutput": 0.06
          }
        }
      },
      "routing": {
        "preferredFor": ["structured_output", "function_calling", "cost_sensitive"],
        "avoidFor": ["privileged", "ultra_large_context"],
        "fallback": ["anthropic-primary", "local-ollama"]
      }
    },
    {
      "id": "local-ollama",
      "type": "ollama",
      "name": "Local Ollama (Air-Gapped)",
      "enabled": true,
      "priority": 3,
      "config": {
        "baseUrl": "http://localhost:11434",
        "apiKey": "",
        "defaultModel": "llama3.1:70b-instruct-q4_K_M",
        "models": {
          "llama3.1:70b-instruct-q4_K_M": {
            "maxTokens": 4096,
            "contextWindow": 131072,
            "supportsReasoning": false,
            "costPer1kInput": 0,
            "costPer1kOutput": 0,
            "hardwareRequirements": { "vramGb": 48, "ramGb": 64 }
          },
          "nomic-embed-text": {
            "maxTokens": 8192,
            "contextWindow": 8192,
            "isEmbedding": true,
            "costPer1kInput": 0,
            "costPer1kOutput": 0
          }
        }
      },
      "routing": {
        "preferredFor": ["privileged", "air_gapped", "cost_free"],
        "avoidFor": ["reasoning_heavy", "large_context"],
        "fallback": []
      }
    },
    {
      "id": "custom-fine-tuned",
      "type": "vllm",
      "name": "Custom Fine-Tuned Legal Model",
      "enabled": true,
      "priority": 4,
      "config": {
        "baseUrl": "https://infer.aegis.legal/v1",
        "apiKey": "${env:CUSTOM_MODEL_API_KEY}",
        "defaultModel": "aegis-legal-70b-v2",
        "models": {
          "aegis-legal-70b-v2": {
            "maxTokens": 4096,
            "contextWindow": 32768,
            "supportsReasoning": false,
            "specialization": ["contract_analysis", "brief_writing", "citation_formatting"],
            "costPer1kInput": 0.001,
            "costPer1kOutput": 0.003
          }
        }
      },
      "routing": {
        "preferredFor": ["contract_analysis", "brief_writing", "citation_formatting"],
        "avoidFor": ["general_chat"],
        "fallback": ["anthropic-primary"]
      }
    }
  ],
  "routingPolicy": {
    "strategy": "capability_based",
    "defaultFallbackChain": ["anthropic-primary", "openai-primary", "local-ollama"],
    "costOptimization": {
      "enabled": true,
      "maxCostPerRequest": 0.50,
      "preferCheaperFor": ["summarization", "classification", "extraction"]
    },
    "privacyRules": {
      "privilegedContent": ["local-ollama", "custom-fine-tuned"],
      "confidentialContent": ["anthropic-primary", "custom-fine-tuned"],
      "publicContent": ["any"]
    },
    "latencyBudgets": {
      "interactive": 2000,      // ms for chat/voice
      "background": 30000,      // ms for async workflows
      "batch": 300000           // ms for bulk processing
    }
  }
}
```

### 2.1.3 Provider Adapter Implementation

```typescript
// Base adapter class — each provider extends this
abstract class BaseProviderAdapter implements AIProvider {
  protected config: ProviderConfig;
  protected httpClient: HttpClient;
  protected metrics: MetricsCollector;

  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly type: ProviderType;

  async configure(config: ProviderConfig): Promise<void> {
    this.config = this.validateAndNormalize(config);
    this.httpClient = this.createHttpClient();
    await this.warmup();
  }

  protected abstract validateAndNormalize(config: ProviderConfig): ProviderConfig;
  protected abstract createHttpClient(): HttpClient;
  protected abstract transformRequest(request: CompletionRequest): ProviderRequest;
  protected abstract transformResponse(response: ProviderResponse): CompletionResponse;
  protected abstract transformStream(chunk: ProviderStreamChunk): StreamChunk;

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const providerRequest = this.transformRequest(request);
    const response = await this.httpClient.post('/completions', providerRequest);
    return this.transformResponse(response);
  }

  async *streamComplete(request: CompletionRequest): AsyncIterable<StreamChunk> {
    const providerRequest = { ...this.transformRequest(request), stream: true };
    const stream = await this.httpClient.stream('/completions', providerRequest);
    
    for await (const chunk of stream) {
      yield this.transformStream(chunk);
    }
  }

  // Cost estimation without calling API
  estimateCost(request: CompletionRequest): CostEstimate {
    const modelConfig = this.config.models[request.model || this.config.defaultModel];
    const inputTokens = this.estimateTokens(request.messages);
    const outputTokens = request.maxTokens || modelConfig.maxTokens;
    
    return {
      inputCost: (inputTokens / 1000) * modelConfig.costPer1kInput,
      outputCost: (outputTokens / 1000) * modelConfig.costPer1kOutput,
      totalCost: (inputTokens / 1000) * modelConfig.costPer1kInput + 
                 (outputTokens / 1000) * modelConfig.costPer1kOutput,
      currency: 'USD',
      confidence: 0.85
    };
  }
}

// Anthropic-specific adapter
class AnthropicAdapter extends BaseProviderAdapter {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';
  readonly type = 'anthropic' as ProviderType;

  protected transformRequest(request: CompletionRequest): AnthropicRequest {
    const systemMessage = request.messages.find(m => m.role === 'system');
    const userMessages = request.messages.filter(m => m.role !== 'system');

    return {
      model: request.model || this.config.defaultModel,
      max_tokens: request.maxTokens || this.config.models[request.model || this.config.defaultModel].maxTokens,
      temperature: request.temperature ?? 0.2,
      top_p: request.topP,
      system: systemMessage?.content || '',
      messages: userMessages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      })),
      stream: request.stream,
      tools: request.tools?.map(this.transformTool),
      tool_choice: request.toolChoice
    };
  }

  protected transformResponse(response: AnthropicResponse): CompletionResponse {
    return {
      id: response.id,
      model: response.model,
      content: response.content[0]?.text || '',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens
      },
      finishReason: this.mapFinishReason(response.stop_reason),
      citations: response.content
        .filter(c => c.type === 'text' && c.citations)
        .flatMap(c => c.citations || [])
    };
  }
}
```

---

## 2.2 Intelligent Model Routing

### 2.2.1 Routing Decision Engine

```typescript
class IntelligentModelRouter {
  private providers: Map<string, AIProvider>;
  private routingPolicy: RoutingPolicy;
  private taskClassifier: TaskClassifier;
  private performanceHistory: PerformanceTracker;

  async route(request: RoutingRequest): Promise<RoutingDecision> {
    // 1. Classify the task
    const taskProfile = await this.taskClassifier.classify(request);

    // 2. Filter providers by privacy rules
    const eligibleProviders = this.filterByPrivacy(request.privacyLevel);

    // 3. Filter by capability requirements
    const capableProviders = eligibleProviders.filter(p => 
      this.hasRequiredCapabilities(p, taskProfile.requiredCapabilities)
    );

    // 4. Score each provider
    const scored = await Promise.all(
      capableProviders.map(p => this.scoreProvider(p, taskProfile, request))
    );

    // 5. Select best (with fallback chain)
    const sorted = scored.sort((a, b) => b.score - a.score);
    const primary = sorted[0];
    const fallbacks = sorted.slice(1, 3).map(s => s.providerId);

    return {
      primaryProvider: primary.providerId,
      primaryModel: primary.recommendedModel,
      fallbackChain: fallbacks,
      reasoning: primary.reasoning,
      estimatedCost: primary.estimatedCost,
      estimatedLatency: primary.estimatedLatency,
      confidence: primary.confidence
    };
  }

  private async scoreProvider(
    provider: AIProvider, 
    task: TaskProfile, 
    request: RoutingRequest
  ): Promise<ProviderScore> {
    const capabilities = provider.capabilities;
    const model = this.selectBestModel(provider, task);
    const cost = provider.estimateCost({ ...request, model });

    let score = 0;
    const reasons: string[] = [];

    // Capability match (40%)
    const capabilityScore = this.scoreCapabilities(capabilities, task.requiredCapabilities);
    score += capabilityScore * 0.4;
    if (capabilityScore > 0.8) reasons.push('Excellent capability match');

    // Privacy compliance (25%) — HARD CONSTRAINT
    if (!this.meetsPrivacyRequirements(provider, request.privacyLevel)) {
      return { providerId: provider.id, score: -Infinity, ... };
    }
    score += 0.25;
    reasons.push('Meets privacy requirements');

    // Cost efficiency (15%)
    const costScore = this.scoreCost(cost, request.budgetTier);
    score += costScore * 0.15;

    // Latency (10%)
    const latencyScore = this.scoreLatency(provider, request.latencyBudget);
    score += latencyScore * 0.1;

    // Historical performance (10%)
    const perfScore = this.performanceHistory.getScore(provider.id, task.type);
    score += perfScore * 0.1;

    return {
      providerId: provider.id,
      recommendedModel: model,
      score,
      reasoning: reasons.join('; '),
      estimatedCost: cost,
      estimatedLatency: this.estimateLatency(provider, model, request),
      confidence: Math.min(score, 1.0)
    };
  }
}
```

### 2.2.2 Routing Decision Matrix

| Task Category | Privacy Level | Preferred Provider | Model | Reasoning |
|---------------|---------------|-------------------|-------|-----------|
| **Legal Research** | Confidential | Anthropic | Claude 3.5 Sonnet | 200k context, strong legal reasoning |
| **Brief Writing** | Privileged | Local Ollama / Custom | Llama 3.1 70B / AEGIS-Legal | Air-gapped, fine-tuned for legal style |
| **Summarization** | Confidential | OpenAI | GPT-4o-mini | Fast, cheap, structured output |
| **Clause Analysis** | Privileged | Local Ollama | Llama 3.1 70B | Never leaves device |
| **Citation Verification** | Confidential | Anthropic | Claude 3.5 Sonnet | Native citations, large context |
| **Deposition Analysis** | Privileged | Custom Fine-Tuned | AEGIS-Legal-70B | Specialized for transcript analysis |
| **Contract Drafting** | Privileged | Local Ollama / Custom | Llama 3.1 70B / AEGIS-Legal | Template-aware, jurisdiction-specific |
| **Opposition Research** | Confidential | Anthropic | Claude 3.5 Sonnet | Strategic reasoning |
| **Real-time Chat** | Confidential | OpenAI | GPT-4o-mini | <500ms latency, streaming |
| **Voice Transcription** | Privileged | Local (Whisper) | Whisper-large-v3 | On-device, no audio leaves |

### 2.2.3 Dynamic Routing with Context Awareness

```typescript
// Routing context enriched with workspace state
interface RoutingContext {
  // Task classification
  taskType: LegalTaskType;
  complexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  estimatedTokens: { input: number; output: number };

  // Privacy & Compliance
  privacyLevel: 'PUBLIC' | 'CONFIDENTIAL' | 'PRIVILEGED' | 'TOP_SECRET';
  jurisdiction: string;
  dataResidencyRequirement?: string;

  // User Preferences
  userPreferences: {
    preferredProviders: string[];
    costSensitivity: 'LOW' | 'MEDIUM' | 'HIGH';
    latencyPriority: 'INTERACTIVE' | 'BACKGROUND' | 'BATCH';
    allowFallback: boolean;
  };

  // Workspace State
  activeDocument?: DocumentContext;
  openCases: string[];
  recentQueries: QueryHistory[];
  availableLocalModels: LocalModelInfo[];

  // Budget
  budgetTier: 'INDIVIDUAL' | 'FIRM' | 'ENTERPRISE';
  monthlySpendToDate: number;
  monthlyBudget: number;
}

// Routing with explainability
interface RoutingDecision {
  primaryProvider: string;
  primaryModel: string;
  fallbackChain: string[];
  reasoning: string;
  estimatedCost: CostEstimate;
  estimatedLatency: number;
  confidence: number;
  alternatives: AlternativeRoute[];
  warnings: RoutingWarning[];
}
```

---

## 2.3 UI Configuration Modal

### 2.3.1 Settings Interface Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    AI PROVIDER CONFIGURATION MODAL                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─ TABS ────────────────────────────────────────────────────────────────┐  │
│  │ [Providers] [Routing Rules] [Privacy & Security] [Usage & Costs]    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─ PROVIDERS TAB ───────────────────────────────────────────────────────┐  │
│  │                                                                        │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │  ══════════════════════════════════════════════════════════════  │  │  │
│  │  │  ANTHROPIC (Primary)                          ● Connected       │  │  │
│  │  │  ─────────────────────────────────────────────────────────────  │  │  │
│  │  │  API Key: ••••••••••••••••••••••••sk-ant-...  [👁 Show] [🔁 Rotate]│  │  │
│  │  │  Base URL: https://api.anthropic.com        [Test Connection]   │  │  │
│  │  │  Organization: slf-law (org_abc123)                              │  │  │
│  │  │                                                                        │  │  │
│  │  │  DEFAULT MODEL: [Claude 3.5 Sonnet ▼]                             │  │  │
│  │  │                                                                        │  │  │
│  │  │  AVAILABLE MODELS:                                                 │  │  │
│  │  │  ☑ Claude 3.5 Sonnet     200k ctx  $3/$15 per 1M  [Primary]      │  │  │
│  │  │  ☑ Claude 3.5 Haiku      200k ctx  $0.80/$4   [Fast/Fallback]    │  │  │
│  │  │  ☐ Claude 3 Opus         200k ctx  $15/$75   [Reasoning]         │  │  │
│  │  │                                                                        │  │  │
│  │  │  PARAMETERS:  Temperature [0.2 ▼]  Top-P [0.95]  Max Tokens [4096] │  │  │
│  │  │                                                                        │  │  │
│  │  │  RATE LIMITS:  50 req/min  •  100k tokens/min  •  10 concurrent    │  │  │
│  │  │                                                                        │  │  │
│  │  │  [Disable] [Delete]  ◀── Danger zone                               │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                        │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │  LOCAL OLLAMA (Air-Gapped)                      ● Running       │  │  │
│  │  │  ─────────────────────────────────────────────────────────────  │  │  │
│  │  │  Endpoint: http://localhost:11434           [Test] [Auto-Detect] │  │  │
│  │  │  Status: ● Healthy (v0.1.47)  2 models loaded                   │  │  │
│  │  │                                                                        │  │  │
│  │  │  MODELS:  ☑ llama3.1:70b-instruct  128k ctx  48GB VRAM           │  │  │
│  │  │           ☑ nomic-embed-text       8k ctx     Embedding           │  │  │
│  │  │                                                                        │  │  │
│  │  │  HARDWARE:  GPU: NVIDIA RTX 6000 Ada (48GB)  RAM: 128GB           │  │  │
│  │  │                                                                        │  │  │
│  │  │  [Install Model] [Manage Models] [View Logs]                       │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                        │  │
│  │  [+ Add Provider]  ◀── Supports: OpenAI, Azure, Bedrock, vLLM, Custom│  │
│  │                                                                        │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─ ROUTING RULES TAB ───────────────────────────────────────────────────┐  │
│  │                                                                        │  │
│  │  STRATEGY: [Capability-Based ▼]  [Cost-Optimized] [Privacy-First]    │  │
│  │                                                                        │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │ TASK-TO-MODEL MAPPING (Drag to reorder priority)               │  │  │
│  │  │ ─────────────────────────────────────────────────────────────  │  │  │
│  │  │  🔍 Legal Research         → Anthropic:Sonnet → OpenAI:GPT-4o  │  │  │
│  │  │  ✍️  Brief Writing          → Local:Ollama → Custom:AEGIS      │  │  │
│  │  │  📄 Summarization           → OpenAI:GPT-4o-mini → Anthropic   │  │  │
│  │  │  ⚖️  Clause Analysis        → Local:Ollama → Custom:AEGIS      │  │  │
│  │  │  📚 Citation Verification   → Anthropic:Sonnet → Custom:AEGIS  │  │  │
│  │  │  🎤 Voice Transcription     → Local:Whisper (ONLY)             │  │  │
│  │  │  🤝 Negotiation Strategy    → Anthropic:Sonnet → OpenAI:GPT-4o │  │  │
│  │  │  🔬 Discovery Review        → Custom:AEGIS → Local:Ollama      │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                        │  │
│  │  PRIVACY OVERRIDES (Cannot be overridden by routing):                 │  │
│  │  ☑ PRIVILEGED content → ONLY Local Ollama / Custom Fine-Tuned        │  │
│  │  ☑ CONFIDENTIAL content → Anthropic / Custom (NO OpenAI)             │  │
│  │  ☐ Allow cloud for PUBLIC content only                                │  │
│  │                                                                        │  │
│  │  LATENCY BUDGETS:  Interactive [2s]  Background [30s]  Batch [5m]    │  │
│  │                                                                        │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─ PRIVACY & SECURITY TAB ──────────────────────────────────────────────┐  │
│  │                                                                        │  │
│  │  ZERO-DATA RETENTION:  ☑ Enforced (Cloud providers)                   │  │
│  │                                                                        │  │
│  │  LOCAL PROCESSING:                                                         │  │
│  │  ☑ Privilege classification (client-side)                               │  │
│  │  ☑ Document embeddings (MiniLM, local)                                  │  │
│  │  ☑ Vector search (IndexedDB + WASM)                                     │  │
│  │  ☐ Full inference (requires Ollama/vLLM)                                │  │
│  │                                                                        │  │
│  │  AUDIT TRAIL:                                                             │  │
│  │  ☑ Cryptographic receipts for all AI interactions                       │  │
│  │  ☑ Blockchain anchoring (OpenTimestamps)                                │  │
│  │  ☑ Export audit log (JSONL, signed)                                     │  │
│  │                                                                        │  │
│  │  ENCRYPTION:                                                             │  │
│  │  ☑ TLS 1.3 for all provider communication                               │  │
│  │  ☑ Payload encryption (AES-256-GCM) for privileged content             │  │
│  │  ☑ Client-side key management (Web Crypto API)                          │  │
│  │                                                                        │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3.2 Configuration Modal — React Component Schema

```tsx
// types/ai-config.ts
interface AIProviderConfigModalProps {
  onSave: (config: UniversalProviderConfig) => Promise<void>;
  onTestConnection: (providerId: string) => Promise<ConnectionTestResult>;
  currentConfig: UniversalProviderConfig;
  userTier: 'INDIVIDUAL' | 'FIRM' | 'ENTERPRISE';
}

// Component Structure
const AIProviderConfigModal: React.FC<AIProviderConfigModalProps> = ({
  onSave,
  onTestConnection,
  currentConfig,
  userTier
}) => {
  const [activeTab, setActiveTab] = useState<'providers' | 'routing' | 'privacy' | 'usage'>('providers');
  const [config, setConfig] = useState(currentConfig);
  const [testing, setTesting] = useState<string | null>(null);

  // Provider Management
  const addProvider = (type: ProviderType) => {
    const template = PROVIDER_TEMPLATES[type];
    setConfig(prev => ({
      ...prev,
      providers: [...prev.providers, { ...template, id: `${type}-${Date.now()}` }]
    }));
  };

  const updateProvider = (id: string, updates: Partial<ProviderConfig>) => {
    setConfig(prev => ({
      ...prev,
      providers: prev.providers.map(p => p.id === id ? { ...p, ...updates } : p)
    }));
  };

  const testProvider = async (providerId: string) => {
    setTesting(providerId);
    const result = await onTestConnection(providerId);
    toast(result.success ? 'Connection successful' : `Failed: ${result.error}`);
    setTesting(null);
  };

  // Routing Rules Editor
  const moveRoutingRule = (fromIndex: number, toIndex: number) => {
    setConfig(prev => {
      const rules = [...prev.routingPolicy.taskRouting];
      const [moved] = rules.splice(fromIndex, 1);
      rules.splice(toIndex, 0, moved);
      return { ...prev, routingPolicy: { ...prev.routingPolicy, taskRouting: rules } };
    });
  };

  // Render
  return (
    <Modal size="xl" title="AI Provider Configuration">
      <Tabs value={activeTab} onChange={setActiveTab}>
        <TabList>
          <Tab value="providers">Providers</Tab>
          <Tab value="routing">Routing Rules</Tab>
          <Tab value="privacy">Privacy & Security</Tab>
          <Tab value="usage">Usage & Costs</Tab>
        </TabList>

        <TabPanel value="providers">
          <ProviderList 
            providers={config.providers} 
            onUpdate={updateProvider}
            onTest={testProvider}
            onAdd={addProvider}
            testing={testing}
            userTier={userTier}
          />
        </TabPanel>

        <TabPanel value="routing">
          <RoutingRulesEditor
            policy={config.routingPolicy}
            onPolicyChange={p => setConfig(c => ({ ...c, routingPolicy: p }))}
            availableProviders={config.providers.filter(p => p.enabled)}
          />
        </TabPanel>

        <TabPanel value="privacy">
          <PrivacySecurityPanel
            settings={config.privacySettings}
            onChange={s => setConfig(c => ({ ...c, privacySettings: s }))}
          />
        </TabPanel>

        <TabPanel value="usage">
          <UsageCostDashboard
            providers={config.providers}
            timeRange="30d"
          />
        </TabPanel>
      </Tabs>

      <ModalFooter>
        <Button variant="ghost" onClick={() => setConfig(currentConfig)}>Reset</Button>
        <Button onClick={() => onSave(config)}>Save Configuration</Button>
      </ModalFooter>
    </Modal>
  );
};
```

### 2.3.3 Provider Template Registry

```typescript
const PROVIDER_TEMPLATES: Record<ProviderType, Partial<ProviderConfig>> = {
  anthropic: {
    type: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-3-5-sonnet-20241022',
    models: {
      'claude-3-5-sonnet-20241022': { maxTokens: 8192, contextWindow: 200000, costPer1kInput: 0.003, costPer1kOutput: 0.015 },
      'claude-3-5-haiku-20241022': { maxTokens: 8192, contextWindow: 200000, costPer1kInput: 0.0008, costPer1kOutput: 0.004 },
      'claude-3-opus-20240229': { maxTokens: 4096, contextWindow: 200000, costPer1kInput: 0.015, costPer1kOutput: 0.075 }
    }
  },
  openai: {
    type: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    models: {
      'gpt-4o': { maxTokens: 4096, contextWindow: 128000, costPer1kInput: 0.0025, costPer1kOutput: 0.01 },
      'gpt-4o-mini': { maxTokens: 16384, contextWindow: 128000, costPer1kInput: 0.00015, costPer1kOutput: 0.0006 },
      'o1-preview': { maxTokens: 32768, contextWindow: 128000, costPer1kInput: 0.015, costPer1kOutput: 0.06, supportsReasoning: true }
    }
  },
  ollama: {
    type: 'ollama',
    name: 'Local Ollama',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama3.1:70b-instruct',
    models: {}
  },
  vllm: {
    type: 'vllm',
    name: 'vLLM / Custom',
    baseUrl: '',
    defaultModel: '',
    models: {}
  },
  // ... google, azure, bedrock, together, fireworks, groq, perplexity, huggingface, custom
};
```

---

## Appendices

### A. Universal Provider Config Schema (Complete JSON Schema)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://aegis.legal/schemas/universal-provider-config/v1.json",
  "title": "AEGIS Universal Provider Configuration",
  "type": "object",
  "required": ["version", "providers", "routingPolicy"],
  "properties": {
    "version": { "type": "string", "const": "1.0" },
    "providers": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/providerConfig" }
    },
    "routingPolicy": { "$ref": "#/$defs/routingPolicy" },
    "privacySettings": { "$ref": "#/$defs/privacySettings" }
  },
  "$defs": {
    "providerConfig": {
      "type": "object",
      "required": ["id", "type", "name", "enabled", "priority", "config", "routing"],
      "properties": {
        "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
        "type": { "enum": ["anthropic","openai","google","azure","aws-bedrock","ollama","vllm","custom","huggingface","together","fireworks","groq","perplexity"] },
        "name": { "type": "string" },
        "enabled": { "type": "boolean" },
        "priority": { "type": "integer", "minimum": 1 },
        "config": { "$ref": "#/$defs/providerSpecificConfig" },
        "routing": { "$ref": "#/$defs/providerRouting" }
      }
    },
    "providerSpecificConfig": {
      "type": "object",
      "required": ["apiKey", "baseUrl", "defaultModel", "models"],
      "properties": {
        "apiKey": { "type": "string", "format": "env-var-reference" },
        "baseUrl": { "type": "string", "format": "uri" },
        "organizationId": { "type": "string" },
        "defaultModel": { "type": "string" },
        "models": {
          "type": "object",
          "additionalProperties": { "$ref": "#/$defs/modelConfig" }
        },
        "parameters": { "$ref": "#/$defs/modelParameters" },
        "rateLimits": { "$ref": "#/$defs/rateLimits" },
        "retryPolicy": { "$ref": "#/$defs/retryPolicy" },
        "dataResidency": { "$ref": "#/$defs/dataResidency" }
      }
    },
    "modelConfig": {
      "type": "object",
      "required": ["maxTokens", "contextWindow", "costPer1kInput", "costPer1kOutput"],
      "properties": {
        "maxTokens": { "type": "integer", "minimum": 1 },
        "contextWindow": { "type": "integer", "minimum": 1 },
        "supportsReasoning": { "type": "boolean" },
        "reasoningEffort": { "type": "array", "items": { "enum": ["low","medium","high"] } },
        "isEmbedding": { "type": "boolean" },
        "specialization": { "type": "array", "items": { "type": "string" } },
        "costPer1kInput": { "type": "number", "minimum": 0 },
        "costPer1kOutput": { "type": "number", "minimum": 0 },
        "hardwareRequirements": { "$ref": "#/$defs/hardwareRequirements" }
      }
    },
    "routingPolicy": {
      "type": "object",
      "required": ["strategy", "defaultFallbackChain", "costOptimization", "privacyRules", "latencyBudgets"],
      "properties": {
        "strategy": { "enum": ["capability_based", "cost_optimized", "privacy_first", "round_robin"] },
        "defaultFallbackChain": { "type": "array", "items": { "type": "string" } },
        "costOptimization": { "$ref": "#/$defs/costOptimization" },
        "privacyRules": { "$ref": "#/$defs/privacyRules" },
        "latencyBudgets": { "$ref": "#/$defs/latencyBudgets" },
        "taskRouting": {
          "type": "array",
          "items": { "$ref": "#/$defs/taskRoute" }
        }
      }
    }
  }
}
```

### B. Routing Decision Matrix (Extended)

| Dimension | Weight | Scoring Function |
|-----------|--------|------------------|
| Capability Match | 40% | Jaccard similarity between task requirements & provider capabilities |
| Privacy Compliance | 25% | Binary (0/1) — hard constraint |
| Cost Efficiency | 15% | Inverse normalized cost vs. budget tier |
| Latency | 10% | Inverse normalized latency vs. budget |
| Historical Success | 10% | Exponential moving average of task success rate |

### C. Event-Driven Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AEGIS EVENT-DRIVEN ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────┐  │
│  │   WORKSPACE │     │   CONTEXT   │     │  AGENT      │     │  AUDIT  │  │
│  │   EVENTS    │────▶│   BUS       │────▶│  ORCHESTRA- │────▶│  LOG    │  │
│  │             │     │  (Kafka/    │     │  TOR        │     │(Merkle) │  │
│  │ • Doc open  │     │   NATS)     │     │             │     │         │  │
│  │ • Edit      │     │             │     │ • Planner   │     │         │  │
│  │ • Upload    │     │ • Topic:    │     │ • Scheduler │     │         │  │
│  │ • Voice     │     │   context.* │     │ • Executor  │     │         │  │
│  │ • Timer     │     │ • Topic:    │     │ • Monitor   │     │         │  │
│  └─────────────┘     │   task.*    │     └──────┬──────┘     └─────────┘  │
│                      │ • Topic:    │            │                        │
│                      │   insight.* │            ▼                        │
│                      └──────┬──────┘     ┌─────────────┐                │
│                             │            │  PROVIDER   │                │
│                      ┌──────┴──────┐    │  ROUTER     │                │
│                      │  INSIGHT    │    │             │                │
│                      │  BROKER     │    │ • Select    │                │
│                      │             │    │ • Route     │                │
│                      │ • Heatmap   │    │ • Fallback  │                │
│                      │ • Simulation│    │ • Load Bal. │                │
│                      │ • Alerts    │    └──────┬──────┘                │
│                      └──────┬──────┘           │                        │
│                             │                  ▼                        │
│                      ┌──────┴──────┐   ┌─────────────┐                │
│                      │   UI LAYER  │   │  PROVIDERS  │                │
│                      │             │   │             │                │
│                      │ • Sidebar   │   │ • Anthropic │                │
│                      │ • Graph     │   │ • OpenAI    │                │
│                      │ • Voice     │   │ • Local     │                │
│                      │ • Deposition│   │ • Custom    │                │
│                      └─────────────┘   └─────────────┘                │
│                                                                             │
│  CROSS-CUTTING CONCERNS:                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  PRIVACY GATEWAY ◀── Intercepts ALL outbound requests              │   │
│  │  • Classifies content • Redacts privileged • Encrypts payload      │   │
│  │  • Enforces routing rules • Logs audit receipt                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Roadmap

| Phase | Timeline | Deliverables |
|-------|----------|--------------|
| **Phase 1: Foundation** | Q3 2026 | Universal provider adapter, routing engine, config modal, audit receipts |
| **Phase 2: Context Intelligence** | Q4 2026 | Local vector index, privilege classifier, continuous ingestion pipeline |
| **Phase 3: Autonomous Workflows** | Q1 2027 | Agent framework, workflow orchestrator, HITL checkpoint system |
| **Phase 4: Futuristic UX** | Q2 2027 | Ambient sidebar, argument graph, voice-to-brief, deposition analyzer |
| **Phase 5: Ecosystem** | Q3 2027 | Plugin SDK, marketplace, firm-level customization, multi-org federation |

---

*End of Specification*