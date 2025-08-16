Detailed MCP Tool Implementation Plan

  Tool 1: search_legal_precedents

  Purpose: Intelligently search IndianKanoon for relevant cases with smart ranking and filtering

  Step-by-Step Implementation:

  1. Input Processing
    - Accept query string and optional filters (court level, date range, judge)
    - Generate multiple search variants to maximize coverage:
        - Original query: "celebrity personality rights"
      - Boolean variant: celebrity ANDD personality ANDD rights
      - Individual terms: celebrity ORR personality ORR rights
      - IPC/BNS section extraction: Detect patterns like "Section 302" or "IPC 420"
  2. API Request Strategy
  // Parallel search requests for better coverage
  const searchVariants = [
    { formInput: query, pagenum: 0 },
    { formInput: `"${query}"`, pagenum: 0 }, // Exact phrase
    { formInput: query.replace(/\s+/g, ' ANDD '), pagenum: 0 } // Boolean AND
  ];

  // Execute in parallel with proper headers
  const requests = searchVariants.map(params =>
    fetch('https://api.indiankanoon.org/search/', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${config.indianKanoonApiKey}`,
        'Accept': 'application/json'
      },
      body: new URLSearchParams(params)
    })
  );
  3. Result Processing & Ranking
    - Deduplicate results by tid (document ID)
    - Apply intelligent scoring algorithm:
    score = baseScore * courtMultiplier * recencyBonus * citationWeight
  // Supreme Court: 1.5x, High Court: 1.2x, District: 1.0x
  // Recent cases (< 2 years): 1.3x bonus
  // Highly cited (numcitedby > 20): 1.4x weight
    - Extract and enhance metadata:
        - Parse docsource for court hierarchy
      - Extract year from publishdate
      - Clean HTML from headline for preview
  4. Output Format
  {
    "cases": [
      {
        "id": "178980348",
        "title": "Sentini Bio Products vs Allied Blenders",
        "court": "Delhi High Court",
        "year": "2015",
        "relevanceScore": 0.95,
        "summary": "Trademark infringement case regarding...",
        "citations": ["2015 Delhi HC 123"],
        "citedByCount": 24,
        "keyPrinciples": ["Deceptive similarity test", "Consumer confusion"]
      }
    ],
    "totalResults": 3371,
    "searchMetadata": {
      "queryUsed": "trademark infringement",
      "filtersApplied": ["Delhi High Court", "2015-2020"]
    }
  }

  ---
  Tool 2: extract_legal_principles

  Purpose: Extract specific legal principles and relevant paragraphs from cases with pinpoint citations

  Step-by-Step Implementation:

  1. Input Validation
    - Accept document ID and search terms/legal concepts
    - Validate document exists via metadata API first
    - Process search terms for optimal extraction:
    const searchTerms = [
    originalTerm,
    ...synonyms[originalTerm], // Legal synonyms mapping
    ...relatedConcepts[originalTerm] // Related legal concepts
  ];
  2. Fragment Extraction Strategy
  // Multiple fragment requests for comprehensive extraction
  const fragmentRequests = searchTerms.map(term =>
    fetch(`https://api.indiankanoon.org/docfragment/${docId}/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${config.indianKanoonApiKey}`,
        'Accept': 'application/json'
      },
      body: new URLSearchParams({ formInput: term })
    })
  );
  3. Fragment Processing & Context Building
    - Parse HTML fragments and preserve structure
    - Identify legal context markers:
    const contextMarkers = [
    /held that/i,
    /court observed/i,
    /principle of law/i,
    /ratio decidendi/i,
    /it was decided/i
  ];
    - Build context windows around key principles:
        - Extract 2-3 sentences before and after key principle
      - Preserve paragraph boundaries for context
      - Identify if fragment is from judgment, concurring, or dissenting opinion
  4. Citation Enhancement
  // Build precise citations for each principle
  function buildPreciseCitation(fragment, metadata) {
    const paragraphNumber = extractParagraphNumber(fragment);
    const section = identifySection(fragment); // Facts, Issues, Judgment, etc.

    return {
      fullCitation: `${metadata.title}, ${metadata.caseno}, para ${paragraphNumber}`,
      shortCitation: `${metadata.caseno}, para ${paragraphNumber}`,
      section: section,
      pinpointReference: `at para ${paragraphNumber} (${section})`
    };
  }
  5. Output Structure
  {
    "principles": [
      {
        "text": "The test for trademark infringement requires establishing...",
        "context": {
          "before": "The court, after examining precedents, observed that...",
          "after": "This principle has been consistently applied in..."
        },
        "citation": {
          "full": "Sentini Bio Products vs Allied, 2015 Delhi HC 493, para 15",
          "short": "2015 Delhi HC 493, para 15",
          "pinpoint": "at para 15 (Judgment)"
        },
        "legalWeight": "Ratio Decidendi",
        "judges": ["Pradeep Nandrajog", "Pratibha Rani"]
      }
    ],
    "documentMetadata": {
      "totalFragments": 5,
      "sectionsFound": ["Facts", "Issues", "Arguments", "Judgment"],
      "extractionConfidence": 0.85
    }
  }

  ---
  Tool 3: build_case_compilation

  Purpose: Automatically compile comprehensive legal research memos with organized cases and citations

  Step-by-Step Implementation:

  1. Research Planning Phase
  interface ResearchPlan {
    primaryIssue: string;
    subIssues: string[];
    searchQueries: string[];
    jurisdictionPreference: string[];
    dateRange?: { from: string; to: string };
  }

  // Generate comprehensive search strategy
  function planResearch(legalIssue: string): ResearchPlan {
    const subIssues = identifySubIssues(legalIssue);
    const queries = generateSearchQueries(legalIssue, subIssues);
    return {
      primaryIssue: legalIssue,
      subIssues,
      searchQueries: queries,
      jurisdictionPreference: ['supremecourt', 'delhi', 'bombay']
    };
  }
  2. Multi-Stage Search Execution
  // Stage 1: Broad search for leading cases
  const leadingCases = await searchWithFilters({
    formInput: primaryIssue,
    doctypes: 'supremecourt',
    maxResults: 10
  });

  // Stage 2: Find supporting cases via citations
  const citationNetwork = await buildCitationNetwork(leadingCases);

  // Stage 3: Search for recent developments
  const recentCases = await searchWithFilters({
    formInput: primaryIssue,
    fromdate: getDateTwoYearsAgo(),
    maxResults: 5
  });
  3. Legal Analysis & Organization
  function organizeCasesByPrinciple(cases: Case[]): OrganizedResearch {
    const principles = new Map();

    for (const case of cases) {
      const fragments = await extractKeyFragments(case.id);
      const legalPrinciples = identifyPrinciples(fragments);

      for (const principle of legalPrinciples) {
        if (!principles.has(principle.category)) {
          principles.set(principle.category, []);
        }
        principles.get(principle.category).push({
          case: case,
          principle: principle,
          strength: calculatePrecedentStrength(case)
        });
      }
    }

    return sortByLegalHierarchy(principles);
  }
  4. Research Memo Generation
  function generateResearchMemo(organizedResearch: OrganizedResearch): string {
    const memo = {
      executive_summary: generateSummary(organizedResearch),
      table_of_authorities: buildTableOfAuthorities(organizedResearch),
      legal_principles: {
        binding_precedents: filterBindingPrecedents(organizedResearch),
        persuasive_authorities: filterPersuasiveAuthorities(organizedResearch),
        distinguishable_cases: identifyDistinguishableCases(organizedResearch)
      },
      detailed_analysis: buildDetailedAnalysis(organizedResearch),
      conclusion: synthesizeConclusion(organizedResearch),
      citations: formatAllCitations(organizedResearch)
    };

    return formatAsMarkdown(memo);
  }
  5. Output Format
  # Legal Research Memo: [Issue]

  ## Executive Summary
  - Primary legal question: ...
  - Applicable law: ...
  - Key precedents: ...

  ## Table of Authorities

  ### Supreme Court Cases
  1. Case Name (Citation) - Principle

  ### High Court Cases
  1. Case Name (Citation) - Principle

  ## Legal Analysis

  ### Binding Precedents
  **[Case Name] (Citation)**
  - Facts: ...
  - Holding: ...
  - Application: ...

  ### Supporting Authorities
  ...

  ## Conclusion
  Based on the analysis of [X] cases...

  ## Full Citations
  [Formatted bibliography]

  ---
  Tool 4: format_citations

  Purpose: Generate properly formatted legal citations in various Indian citation styles

  Step-by-Step Implementation:

  1. Citation Data Collection
  async function gatherCitationData(docId: string) {
    // Get metadata for basic info
    const metadata = await fetchMetadata(docId);

    // Extract additional citation elements
    const citationElements = {
      parties: extractParties(metadata.title),
      court: metadata.doctype,
      year: metadata.publishdate.split('-')[0],
      caseNumber: metadata.caseno,
      judges: [], // Would need to extract from document
      reporterCitations: findReporterCitations(metadata)
    };

    return citationElements;
  }
  2. Citation Style Templates
  const citationStyles = {
    'AIR': {
      format: '[Year] AIR [Court] [Page]',
      example: '2015 AIR Del 123'
    },
    'SCC': {
      format: '[Parties] ([Year]) [Volume] SCC [Page]',
      example: 'Sentini Bio Products v. Allied Blenders (2015) 5 SCC 123'
    },
    'Neutral': {
      format: '[Year] INSC [Number]',
      example: '2023 INSC 456'
    },
    'OnLine': {
      format: '[Year] SCC OnLine [Court] [Number]',
      example: '2015 SCC OnLine Del 4885'
    }
  };
  3. Citation Formatting Engine
  function formatCitation(elements: CitationElements, style: string): FormattedCitation {
    const template = citationStyles[style];

    // Apply formatting rules
    const formatted = {
      full: buildFullCitation(elements, template),
      short: buildShortCitation(elements),
      inText: buildInTextCitation(elements),
      footnote: buildFootnoteCitation(elements),
      bibliography: buildBibliographyCitation(elements)
    };

    // Add pinpoint references if provided
    if (elements.paragraph) {
      formatted.pinpoint = `${formatted.full}, ¶ ${elements.paragraph}`;
    }

    return formatted;
  }
  4. Parallel Citation Discovery
  async function findParallelCitations(docId: string, primaryCitation: string) {
    // Search for the case using different citation formats
    const searchQueries = [
      `cite:${primaryCitation}`,
      `title:${extractParties(primaryCitation)}`
    ];

    const results = await Promise.all(
      searchQueries.map(q => searchAPI(q))
    );

    // Extract all citations found
    const parallelCitations = extractCitationsFromResults(results);

    return deduplicateAndValidate(parallelCitations);
  }
  5. Output Structure
  {
    "primary": {
      "style": "SCC OnLine",
      "citation": "2015 SCC OnLine Del 4885",
      "confidence": 0.95
    },
    "parallel": [
      {
        "style": "AIR",
        "citation": "2015 AIR Del 234",
        "confidence": 0.80
      }
    ],
    "formatted": {
      "full": "Sentini Bio Products Pvt. Ltd. v. Allied Blenders & Distillers Pvt. Ltd., 2015 SCC OnLine Del 4885",
      "short": "Sentini Bio Products, 2015 SCC OnLine Del 4885",
      "inText": "(Sentini Bio Products, 2015)",
      "footnote": "Sentini Bio Products Pvt. Ltd. v. Allied Blenders & Distillers Pvt. Ltd., 2015 SCC OnLine Del
  4885 (Delhi High Court)",
      "bibliography": "Sentini Bio Products Pvt. Ltd. v. Allied Blenders & Distillers Pvt. Ltd. (2015). Delhi High
  Court. 2015 SCC OnLine Del 4885."
    }
  }

  ---
  Tool 5: verify_citations

  Purpose: Validate citation accuracy and find missing information

  Step-by-Step Implementation:

  1. Citation Parsing
  function parseCitation(citation: string): ParsedCitation {
    const patterns = {
      'AIR': /(\d{4})\s+AIR\s+(\w+)\s+(\d+)/,
      'SCC': /\((\d{4})\)\s+(\d+)\s+SCC\s+(\d+)/,
      'Neutral': /(\d{4})\s+IN(\w+)\s+(\d+)/,
      // ... more patterns
    };

    for (const [style, pattern] of Object.entries(patterns)) {
      const match = citation.match(pattern);
      if (match) {
        return {
          style,
          year: match[1],
          reporter: style,
          volume: match[2],
          page: match[3]
        };
      }
    }
  }
  2. Verification Process
  async function verifyCitation(citation: string): Promise<VerificationResult> {
    const parsed = parseCitation(citation);

    // Search using citation
    const searchResult = await searchAPI({
      formInput: `cite:"${citation}"`,
      pagenum: 0
    });

    if (searchResult.found === "0") {
      // Try alternative search strategies
      const alternativeSearches = [
        searchByParties(parsed),
        searchByYearAndCourt(parsed),
        searchByKeywords(parsed)
      ];

      const altResults = await Promise.all(alternativeSearches);
      return analyzeAlternativeResults(altResults, citation);
    }

    return {
      isValid: true,
      confidence: calculateConfidence(searchResult),
      document: searchResult.docs[0],
      suggestions: []
    };
  }
  3. Cross-Reference Validation
  async function crossReferenceValidation(citations: string[]): Promise<ValidationReport> {
    const results = await Promise.all(
      citations.map(cite => verifyCitation(cite))
    );

    // Check for inconsistencies
    const inconsistencies = findInconsistencies(results);

    // Find missing parallel citations
    const missingCitations = await findMissingParallelCitations(results);

    // Check temporal consistency
    const temporalIssues = checkTemporalConsistency(results);

    return {
      validCitations: results.filter(r => r.isValid),
      invalidCitations: results.filter(r => !r.isValid),
      inconsistencies,
      missingCitations,
      temporalIssues
    };
  }
  4. Error Detection & Correction
  function suggestCorrections(invalidCitation: string, searchResults: any): Suggestion[] {
    const suggestions = [];

    // Check for common errors
    if (hasTypo(invalidCitation)) {
      suggestions.push({
        type: 'TYPO',
        original: invalidCitation,
        suggested: correctTypo(invalidCitation),
        confidence: 0.8
      });
    }

    // Check for format errors
    if (hasFormatError(invalidCitation)) {
      suggestions.push({
        type: 'FORMAT',
        original: invalidCitation,
        suggested: reformatCitation(invalidCitation),
        confidence: 0.9
      });
    }

    // Suggest similar cases
    const similarCases = findSimilarCases(invalidCitation, searchResults);
    suggestions.push(...similarCases.map(c => ({
      type: 'SIMILAR',
      original: invalidCitation,
      suggested: c.citation,
      confidence: c.similarity
    })));

    return suggestions;
  }
  5. Output Format
  {
    "validationResults": [
      {
        "citation": "2015 SCC OnLine Del 4885",
        "status": "VALID",
        "confidence": 1.0,
        "documentFound": {
          "id": "178980348",
          "title": "Sentini Bio Products vs Allied Blenders",
          "exactMatch": true
        }
      },
      {
        "citation": "2015 AIR Dell 234",
        "status": "INVALID",
        "confidence": 0.0,
        "errors": ["Court abbreviation 'Dell' not recognized"],
        "suggestions": [
          {
            "corrected": "2015 AIR Del 234",
            "confidence": 0.95,
            "reason": "Common typo in court abbreviation"
          }
        ]
      }
    ],
    "summary": {
      "totalChecked": 10,
      "valid": 8,
      "invalid": 2,
      "correctable": 2
    }
  }

  ---
  Configuration Schema for the MCP Server

  configSchema:
    type: object
    required: ["indianKanoonApiKey"]
    properties:
      indianKanoonApiKey:
        type: string
        title: "IndianKanoon API Key"
        description: "Your API key from IndianKanoon"

      defaultCourt:
        type: string
        title: "Default Court"
        description: "Preferred court for searches"
        enum: ["supremecourt", "delhi", "bombay", "madras", "calcutta"]
        default: "supremecourt"

      maxSearchResults:
        type: integer
        title: "Maximum Search Results"
        description: "Maximum number of search results to return"
        default: 20
        minimum: 10
        maximum: 100

      citationStyle:
        type: string
        title: "Preferred Citation Style"
        description: "Default citation format"
        enum: ["AIR", "SCC", "Neutral", "SCC OnLine"]
        default: "SCC OnLine"

      enableCaching:
        type: boolean
        title: "Enable Caching"
        description: "Cache search results and documents"
        default: true

      cacheTimeout:
        type: integer
        title: "Cache Timeout (minutes)"
        description: "How long to cache results"
        default: 60
        minimum: 10
        maximum: 1440

  Performance Optimizations

  1. Request Batching: Execute multiple API calls in parallel
  2. Smart Caching: Cache metadata for 24h, search results for 1h
  3. Fragment Priority: Use fragments API over full documents when possible
  4. Deduplication: Remove duplicate results across search variants
  5. Progressive Loading: Load essential data first, details on demand

  Error Handling Strategy

  1. Rate Limiting: Implement exponential backoff
  2. Fallback Searches: Multiple search strategies if primary fails
  3. Graceful Degradation: Return partial results with confidence scores
  4. User Feedback: Clear error messages with suggested actions

●User approved Claude's plan:
  ⎿ IndianLegalMCP Implementation Plan

    Overview

    Build a comprehensive MCP server with 5 specialized tools to automate legal research and citation work for
    Indian lawyers.

    Tools to Implement

    1. search_legal_precedents

    - Multi-variant search strategy (exact phrase, boolean, individual terms)
    - Intelligent ranking based on court hierarchy, recency, and citations
    - Parallel API requests for comprehensive coverage
    - Output: Ranked cases with relevance scores and key principles

    2. extract_legal_principles

    - Fragment-based extraction using multiple search terms
    - Context window building around key legal principles
    - Precise paragraph-level citations
    - Output: Legal principles with full context and pinpoint citations

    3. build_case_compilation

    - Multi-stage search (leading cases → citation network → recent developments)
    - Automatic organization by legal principles
    - Research memo generation with proper structure
    - Output: Complete legal research memo in markdown format

    4. format_citations

    - Support for multiple Indian citation styles (AIR, SCC, Neutral, OnLine)
    - Parallel citation discovery
    - Multiple format outputs (full, short, in-text, footnote, bibliography)
    - Output: Properly formatted citations with confidence scores

    5. verify_citations

    - Citation parsing and validation
    - Error detection with correction suggestions
    - Cross-reference validation across multiple citations
    - Output: Validation report with corrections and suggestions

    Technical Implementation

    API Integration

    - POST requests to IndianKanoon API endpoints
    - Token-based authentication
    - Parallel request execution for performance
    - Smart error handling with fallback strategies

    Configuration

    - Required: IndianKanoon API key
    - Optional: Default court, citation style, caching settings
    - Session-based configuration via Smithery

    Performance Optimizations

    - Request batching and parallel execution
    - Smart caching (metadata: 24h, search: 1h)
    - Fragment API prioritization over full documents
    - Result deduplication across search variants

    Value Proposition

    - Reduce citation work from 3-4 hours to 30 minutes
    - Eliminate manual formatting errors
    - Comprehensive research coverage with intelligent ranking
    - Professional legal memo generation

    Next Steps

    1. Set up TypeScript MCP server with Smithery scaffold
    2. Implement API wrapper with error handling
    3. Build each tool with comprehensive testing
    4. Add caching layer for performance
    5. Deploy via Smithery for easy client access

