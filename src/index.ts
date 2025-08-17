import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const configSchema = z.object({
  indianKanoonApiKey: z.string().describe("Your API key from IndianKanoon"),
  defaultCourt: z.enum(["supremecourt", "delhi", "bombay", "madras", "calcutta"]).default("supremecourt").describe("Preferred court for searches"),
  maxSearchResults: z.number().min(10).max(100).default(20).describe("Maximum number of search results to return"),
  citationStyle: z.enum(["AIR", "SCC", "Neutral", "SCC OnLine"]).default("SCC OnLine").describe("Default citation format"),
  enableCaching: z.boolean().default(true).describe("Cache search results and documents"),
  cacheTimeout: z.number().min(10).max(1440).default(60).describe("How long to cache results in minutes"),
  debug: z.boolean().default(false).describe("Enable debug logging"),
});

type Config = z.infer<typeof configSchema>;

interface SearchResult {
  tid: number;
  title: string;
  doctype: string | number;
  publishdate: string;
  headline?: string;
  numcites?: number;
  numcitedby?: number;
  docsource?: string;
  author?: string;
  citation?: string;
  caseno?: string;
  relurl?: string;
}

interface CitationElements {
  parties: string;
  court: string;
  year: string;
  caseNumber?: string;
  judges?: string[];
  reporterCitations?: string[];
  paragraph?: string;
}

// Court doctype mappings for IndianKanoon API
const COURT_DOCTYPES: Record<string, string | undefined> = {
  'supremecourt': 'supremecourt',
  'delhi': 'delhihighcourt',
  'bombay': 'bombayhighcourt',
  'madras': 'madrashighcourt',
  'calcutta': 'calcuttahighcourt',
  'all': undefined
};

// Citation validation patterns - more flexible
const CITATION_PATTERNS = {
  'AIR': {
    // More flexible AIR pattern - handles just year AIR number format
    pattern: /^(?:\()?(?:19|20)\d{2}\)?\s+AIR\s+(?:[A-Z][a-z]*(?:\s+[A-Z][a-z]*)?\s+)?\d+$/,
    example: '1986 AIR 515 or 2020 AIR SC 123',
    extract: /((?:19|20)\d{2})\s+AIR\s+(\w+(?:\s+\w+)?)?\s*(\d+)/
  },
  'SCC': {
    // Handle various SCC formats
    pattern: /^(?:\()?(?:19|20)\d{2}\)?\s+(?:\d+\s+)?SCC\s+\d+$/,
    example: '(2020) 5 SCC 123 or 2020 SCC 456',
    extract: /\(?((?:19|20)\d{2})\)?\s+(\d*)\s*SCC\s+(\d+)/
  },
  'SCC_OnLine': {
    // SCC OnLine format
    pattern: /^(?:19|20)\d{2}\s+SCC\s+OnLine\s+[A-Z][a-z]+\s+\d+$/,
    example: '2020 SCC OnLine Del 123',
    extract: /((?:19|20)\d{2})\s+SCC\s+OnLine\s+(\w+)\s+(\d+)/
  },
  'SCCOnLine': {
    // Alternative without space
    pattern: /^(?:19|20)\d{2}\s+SCCOnLine\s+[A-Z][a-z]+\s+\d+$/,
    example: '2020 SCCOnLine Del 123',
    extract: /((?:19|20)\d{2})\s+SCCOnLine\s+(\w+)\s+(\d+)/
  },
  'Neutral': {
    pattern: /^(?:19|20)\d{2}\s+IN[A-Z]{2,4}\s+\d+$/,
    example: '2020 INSC 123',
    extract: /((?:19|20)\d{2})\s+IN([A-Z]{2,4})\s+(\d+)/
  }
};

class IndianKanoonClient {
  private baseUrl = "https://api.indiankanoon.org";
  private apiKey: string;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTimeout: number;
  private enableCaching: boolean;
  private requestQueue: Promise<any> = Promise.resolve();
  private requestDelay = 100; // ms between requests

  constructor(config: Config) {
    this.apiKey = config.indianKanoonApiKey;
    this.cacheTimeout = config.cacheTimeout * 60 * 1000;
    this.enableCaching = config.enableCaching;
  }

  private getCacheKey(endpoint: string, params: any): string {
    return `${endpoint}:${JSON.stringify(params)}`;
  }

  private getFromCache(key: string): any | null {
    if (!this.enableCaching) return null;
    const cached = this.cache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > this.cacheTimeout) {
      this.cache.delete(key);
      return null;
    }
    return cached.data;
  }

  private setCache(key: string, data: any): void {
    if (!this.enableCaching) return;
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  private async throttledRequest(
    endpoint: string,
    options: RequestInit,
    retries = 3
  ): Promise<any> {
    // Queue requests to avoid rate limiting
    this.requestQueue = this.requestQueue.then(() =>
      new Promise(resolve => setTimeout(resolve, this.requestDelay))
    );

    await this.requestQueue;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(endpoint, options);

        if (response.status === 429) {
          // Rate limited - exponential backoff
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        if (attempt === retries - 1) throw error;
        await new Promise(resolve =>
          setTimeout(resolve, 1000 * (attempt + 1))
        );
      }
    }
  }

  async search(formInput: string, pagenum: number = 0, filters?: any): Promise<any> {
    const params = {
      formInput,
      pagenum: pagenum.toString(),
      ...filters
    };

    const cacheKey = this.getCacheKey("/search/", params);
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.throttledRequest(
        `${this.baseUrl}/search/`,
        {
          method: "POST",
          headers: {
            "Authorization": `Token ${this.apiKey}`,
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams(params).toString()
        }
      );

      this.setCache(cacheKey, data);
      return data;
    } catch (error) {
      throw new Error(formatError(error, 'search'));
    }
  }

  async getDocument(docId: string, maxcites?: number, maxcitedby?: number): Promise<any> {
    const params: any = {};
    if (maxcites) params.maxcites = maxcites.toString();
    if (maxcitedby) params.maxcitedby = maxcitedby.toString();

    const cacheKey = this.getCacheKey(`/doc/${docId}/`, params);
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.throttledRequest(
        `${this.baseUrl}/doc/${docId}/`,
        {
          method: "POST",
          headers: {
            "Authorization": `Token ${this.apiKey}`,
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams(params).toString()
        }
      );

      this.setCache(cacheKey, data);
      return data;
    } catch (error) {
      throw new Error(formatError(error, 'document fetch'));
    }
  }

  async getDocumentFragments(docId: string, formInput: string): Promise<any> {
    const params = { formInput };
    const cacheKey = this.getCacheKey(`/docfragment/${docId}/`, params);
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.throttledRequest(
        `${this.baseUrl}/docfragment/${docId}/`,
        {
          method: "POST",
          headers: {
            "Authorization": `Token ${this.apiKey}`,
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams(params).toString()
        }
      );

      this.setCache(cacheKey, data);
      return data;
    } catch (error) {
      throw new Error(formatError(error, 'fragment fetch'));
    }
  }

  async getDocumentMetadata(docId: string): Promise<any> {
    const cacheKey = this.getCacheKey(`/docmeta/${docId}/`, {});
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.throttledRequest(
        `${this.baseUrl}/docmeta/${docId}/`,
        {
          method: "POST",
          headers: {
            "Authorization": `Token ${this.apiKey}`,
            "Accept": "application/json"
          }
        }
      );

      this.setCache(cacheKey, data);
      return data;
    } catch (error) {
      throw new Error(formatError(error, 'metadata fetch'));
    }
  }
}

// Section validation ranges
const VALID_IPC_SECTIONS = { min: 1, max: 511 };
const VALID_BNS_SECTIONS = { min: 1, max: 358 };
const VALID_CRPC_SECTIONS = { min: 1, max: 484 };

// Validate section numbers and suggest corrections
function validateSection(sectionNum: string, codeType: string = 'IPC'): {
  isValid: boolean;
  suggestion?: string;
  nearestValid?: string[];
} {
  // Extract numeric part
  const numMatch = sectionNum.match(/^(\d+)([A-Z])?$/);
  if (!numMatch) {
    return { isValid: false, suggestion: 'Invalid section format' };
  }
  
  const num = parseInt(numMatch[1]);
  const suffix = numMatch[2] || '';
  
  let range = VALID_IPC_SECTIONS;
  if (codeType === 'BNS') range = VALID_BNS_SECTIONS;
  else if (codeType === 'CrPC') range = VALID_CRPC_SECTIONS;
  
  if (num >= range.min && num <= range.max) {
    return { isValid: true };
  }
  
  // Suggest closest valid sections
  const nearestValid: string[] = [];
  
  // Common typos and their corrections
  const commonMistakes: Record<string, string[]> = {
    '823': ['323', '423'], // Likely meant 323 or 423
    '523': ['323', '423'],
    '325': ['323', '324', '326'], // Hurt-related sections
    '121': ['120', '120A', '120B'], // Criminal conspiracy
    '412': ['411', '413', '414'], // Stolen property sections
    '299': ['299', '300', '302'], // Murder-related
    '380': ['379', '381', '382'], // Theft-related
  };
  
  if (commonMistakes[num.toString()]) {
    nearestValid.push(...commonMistakes[num.toString()]);
  }
  
  // If number is too high, suggest removing first digit
  if (num > range.max && num > 100) {
    const withoutFirst = num.toString().substring(1);
    if (withoutFirst.length > 0) {
      const suggested = parseInt(withoutFirst);
      if (suggested >= range.min && suggested <= range.max) {
        nearestValid.push(withoutFirst);
      }
    }
  }
  
  // Suggest nearby valid sections
  for (let offset of [-1, 1, -2, 2, -10, 10]) {
    const nearby = num + offset;
    if (nearby >= range.min && nearby <= range.max) {
      nearestValid.push(nearby.toString());
    }
  }
  
  return {
    isValid: false,
    suggestion: `Section ${sectionNum} appears invalid for ${codeType}`,
    nearestValid: [...new Set(nearestValid)].slice(0, 5)
  };
}

// Preprocess query to extract sections and normalize format
interface ProcessedQuery {
  originalQuery: string;
  normalizedQuery: string;
  extractedSections: string[];
  validatedSections: Array<{
    original: string;
    validated: string;
    isValid: boolean;
    suggestions?: string[];
  }>;
  legalConcepts: string[];
  searchVariants: string[];
}

function preprocessQuery(query: string): ProcessedQuery {
  const processed: ProcessedQuery = {
    originalQuery: query,
    normalizedQuery: query,
    extractedSections: [],
    validatedSections: [],
    legalConcepts: [],
    searchVariants: []
  };
  
  // Extract section numbers with various formats
  const sectionPatterns = [
    /\bsections?\s+(\d+[A-Z]?(?:\s*,\s*\d+[A-Z]?)*)/gi,
    /\bu\/s\s+(\d+[A-Z]?(?:\s*,\s*\d+[A-Z]?)*)/gi,
    /\bsec\.?\s+(\d+[A-Z]?)/gi,
    /\b(\d{3}[A-Z]?)\s+(?:IPC|BNS|CrPC)/gi
  ];
  
  // Detect code type from query
  let codeType = 'IPC';
  if (query.toLowerCase().includes('bns')) codeType = 'BNS';
  else if (query.toLowerCase().includes('crpc')) codeType = 'CrPC';
  
  for (const pattern of sectionPatterns) {
    let match;
    while ((match = pattern.exec(query)) !== null) {
      const sections = match[1].split(/\s*,\s*/);
      for (const section of sections) {
        const trimmed = section.trim();
        processed.extractedSections.push(trimmed);
        
        // Validate each section
        const validation = validateSection(trimmed, codeType);
        processed.validatedSections.push({
          original: trimmed,
          validated: validation.isValid ? trimmed : (validation.nearestValid?.[0] || trimmed),
          isValid: validation.isValid,
          suggestions: validation.nearestValid
        });
      }
    }
  }
  
  // Extract legal concepts
  const conceptPatterns = [
    /\b(bail|quashing|compromise|arrest|conviction|acquittal|sentence)\b/gi,
    /\b(prima facie|mens rea|actus reus|mala fide|bona fide)\b/gi,
    /\b(common intention|criminal conspiracy|abetment)\b/gi
  ];
  
  for (const pattern of conceptPatterns) {
    let match;
    while ((match = pattern.exec(query)) !== null) {
      processed.legalConcepts.push(match[1].toLowerCase());
    }
  }
  
  // Normalize query variations
  let normalized = query;
  normalized = normalized.replace(/\bu\/s\b/gi, 'under Section');
  normalized = normalized.replace(/\br\/w\b/gi, 'read with');
  normalized = normalized.replace(/\bSec\.?\s+/gi, 'Section ');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  processed.normalizedQuery = normalized;
  
  // Generate search variants based on extracted data
  if (processed.extractedSections.length > 0) {
    // Variant 1: Sections with quotes
    processed.searchVariants.push(
      processed.extractedSections.map(s => `"Section ${s}"`).join(' ')
    );
    
    // Variant 2: Sections with IPC/BNS
    processed.searchVariants.push(
      processed.extractedSections.map(s => `Section ${s} IPC`).join(' ')
    );
    
    // Variant 3: With legal concepts
    if (processed.legalConcepts.length > 0) {
      processed.searchVariants.push(
        `${processed.extractedSections[0]} ${processed.legalConcepts[0]}`
      );
    }
  }
  
  // Add normalized query as a variant
  processed.searchVariants.push(normalized);
  
  // Add query with ANDD operators
  const withAndd = normalized.replace(/\s+/g, ' ANDD ');
  processed.searchVariants.push(withAndd);
  
  return processed;
}

// Calculate relevance score between query and document
function calculateQueryRelevance(
  query: ProcessedQuery, 
  doc: SearchResult,
  baseScore: number = 1.0
): number {
  let score = baseScore;
  
  // Check section matches (highest weight - 40%)
  if (query.extractedSections.length > 0) {
    const docText = `${doc.title} ${doc.headline || ''}`.toLowerCase();
    const sectionMatches = query.extractedSections.filter(section => {
      // Check various formats
      return docText.includes(`section ${section}`) ||
             docText.includes(`${section} ipc`) ||
             docText.includes(`sec. ${section}`) ||
             docText.includes(`s. ${section}`);
    });
    
    if (sectionMatches.length > 0) {
      score *= (1 + (sectionMatches.length / query.extractedSections.length) * 0.4);
    } else {
      // Penalize if no sections match when sections were requested
      score *= 0.5;
    }
  }
  
  // Check legal concept matches (30% weight)
  if (query.legalConcepts.length > 0) {
    const docText = `${doc.title} ${doc.headline || ''}`.toLowerCase();
    const conceptMatches = query.legalConcepts.filter(concept =>
      docText.includes(concept)
    );
    
    if (conceptMatches.length > 0) {
      score *= (1 + (conceptMatches.length / query.legalConcepts.length) * 0.3);
    }
  }
  
  // Check keyword density (20% weight)
  const queryWords = query.normalizedQuery.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !['under', 'section', 'with'].includes(w));
  
  if (queryWords.length > 0) {
    const docText = `${doc.title} ${doc.headline || ''}`.toLowerCase();
    const wordMatches = queryWords.filter(word => docText.includes(word));
    score *= (1 + (wordMatches.length / queryWords.length) * 0.2);
  }
  
  // Court hierarchy bonus (10% weight) - already handled in base score
  
  return score;
}

// Generate alternative queries when search fails
function generateAlternativeQueries(originalQuery: string, processed: ProcessedQuery): string[] {
  const alternatives: string[] = [];
  
  // Strategy 1: Just sections if available
  if (processed.extractedSections.length > 0) {
    alternatives.push(processed.extractedSections.map(s => `Section ${s}`).join(' '));
    alternatives.push(processed.extractedSections.map(s => `"Section ${s}" IPC`).join(' ORR '));
  }
  
  // Strategy 2: Just legal concepts
  if (processed.legalConcepts.length > 0) {
    alternatives.push(processed.legalConcepts.join(' '));
    if (processed.extractedSections.length > 0) {
      alternatives.push(`${processed.legalConcepts[0]} ${processed.extractedSections[0]}`);
    }
  }
  
  // Strategy 3: Remove quoted phrases
  const withoutQuotes = originalQuery.replace(/"[^"]*"/g, '').trim();
  if (withoutQuotes !== originalQuery && withoutQuotes.length > 0) {
    alternatives.push(withoutQuotes);
  }
  
  // Strategy 4: Broader search with main keywords
  const mainKeywords = originalQuery
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !['under', 'section', 'with', 'read'].includes(w.toLowerCase()))
    .slice(0, 3);
  
  if (mainKeywords.length > 0) {
    alternatives.push(mainKeywords.join(' '));
  }
  
  // Strategy 5: If nothing else works, suggest generic searches
  if (alternatives.length === 0) {
    if (originalQuery.toLowerCase().includes('bail')) {
      alternatives.push('bail application granted', 'anticipatory bail guidelines');
    }
    if (originalQuery.toLowerCase().includes('quash')) {
      alternatives.push('482 CrPC quashing', 'FIR quashing grounds');
    }
  }
  
  // Return unique alternatives
  return [...new Set(alternatives)].slice(0, 5);
}

// Analyze why a search failed and provide guidance
function analyzeSearchFailure(query: string, processed: ProcessedQuery): {
  reason: string;
  suggestions: string[];
  alternativeQueries: string[];
} {
  const analysis = {
    reason: '',
    suggestions: [] as string[],
    alternativeQueries: [] as string[]
  };
  
  // Check if query is too specific
  if (query.split(/\s+/).length > 10) {
    analysis.reason = 'Query may be too specific';
    analysis.suggestions.push('Try using fewer words or just the key legal terms');
  }
  
  // Check if sections might be incorrect
  if (processed.extractedSections.length > 0) {
    const uncommonSections = processed.extractedSections.filter(s => {
      const num = parseInt(s);
      return num > 511 || num < 1;
    });
    
    if (uncommonSections.length > 0) {
      analysis.reason = 'Some section numbers appear invalid';
      analysis.suggestions.push('Verify the section numbers are correct');
      analysis.suggestions.push('Try searching without section numbers');
    }
  }
  
  // Check if mixing incompatible terms
  if (query.includes('civil') && query.includes('IPC')) {
    analysis.reason = 'Query mixes civil and criminal law terms';
    analysis.suggestions.push('IPC is for criminal cases - remove "civil" from query');
  }
  
  // If no specific issue found
  if (!analysis.reason) {
    analysis.reason = 'No exact matches found for your query';
    analysis.suggestions.push('Try broadening your search terms');
    analysis.suggestions.push('Remove quotes to allow partial matches');
    analysis.suggestions.push('Search for the general legal principle instead of specific facts');
  }
  
  // Generate alternative queries
  analysis.alternativeQueries = generateAlternativeQueries(query, processed);
  
  return analysis;
}

// Helper function to format errors with actionable feedback
function formatError(error: any, context: string): string {
  const errorMsg = error instanceof Error ? error.message : String(error);
  
  if (errorMsg.includes('401')) {
    return `Authentication failed: Please check your IndianKanoon API key in settings`;
  }
  if (errorMsg.includes('429')) {
    return `Rate limit exceeded: Please wait a moment and try again`;
  }
  if (errorMsg.includes('Network') || errorMsg.includes('fetch')) {
    return `Network error: Please check your internet connection`;
  }
  if (errorMsg.includes('timeout')) {
    return `Request timeout: The server took too long to respond. Try with fewer results`;
  }
  
  return `Error in ${context}: ${errorMsg}
Suggestions: 
1. Verify your API key is valid
2. Check if the document ID exists
3. Try with different search terms`;
}

// Helper function to extract case number from metadata
function extractCaseNumber(metadata: any): string {
  // First try caseno field - handle null properly
  if (metadata.caseno && metadata.caseno !== null && metadata.caseno !== '') {
    return metadata.caseno;
  }
  
  // Try to extract from relurl
  if (metadata.relurl) {
    // Pattern 1: "delhi/2011-01-28/IA--9089-2010" -> "IA--9089-2010"
    const urlParts = metadata.relurl.split('/');
    const lastPart = urlParts[urlParts.length - 1];
    if (lastPart && /[A-Z]/.test(lastPart) && !lastPart.includes('.')) {
      return lastPart;
    }
    
    // Pattern 2: Extract case number from title if in relurl
    const caseNoMatch = metadata.relurl.match(/([A-Z]+[\s\-]*\d+[\s\-]*(?:of|\/)?\s*\d{4})/i);
    if (caseNoMatch) {
      return caseNoMatch[1];
    }
  }
  
  // Try to extract from title
  if (metadata.title) {
    // Common patterns in titles
    const patterns = [
      /Case No[.\s:]*([A-Z]+[\s\-]*\d+[\s\-]*(?:of|\/)\s*\d{4})/i,
      /\(([A-Z]+[\s\-]*\d+[\s\-]*(?:of|\/)\s*\d{4})\)/,
      /No[.\s:]*(\d+[\s\-]*(?:of|\/)\s*\d{4})/i
    ];
    
    for (const pattern of patterns) {
      const match = metadata.title.match(pattern);
      if (match) return match[1];
    }
  }
  
  // Fallback to document ID
  return metadata.tid?.toString() || `[No. ${new Date().getFullYear()}]`;
}

// Find natural sentence boundary for complete text extraction
function findSentenceBoundary(text: string, startPos: number, maxLength: number = 1500): number {
  // If text is shorter than max, return full length
  if (text.length <= maxLength) {
    return text.length;
  }
  
  // Look for sentence endings after minimum length
  const minLength = Math.min(1000, maxLength * 0.7);
  const searchText = text.substring(startPos + minLength, startPos + maxLength + 200);
  
  // Patterns that indicate sentence end
  const sentenceEndings = [
    /\.\s+[A-Z]/g,  // Period followed by capital letter
    /\.\"\s+/g,     // Period, quote, space
    /\.\)\s+/g,     // Period, parenthesis, space
    /\?\s+/g,       // Question mark
    /!\s+/g,        // Exclamation mark
    /\.\s*$/g       // Period at end
  ];
  
  let bestPosition = -1;
  
  for (const pattern of sentenceEndings) {
    let match;
    while ((match = pattern.exec(searchText)) !== null) {
      const position = startPos + minLength + match.index + 1;
      if (position < startPos + maxLength && position > bestPosition) {
        bestPosition = position;
      }
    }
  }
  
  // If no sentence ending found, look for other natural breaks
  if (bestPosition === -1) {
    const fallbackPatterns = [
      /;\s+/g,        // Semicolon
      /:\s+/g,        // Colon
      /\n\n/g,        // Paragraph break
      /\.\s*/g        // Any period
    ];
    
    for (const pattern of fallbackPatterns) {
      let match;
      while ((match = pattern.exec(searchText)) !== null) {
        const position = startPos + minLength + match.index + 1;
        if (position < startPos + maxLength && position > bestPosition) {
          bestPosition = position;
          break; // Take first fallback match
        }
      }
    }
  }
  
  // If still no break found, just use max length
  return bestPosition > 0 ? bestPosition : startPos + maxLength;
}

// Extract real paragraph numbers from HTML fragments
function extractRealParagraphNumber(htmlFragment: string): string | null {
  // Strategy 1: Look for data-structure attribute
  const dataStructureMatch = htmlFragment.match(/data-structure="[^"]*"\s+id="p_(\d+)"/);
  if (dataStructureMatch) {
    return dataStructureMatch[1];
  }
  
  // Strategy 2: Look for id attribute in p or div tags
  const idMatch = htmlFragment.match(/(?:<p|<div)[^>]*\sid="(?:p_|para_?)(\d+)"/i);
  if (idMatch) {
    return idMatch[1];
  }
  
  // Strategy 3: Look for blockquote with id
  const blockquoteMatch = htmlFragment.match(/<blockquote[^>]*\sid="blockquote_(\d+)"/i);
  if (blockquoteMatch) {
    return blockquoteMatch[1];
  }
  
  // Strategy 4: Look for explicit paragraph numbering in text
  const textParaMatch = htmlFragment.match(/(?:^|\s)(\d+)\.\s*(?=[A-Z])/);
  if (textParaMatch) {
    return textParaMatch[1];
  }
  
  // Strategy 5: Look for paragraph markers in content
  const paraMarkerMatch = htmlFragment.match(/\[(\d+)\]|\¶\s*(\d+)|para(?:graph)?\s+(\d+)/i);
  if (paraMarkerMatch) {
    return paraMarkerMatch[1] || paraMarkerMatch[2] || paraMarkerMatch[3];
  }
  
  return null;
}

// Enhanced HTML stripping function with paragraph preservation
function stripHtml(html: string, preserveStructure: boolean = false): string {
  // First extract paragraph number if present
  const paraNum = extractRealParagraphNumber(html);
  
  // Preserve line breaks
  let text = html.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  
  // Remove all other tags
  text = text.replace(/<[^>]*>/g, '');
  
  // Decode HTML entities
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&rsquo;': "'",
    '&lsquo;': "'",
    '&rdquo;': '"',
    '&ldquo;': '"',
    '&ndash;': '-',
    '&mdash;': '—'
  };
  
  for (const [entity, char] of Object.entries(entities)) {
    text = text.replace(new RegExp(entity, 'g'), char);
  }
  
  // Clean up whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  
  // If paragraph number was found and structure should be preserved, prepend it
  if (preserveStructure && paraNum) {
    text = `[Para ${paraNum}] ${text}`;
  }
  
  return text.trim();
}

// Extract complete paragraphs without truncation
function extractCompleteParagraphs(
  fragments: string[], 
  maxLength: number = 2000,
  includeParaNumbers: boolean = true
): Array<{
  text: string;
  paragraphNumber: string;
  isComplete: boolean;
}> {
  const paragraphs: Array<{
    text: string;
    paragraphNumber: string;
    isComplete: boolean;
  }> = [];
  
  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i];
    const paraNum = extractRealParagraphNumber(fragment) || `${i + 1}`;
    const cleanText = stripHtml(fragment, false);
    
    // Check if text needs truncation
    if (cleanText.length <= maxLength) {
      paragraphs.push({
        text: cleanText,
        paragraphNumber: paraNum,
        isComplete: true
      });
    } else {
      // Find natural boundary for truncation
      const boundary = findSentenceBoundary(cleanText, 0, maxLength);
      paragraphs.push({
        text: cleanText.substring(0, boundary),
        paragraphNumber: paraNum,
        isComplete: boundary >= cleanText.length
      });
    }
  }
  
  return paragraphs;
}

// Enhanced paragraph detection
function extractParagraphNumber(fragment: string, index: number): string {
  // Multiple paragraph patterns
  const patterns = [
    /para(?:graph)?[\s.]*(\d+)/i,
    /¶\s*(\d+)/,
    /\[(\d+)\]/,
    /^\s*(\d+)\.\s+/m,
    /para\s*no\.?\s*(\d+)/i
  ];
  
  for (const pattern of patterns) {
    const match = fragment.match(pattern);
    if (match) return match[1];
  }
  
  // Check for section markers
  if (/^JUDGMENT/i.test(fragment)) return `J-${index + 1}`;
  if (/^ORDER/i.test(fragment)) return `O-${index + 1}`;
  
  // Default to fragment position
  return (index + 1).toString();
}

// Court identification function
function identifyCourt(doc: any): string {
  const courtStr = (
    typeof doc.doctype === 'string' ? doc.doctype : 
    doc.docsource || ''
  ).toLowerCase();
  
  // Hierarchical classification
  if (courtStr.includes('supreme') || courtStr.includes('apex')) {
    return 'supreme';
  }
  if (courtStr.includes('high court') || courtStr.includes('hc')) {
    return 'high';
  }
  if (courtStr.includes('district') || courtStr.includes('sessions')) {
    return 'district';
  }
  if (courtStr.includes('tribunal') || courtStr.includes('appellate')) {
    return 'tribunal';
  }
  if (courtStr.includes('commission')) {
    return 'commission';
  }
  
  // Check for specific high courts
  const highCourts = ['delhi', 'bombay', 'madras', 'calcutta', 'karnataka', 
                      'kerala', 'punjab', 'gujarat', 'rajasthan'];
  for (const hc of highCourts) {
    if (courtStr.includes(hc)) return 'high';
  }
  
  return 'other';
}

// Enhanced parallel citation discovery
async function findParallelCitations(
  client: IndianKanoonClient, 
  metadata: any, 
  docId: string
): Promise<string[]> {
  const citations: string[] = [];
  
  try {
    // Strategy 1: Search by exact title (first 50 chars)
    const titleSearch = await client.search(
      `"${metadata.title.substring(0, 50)}"`, 0, {}
    ).catch(() => ({ docs: [] }));
    
    // Strategy 2: Search by parties only
    const parties = extractParties(metadata.title);
    const partiesSearch = await client.search(parties, 0, {})
      .catch(() => ({ docs: [] }));
    
    // Strategy 3: Search by year and first party
    const year = metadata.publishdate?.split('-')[0];
    const firstParty = parties.split(' v.')[0];
    const yearSearch = await client.search(
      `${firstParty} ${year}`, 0, {}
    ).catch(() => ({ docs: [] }));
    
    // Collect all citations from matching documents
    const allResults = [titleSearch, partiesSearch, yearSearch];
    for (const result of allResults) {
      if (result.docs) {
        for (const doc of result.docs) {
          if (doc.tid.toString() === docId && doc.citation) {
            citations.push(doc.citation);
          }
        }
      }
    }
  } catch (error) {
    // Silently fail for parallel citations
  }
  
  return [...new Set(citations)]; // Deduplicate
}

// Citation validation function
function validateCitation(citation: string): {
  isValid: boolean;
  format?: string;
  suggestion?: string;
} {
  const cleaned = citation.trim();
  
  for (const [format, config] of Object.entries(CITATION_PATTERNS)) {
    if (config.pattern.test(cleaned)) {
      return { isValid: true, format };
    }
  }
  
  // Try to fix common issues
  const fixes = [
    { find: /\bDell\b/g, replace: 'Del' },
    { find: /\bSupreme Court\b/g, replace: 'SC' },
    { find: /\bHigh Court\b/g, replace: 'HC' }
  ];
  
  let suggested = cleaned;
  for (const fix of fixes) {
    suggested = suggested.replace(fix.find, fix.replace);
  }
  
  return { 
    isValid: false, 
    suggestion: suggested !== cleaned ? suggested : undefined 
  };
}

function calculateRelevanceScore(doc: SearchResult, courtHierarchy: Map<string, number>): number {
  let score = 1.0;
  
  const courtType = identifyCourt(doc);
  if (courtType === 'supreme') score *= 1.5;
  else if (courtType === 'high') score *= 1.2;
  else if (courtType === 'district') score *= 1.0;
  else if (courtType === 'tribunal') score *= 0.9;
  
  const year = parseInt(doc.publishdate?.split('-')[0] || '0');
  const currentYear = new Date().getFullYear();
  if (currentYear - year <= 2) score *= 1.3;
  
  if ((doc.numcitedby || 0) > 20) score *= 1.4;
  else if ((doc.numcitedby || 0) > 10) score *= 1.2;
  
  return score;
}

function extractParties(title: string): string {
  const vsPattern = /(.+?)\s+v(?:s?\.?|ersus)\s+(.+?)(?:\s+on\s+|\s*$)/i;
  const match = title.match(vsPattern);
  if (match) {
    return `${match[1].trim()} v. ${match[2].trim()}`;
  }
  return title;
}

function formatCitation(elements: CitationElements, style: string): any {
  const formatted: any = {};
  const caseNumber = extractCaseNumber(elements);
  
  switch (style) {
    case "AIR":
      formatted.full = `${elements.year} AIR ${elements.court} ${caseNumber}`;
      formatted.short = `${elements.year} AIR ${elements.court}`;
      break;
    case "SCC":
      formatted.full = `${elements.parties} (${elements.year}) SCC ${caseNumber}`;
      formatted.short = `${elements.parties.split(' v.')[0]} (${elements.year}) SCC`;
      break;
    case "Neutral":
      const courtCode = elements.court.includes('Supreme') ? 'SC' : elements.court.substring(0, 3).toUpperCase();
      formatted.full = `${elements.year} IN${courtCode} ${caseNumber}`;
      formatted.short = `${elements.year} IN${courtCode}`;
      break;
    case "SCC OnLine":
      const courtAbbr = elements.court.includes('Supreme') ? 'SC' : 
                       elements.court.includes('Delhi') ? 'Del' :
                       elements.court.includes('Bombay') ? 'Bom' :
                       elements.court.includes('Madras') ? 'Mad' :
                       elements.court.includes('Calcutta') ? 'Cal' : 'HC';
      formatted.full = `${elements.parties}, ${elements.year} SCC OnLine ${courtAbbr} ${caseNumber}`;
      formatted.short = `${elements.year} SCC OnLine ${courtAbbr}`;
      break;
    default:
      formatted.full = `${elements.parties} (${elements.year}) ${elements.court}`;
      formatted.short = `${elements.parties.split(' v.')[0]} (${elements.year})`;
  }
  
  formatted.inText = `(${elements.parties.split(' v.')[0]}, ${elements.year})`;
  formatted.footnote = `${formatted.full} (${elements.court})`;
  formatted.bibliography = `${elements.parties} (${elements.year}). ${elements.court}. ${formatted.full}.`;
  
  if (elements.paragraph) {
    formatted.pinpoint = `${formatted.full}, ¶ ${elements.paragraph}`;
  }
  
  return formatted;
}

export default function createStatelessServer({
  config,
}: {
  config: Config;
}) {
  const server = new McpServer({
    name: "IndianLegalMCP",
    version: "1.0.0",
  });

  const client = new IndianKanoonClient(config);
  const courtHierarchy = new Map([
    ['supreme', 1.5],
    ['high', 1.2],
    ['district', 1.0],
    ['tribunal', 0.9]
  ]);

  server.tool(
    "search_legal_precedents",
    "Intelligently search IndianKanoon for relevant cases with smart ranking and filtering",
    {
      query: z.string().describe("Search query for legal precedents"),
      courtLevel: z.enum(["supremecourt", "delhi", "bombay", "madras", "calcutta", "all"]).optional().describe("Filter by court level"),
      dateFrom: z.string().optional().describe("Start date in DD-MM-YYYY format"),
      dateTo: z.string().optional().describe("End date in DD-MM-YYYY format"),
      maxResults: z.number().min(1).max(100).optional().describe("Maximum results to return"),
      relevanceThreshold: z.number().min(0).max(5).optional().default(0.5).describe("Minimum relevance score to include results")
    },
    async ({ query, courtLevel, dateFrom, dateTo, maxResults, relevanceThreshold }) => {
      try {
        const limit = maxResults || config.maxSearchResults;
        
        // Preprocess the query to extract sections and normalize
        const processedQuery = preprocessQuery(query);
        
        // Use processed search variants
        const searchVariants = processedQuery.searchVariants.length > 0 
          ? processedQuery.searchVariants.slice(0, 5).map(v => ({ formInput: v, pagenum: 0 }))
          : [{ formInput: query, pagenum: 0 }];

        // Apply court-specific filtering
        const filters: any = {};
        if (courtLevel && courtLevel !== 'all') {
          const doctype = COURT_DOCTYPES[courtLevel];
          if (doctype) {
            filters.doctypes = doctype;
          }
        }
        if (dateFrom) filters.fromdate = dateFrom;
        if (dateTo) filters.todate = dateTo;

        const searchPromises = searchVariants.map(variant => 
          client.search(variant.formInput, variant.pagenum, filters)
            .catch(err => ({ docs: [], error: err.message }))
        );

        const results = await Promise.all(searchPromises);
        const allDocs: SearchResult[] = [];
        const seenIds = new Set<number>();

        for (const result of results) {
          if (result.docs && Array.isArray(result.docs)) {
            for (const doc of result.docs) {
              if (!seenIds.has(doc.tid)) {
                seenIds.add(doc.tid);
                allDocs.push(doc);
              }
            }
          }
        }

        // Check if we have any results
        if (allDocs.length === 0) {
          // Analyze why search failed and provide guidance
          const failureAnalysis = analyzeSearchFailure(query, processedQuery);
          
          return {
            content: [{ 
              type: "text", 
              text: JSON.stringify({
                cases: [],
                totalResults: 0,
                searchStatus: "NO_RESULTS",
                error: {
                  reason: failureAnalysis.reason,
                  suggestions: failureAnalysis.suggestions,
                  alternativeQueries: failureAnalysis.alternativeQueries,
                  message: "No cases found. Try the alternative queries suggested below."
                },
                searchMetadata: {
                  originalQuery: query,
                  processedQuery: processedQuery,
                  variantsSearched: searchVariants.map(v => v.formInput),
                  filtersApplied: Object.entries(filters).map(([k, v]) => `${k}: ${v}`)
                }
              }, null, 2)
            }]
          };
        }

        // Post-filter for court if specified
        let filteredDocs = allDocs;
        if (courtLevel && courtLevel !== 'all') {
          const courtMappings: Record<string, string[]> = {
            'supremecourt': ['Supreme Court', 'apex'],
            'delhi': ['Delhi High Court', 'Delhi HC'],
            'bombay': ['Bombay High Court', 'Bombay HC', 'Mumbai'],
            'madras': ['Madras High Court', 'Madras HC', 'Chennai'],
            'calcutta': ['Calcutta High Court', 'Calcutta HC', 'Kolkata']
          };
          
          const acceptedCourts = courtMappings[courtLevel] || [];
          filteredDocs = allDocs.filter(doc => {
            const docCourt = (doc.docsource || doc.doctype || '').toString();
            return acceptedCourts.some(court => 
              docCourt.toLowerCase().includes(court.toLowerCase())
            );
          });
        }

        // Calculate relevance scores with query-based scoring
        const scoredDocs = filteredDocs.map(doc => {
          const baseScore = calculateRelevanceScore(doc, courtHierarchy);
          const queryScore = calculateQueryRelevance(processedQuery, doc, baseScore);
          return {
            ...doc,
            relevanceScore: queryScore,
            matchedSections: processedQuery.extractedSections.filter(section => {
              const docText = `${doc.title} ${doc.headline || ''}`.toLowerCase();
              return docText.includes(`section ${section}`) || 
                     docText.includes(`${section} ipc`);
            }),
            matchedConcepts: processedQuery.legalConcepts.filter(concept => {
              const docText = `${doc.title} ${doc.headline || ''}`.toLowerCase();
              return docText.includes(concept);
            })
          };
        });

        // Filter by relevance threshold
        const relevantDocs = scoredDocs.filter(doc => doc.relevanceScore >= relevanceThreshold);
        
        // Sort by relevance
        relevantDocs.sort((a, b) => b.relevanceScore - a.relevanceScore);
        const topDocs = relevantDocs.slice(0, limit);

        // Check if we filtered out too many results
        if (topDocs.length === 0 && scoredDocs.length > 0) {
          // Lower threshold and take top results anyway
          const bestAvailable = scoredDocs
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, Math.min(5, limit));
            
          const formattedResults = bestAvailable.map(doc => ({
            id: doc.tid.toString(),
            title: doc.title,
            court: typeof doc.doctype === 'string' ? doc.doctype : doc.docsource || 'Unknown Court',
            year: doc.publishdate?.split('-')[0] || 'Unknown',
            relevanceScore: doc.relevanceScore.toFixed(2),
            matchedSections: doc.matchedSections || [],
            matchedConcepts: doc.matchedConcepts || [],
            summary: doc.headline ? stripHtml(doc.headline).substring(0, 4000) + '...' : 'No summary available',
            citations: doc.citation ? [doc.citation] : [],
            citedByCount: doc.numcitedby || 0,
            relevanceNote: "Below threshold but best available matches"
          }));

          return {
            content: [{ 
              type: "text", 
              text: JSON.stringify({
                cases: formattedResults,
                totalResults: bestAvailable.length,
                searchStatus: "LOW_RELEVANCE",
                note: `Results below relevance threshold of ${relevanceThreshold}. Showing best available matches.`,
                suggestions: [
                  "Try broader search terms",
                  "Remove specific case details",
                  "Search by legal principle instead of facts"
                ],
                searchMetadata: {
                  queryUsed: query,
                  extractedSections: processedQuery.extractedSections,
                  extractedConcepts: processedQuery.legalConcepts,
                  filtersApplied: Object.entries(filters).map(([k, v]) => `${k}: ${v}`)
                }
              }, null, 2)
            }]
          };
        }

        const formattedResults = topDocs.map(doc => ({
          id: doc.tid.toString(),
          title: doc.title,
          court: typeof doc.doctype === 'string' ? doc.doctype : doc.docsource || 'Unknown Court',
          year: doc.publishdate?.split('-')[0] || 'Unknown',
          relevanceScore: doc.relevanceScore.toFixed(2),
          matchedSections: doc.matchedSections || [],
          matchedConcepts: doc.matchedConcepts || [],
          summary: doc.headline ? stripHtml(doc.headline).substring(0, 4000) + '...' : 'No summary available',
          citations: doc.citation ? [doc.citation] : [],
          citedByCount: doc.numcitedby || 0,
          keyPrinciples: []
        }));

        const response = {
          cases: formattedResults,
          totalResults: topDocs.length,
          searchStatus: "SUCCESS",
          searchMetadata: {
            queryUsed: query,
            extractedSections: processedQuery.extractedSections,
            extractedConcepts: processedQuery.legalConcepts,
            searchVariantsUsed: searchVariants.map(v => v.formInput),
            filtersApplied: Object.entries(filters).map(([k, v]) => `${k}: ${v}`),
            relevanceThreshold: relevanceThreshold
          }
        };

        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
        };
      } catch (error) {
        const errorMessage = formatError(error, 'search');
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              cases: [],
              totalResults: 0,
              searchStatus: "ERROR",
              error: {
                message: errorMessage,
                suggestions: [
                  "Check your internet connection",
                  "Verify your API key is valid",
                  "Try simpler search terms",
                  "Remove special characters from query"
                ]
              }
            }, null, 2)
          }]
        };
      }
    }
  );

  server.tool(
    "extract_legal_principles",
    "Extract specific legal principles and relevant paragraphs from cases with pinpoint citations",
    {
      documentId: z.string().describe("Document ID from search results"),
      searchTerms: z.array(z.string()).describe("Legal concepts or terms to extract"),
      includeContext: z.boolean().optional().default(true).describe("Include surrounding context"),
      fullText: z.boolean().optional().default(false).describe("Extract complete paragraphs without truncation"),
      maxLength: z.number().min(500).max(5000).optional().default(2000).describe("Maximum text length per paragraph")
    },
    async ({ documentId, searchTerms, includeContext, fullText, maxLength }) => {
      try {
        const metadata = await client.getDocumentMetadata(documentId);
        
        const fragmentPromises = searchTerms.map(term =>
          client.getDocumentFragments(documentId, term)
            .catch(err => ({ headline: [], error: err.message }))
        );

        const fragmentResults = await Promise.all(fragmentPromises);
        const allFragments: string[] = [];
        
        for (const result of fragmentResults) {
          if (result.headline && Array.isArray(result.headline)) {
            allFragments.push(...result.headline);
          }
        }

        // Check if we found any fragments
        if (allFragments.length === 0) {
          return {
            content: [{ 
              type: "text", 
              text: JSON.stringify({
                principles: [],
                documentMetadata: {
                  title: metadata.title,
                  court: metadata.doctype,
                  date: metadata.publishdate
                },
                error: {
                  message: "No matching fragments found for the specified search terms",
                  suggestions: [
                    "Try broader search terms",
                    "Use single keywords instead of phrases",
                    "Check if the document contains these terms"
                  ],
                  searchTermsUsed: searchTerms
                }
              }, null, 2)
            }]
          };
        }

        // Extract complete paragraphs with real paragraph numbers
        const completeParagraphs = extractCompleteParagraphs(
          allFragments, 
          fullText ? maxLength : 1500, 
          true
        );

        // Comprehensive legal weight detection system
        const legalMarkers = {
          ratioDecidendi: [
            // Core holdings
            /we hold that/i,
            /it is settled law/i,
            /the principle is/i,
            /we are of the opinion/i,
            /the law is well[\s-]?settled/i,
            /it is trite law/i,
            /the ratio of/i,
            /therefore guilty/i,
            /conviction is confirmed/i,
            /appeal is dismissed/i,
            /petition is allowed/i,
            /we conclude that/i,
            /accordingly,?\s+we\s+hold/i,
            /the\s+legal\s+position\s+is/i,
            /it\s+is\s+no\s+longer\s+res\s+integra/i,
            /the\s+proposition\s+of\s+law/i,
            /we\s+answer\s+the\s+reference/i,
            /our\s+answer\s+to\s+the\s+question/i,
            /the\s+principle\s+that\s+emerges/i,
            /it\s+must\s+be\s+held/i,
            /we\s+have\s+no\s+hesitation/i,
            /undoubtedly/i,
            /unquestionably/i,
            /it\s+is\s+beyond\s+dispute/i,
            /there\s+can\s+be\s+no\s+doubt/i,
            /the\s+inevitable\s+conclusion/i,
            /we\s+are\s+satisfied\s+that/i,
            /accordingly\s+convicted/i,
            /sentence\s+is\s+confirmed/i,
            /acquittal\s+is\s+set\s+aside/i,
            /conviction\s+is\s+set\s+aside/i,
            /appeal\s+is\s+allowed/i,
            /writ\s+petition\s+is\s+allowed/i,
            /bail\s+is\s+granted/i,
            /bail\s+is\s+rejected/i,
            /quashing\s+is\s+allowed/i,
            /proceedings\s+are\s+quashed/i,
            /FIR\s+is\s+quashed/i,
            /charge[\s-]?sheet\s+is\s+quashed/i,
            // Constitutional bench holdings
            /speaking\s+for\s+the\s+bench/i,
            /unanimous\s+decision/i,
            /majority\s+opinion/i,
            /per\s+curiam/i
          ],
          obiterDicta: [
            /it may be noted/i,
            /incidentally/i,
            /in passing/i,
            /by the way/i,
            /parenthetically/i,
            /en\s+passant/i,
            /for\s+the\s+sake\s+of\s+completeness/i,
            /though\s+not\s+necessary/i,
            /even\s+assuming/i,
            /assuming\s+without\s+deciding/i,
            /without\s+expressing\s+any\s+opinion/i,
            /academic\s+interest/i,
            /hypothetically/i,
            /arguably/i,
            /perhaps/i,
            /it\s+appears/i,
            /it\s+seems/i,
            /one\s+may\s+argue/i,
            /for\s+what\s+it\s+is\s+worth/i,
            /tangentially/i,
            /as\s+an\s+aside/i,
            /not\s+strictly\s+necessary/i,
            /abundance\s+of\s+caution/i,
            /without\s+going\s+into/i,
            /need\s+not\s+be\s+decided/i,
            /left\s+open/i,
            /not\s+called\s+upon/i,
            /beyond\s+the\s+scope/i
          ],
          distinguishing: [
            /however in the present case/i,
            /facts are different/i,
            /not applicable here/i,
            /distinguishable from/i,
            /can be distinguished/i,
            /materially\s+different/i,
            /factually\s+distinct/i,
            /on\s+facts/i,
            /peculiar\s+facts/i,
            /special\s+circumstances/i,
            /unlike\s+in/i,
            /contrary\s+to/i,
            /as\s+opposed\s+to/i,
            /in\s+contrast/i,
            /dissimilar/i,
            /inapposite/i,
            /has\s+no\s+application/i,
            /cannot\s+be\s+applied/i,
            /different\s+context/i,
            /not\s+on\s+all\s+fours/i,
            /stands\s+on\s+different\s+footing/i,
            /different\s+considerations/i,
            /exceptional\s+case/i,
            /sui\s+generis/i
          ],
          following: [
            /following the decision/i,
            /relying on/i,
            /as held in/i,
            /applying the principle/i,
            /in\s+line\s+with/i,
            /consistent\s+with/i,
            /as\s+observed\s+in/i,
            /as\s+laid\s+down/i,
            /reiterating/i,
            /reaffirming/i,
            /endorsing\s+the\s+view/i,
            /adopting\s+the\s+reasoning/i,
            /squarely\s+covered/i,
            /directly\s+applicable/i,
            /on\s+all\s+fours/i,
            /binding\s+precedent/i,
            /authoritative\s+pronouncement/i,
            /ratio\s+applies/i,
            /principle\s+enunciated/i,
            /dictum\s+in/i
          ],
          overruling: [
            /overruled/i,
            /no\s+longer\s+good\s+law/i,
            /cannot\s+be\s+sustained/i,
            /per\s+incuriam/i,
            /wrongly\s+decided/i,
            /erroneous\s+view/i,
            /departed\s+from/i,
            /not\s+approved/i,
            /doubted/i,
            /reconsidered/i,
            /contrary\s+to\s+law/i,
            /unsustainable/i,
            /bad\s+in\s+law/i,
            /set\s+aside\s+the\s+judgment/i,
            /reversed/i,
            /cannot\s+be\s+accepted/i,
            /rejected\s+the\s+contention/i,
            /disapproved/i
          ],
          proceduralDirections: [
            /directed\s+to/i,
            /it\s+is\s+ordered/i,
            /registry\s+is\s+directed/i,
            /shall\s+comply/i,
            /immediate\s+effect/i,
            /with\s+immediate\s+effect/i,
            /forthwith/i,
            /expeditiously/i,
            /within\s+\d+\s+weeks/i,
            /time\s+bound/i,
            /liberty\s+to\s+apply/i,
            /list\s+the\s+matter/i,
            /remanded\s+to/i,
            /sent\s+back/i,
            /fresh\s+consideration/i,
            /de\s+novo/i,
            /status\s+quo/i,
            /interim\s+order/i,
            /till\s+further\s+orders/i,
            /stayed/i
          ],
          concessionsAdmissions: [
            /fairly\s+conceded/i,
            /admitted\s+that/i,
            /not\s+disputed/i,
            /not\s+in\s+controversy/i,
            /common\s+ground/i,
            /undisputed\s+fact/i,
            /accepted\s+position/i,
            /admittedly/i,
            /confessedly/i,
            /no\s+quarrel/i,
            /rightly\s+conceded/i,
            /candidly\s+admitted/i,
            /on\s+admission/i,
            /learned\s+counsel\s+agrees/i,
            /not\s+pressed/i,
            /given\s+up/i,
            /abandoned/i,
            /withdrawn/i
          ],
          judicialDisagreement: [
            /with\s+respect/i,
            /with\s+due\s+respect/i,
            /respectfully\s+disagree/i,
            /unable\s+to\s+agree/i,
            /different\s+view/i,
            /minority\s+view/i,
            /dissenting\s+opinion/i,
            /contra\s+view/i,
            /alternative\s+view/i,
            /however\s+i\s+would/i,
            /in\s+my\s+opinion/i,
            /divergent\s+views/i,
            /conflict\s+of\s+opinion/i,
            /referring\s+to\s+larger\s+bench/i,
            /reference\s+is\s+made/i,
            /requires\s+reconsideration/i,
            /doubt\s+is\s+expressed/i
          ],
          statutoryInterpretation: [
            /plain\s+meaning/i,
            /literal\s+interpretation/i,
            /legislative\s+intent/i,
            /object\s+and\s+purpose/i,
            /mischief\s+rule/i,
            /golden\s+rule/i,
            /harmonious\s+construction/i,
            /purposive\s+interpretation/i,
            /strict\s+construction/i,
            /liberal\s+construction/i,
            /ejusdem\s+generis/i,
            /noscitur\s+a\s+sociis/i,
            /expressio\s+unius/i,
            /reading\s+down/i,
            /reading\s+into/i,
            /casus\s+omissus/i,
            /statutory\s+scheme/i,
            /contextual\s+interpretation/i,
            /beneficial\s+construction/i,
            /penal\s+statute/i
          ],
          evidenceEvaluation: [
            /cogent\s+evidence/i,
            /credible\s+witness/i,
            /unreliable\s+testimony/i,
            /contradictions\s+in\s+evidence/i,
            /material\s+improvement/i,
            /embellishment/i,
            /tutored\s+witness/i,
            /interested\s+witness/i,
            /independent\s+witness/i,
            /corroboration/i,
            /circumstantial\s+evidence/i,
            /chain\s+of\s+circumstances/i,
            /preponderance\s+of\s+probability/i,
            /beyond\s+reasonable\s+doubt/i,
            /benefit\s+of\s+doubt/i,
            /hostile\s+witness/i,
            /dying\s+declaration/i,
            /res\s+gestae/i,
            /admission\s+against\s+interest/i,
            /burden\s+of\s+proof/i,
            /onus\s+shifts/i,
            /presumption/i,
            /rebuttal/i
          ]
        };

        const principles = completeParagraphs.map((para, index) => {
          // Comprehensive legal weight determination
          let legalWeight = "Supporting Observation";
          let confidence = 0.5;
          let weightDetails: string[] = [];
          
          // Check each category and accumulate matches
          for (const [category, patterns] of Object.entries(legalMarkers)) {
            const matches = patterns.filter(pattern => pattern.test(para.text));
            if (matches.length > 0) {
              weightDetails.push(`${category}(${matches.length})`);
              
              // Priority-based weight assignment
              switch (category) {
                case 'ratioDecidendi':
                  legalWeight = "Ratio Decidendi";
                  confidence = Math.min(0.9 + (matches.length * 0.02), 1.0);
                  break;
                case 'overruling':
                  if (legalWeight !== "Ratio Decidendi") {
                    legalWeight = "Overruling Precedent";
                    confidence = 0.85;
                  }
                  break;
                case 'statutoryInterpretation':
                  if (!['Ratio Decidendi', 'Overruling Precedent'].includes(legalWeight)) {
                    legalWeight = "Statutory Interpretation";
                    confidence = 0.8;
                  }
                  break;
                case 'evidenceEvaluation':
                  if (!['Ratio Decidendi', 'Overruling Precedent', 'Statutory Interpretation'].includes(legalWeight)) {
                    legalWeight = "Evidence Analysis";
                    confidence = 0.75;
                  }
                  break;
                case 'following':
                  if (legalWeight === "Supporting Observation") {
                    legalWeight = "Following Precedent";
                    confidence = 0.8;
                  }
                  break;
                case 'distinguishing':
                  if (legalWeight === "Supporting Observation") {
                    legalWeight = "Distinguishing";
                    confidence = 0.7;
                  }
                  break;
                case 'proceduralDirections':
                  if (legalWeight === "Supporting Observation") {
                    legalWeight = "Procedural Direction";
                    confidence = 0.65;
                  }
                  break;
                case 'concessionsAdmissions':
                  if (legalWeight === "Supporting Observation") {
                    legalWeight = "Concession/Admission";
                    confidence = 0.7;
                  }
                  break;
                case 'judicialDisagreement':
                  if (legalWeight === "Supporting Observation") {
                    legalWeight = "Judicial Disagreement";
                    confidence = 0.6;
                  }
                  break;
                case 'obiterDicta':
                  if (legalWeight === "Supporting Observation") {
                    legalWeight = "Obiter Dicta";
                    confidence = 0.55;
                  }
                  break;
              }
            }
          }
          
          // Get context if requested
          let context = { before: '', after: '' };
          if (includeContext) {
            if (index > 0) {
              const prevPara = completeParagraphs[index - 1];
              context.before = prevPara.text.substring(0, 200) + 
                              (prevPara.text.length > 200 ? '...' : '');
            }
            if (index < completeParagraphs.length - 1) {
              const nextPara = completeParagraphs[index + 1];
              context.after = nextPara.text.substring(0, 200) + 
                             (nextPara.text.length > 200 ? '...' : '');
            }
          }

          const caseNumber = extractCaseNumber(metadata);
          const parties = extractParties(metadata.title);

          return {
            text: para.text,
            paragraphNumber: para.paragraphNumber,
            isComplete: para.isComplete,
            context: includeContext ? context : undefined,
            citation: {
              full: `${parties}, ${metadata.publishdate?.split('-')[0] || ''}, para ${para.paragraphNumber}`,
              short: `${parties.split(' v.')[0]}, para ${para.paragraphNumber}`,
              pinpoint: `at para ${para.paragraphNumber}`,
              neutral: metadata.tid ? `[Doc ID: ${metadata.tid}], para ${para.paragraphNumber}` : undefined
            },
            legalWeight: legalWeight,
            weightDetails: weightDetails.length > 0 ? weightDetails : undefined,
            confidence: confidence,
            searchTermMatches: searchTerms.filter(term => 
              para.text.toLowerCase().includes(term.toLowerCase())
            )
          };
        });

        // Sort by relevance (confidence and completeness)
        principles.sort((a, b) => {
          const scoreA = a.confidence * (a.isComplete ? 1.2 : 1) * 
                         (a.searchTermMatches.length / searchTerms.length);
          const scoreB = b.confidence * (b.isComplete ? 1.2 : 1) * 
                         (b.searchTermMatches.length / searchTerms.length);
          return scoreB - scoreA;
        });

        const response = {
          principles: principles.slice(0, fullText ? 20 : 10),
          documentMetadata: {
            title: metadata.title,
            court: metadata.doctype || metadata.docsource,
            date: metadata.publishdate,
            documentId: metadata.tid,
            totalFragments: allFragments.length,
            extractionConfidence: 0.85
          },
          extractionMetadata: {
            searchTermsUsed: searchTerms,
            fragmentsFound: allFragments.length,
            paragraphsExtracted: principles.length,
            fullTextMode: fullText,
            maxLengthUsed: fullText ? maxLength : 1500
          }
        };

        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
        };
      } catch (error) {
        const errorMessage = formatError(error, 'extraction');
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              principles: [],
              error: {
                message: errorMessage,
                documentId: documentId,
                searchTerms: searchTerms,
                suggestions: [
                  "Verify the document ID is correct",
                  "Try different search terms",
                  "Check if the document is accessible"
                ]
              }
            }, null, 2)
          }]
        };
      }
    }
  );

  server.tool(
    "build_case_compilation",
    "Automatically compile comprehensive legal research memos with organized cases and citations",
    {
      legalIssue: z.string().describe("Primary legal issue to research"),
      subIssues: z.array(z.string()).optional().describe("Sub-issues to cover"),
      jurisdiction: z.enum(["supremecourt", "delhi", "bombay", "madras", "calcutta", "all"]).optional().default("all").describe("Preferred jurisdiction"),
      maxCases: z.number().min(5).max(50).optional().default(15).describe("Maximum cases to include"),
      analysisDepth: z.enum(["quick", "standard", "comprehensive"]).optional().default("standard").describe("Depth of analysis"),
      includeStrategy: z.boolean().optional().default(true).describe("Include strategic recommendations")
    },
    async ({ legalIssue, subIssues, jurisdiction, maxCases, analysisDepth, includeStrategy }) => {
      try {
        // Enhanced search query generation based on API testing
        const generateSmartQueries = (issue: string, subs: string[] = []) => {
          const queries: string[] = [];
          
          // Parse the main issue for key legal concepts
          const sectionPattern = /Section[s]?\s+(\d+[A-Z]?(?:\s*,\s*\d+[A-Z]?)*)/gi;
          const sections = issue.match(sectionPattern);
          
          if (sections) {
            // Extract section numbers
            const sectionNumbers = sections[0].replace(/Section[s]?\s+/i, '').split(/\s*,\s*/);
            
            // Generate targeted queries for each section
            sectionNumbers.forEach(sec => {
              // Look for specific legal scenarios
              if (issue.toLowerCase().includes('bail')) {
                queries.push(`"Section ${sec}" ANDD "bail granted"`);
                queries.push(`"Section ${sec}" ANDD "bail" ANDD "Arnesh Kumar"`);
              }
              if (issue.toLowerCase().includes('quashing')) {
                queries.push(`"Section ${sec}" ANDD quashing ANDD "no prima facie"`);
                queries.push(`"Section ${sec}" ANDD "482 CrPC"`);
              }
              if (issue.toLowerCase().includes('compromise')) {
                queries.push(`"Section ${sec}" ANDD "Section 320 CrPC"`);
                queries.push(`"Section ${sec}" ANDD compromise ANDD "Gian Singh"`);
              }
              if (issue.toLowerCase().includes('common intention')) {
                queries.push(`"Section 34" ANDD "common intention" ANDD "${sec}"`);
                queries.push(`"Section 34" ANDD "no prior meeting"`);
              }
            });
          }
          
          // Add sub-issue specific queries
          if (subs && subs.length > 0) {
            subs.forEach(subIssue => {
              if (subIssue.toLowerCase().includes('specific injury')) {
                queries.push(`"no specific overt act" ANDD "Section 323"`);
                queries.push(`"specific injury" NOTT attributed`);
              }
              if (subIssue.toLowerCase().includes('medical evidence')) {
                queries.push(`"medical evidence" ANDD contradicts ANDD FIR`);
                queries.push(`"medical report" ANDD "no injury"`);
              }
              if (subIssue.toLowerCase().includes('vague allegations')) {
                queries.push(`"vague allegations" ANDD quashing`);
                queries.push(`"omnibus allegations" ANDD "no material"`);
              }
              if (subIssue.toLowerCase().includes('compromise')) {
                queries.push(`"compromise petition" ANDD "Section 320"`);
                queries.push(`"victim affidavit" ANDD quashing`);
              }
            });
          }
          
          // Add special act specific queries
          if (issue.toLowerCase().includes('pmla')) {
            queries.push(`"PMLA" ANDD "proceeds of crime"`);
            queries.push(`"money laundering" ANDD bail`);
            queries.push(`"Vijay Madanlal Choudhary" ANDD PMLA`); // Leading PMLA case
            queries.push(`"Section 45 PMLA" ANDD bail`);
          }
          
          if (issue.toLowerCase().includes('pocso')) {
            queries.push(`"POCSO Act" ANDD bail`);
            queries.push(`"minor victim" ANDD "sexual offense"`);
            queries.push(`"Section 29 POCSO" ANDD presumption`);
            queries.push(`"Alakh Alok Srivastava" ANDD POCSO`); // Leading POCSO case
          }
          
          if (issue.toLowerCase().includes('ndps')) {
            queries.push(`"NDPS Act" ANDD "Section 37"`);
            queries.push(`"narcotic" ANDD "commercial quantity"`);
            queries.push(`"Tofan Singh" ANDD NDPS`); // Leading NDPS case
            queries.push(`"conscious possession" ANDD drugs`);
          }
          
          if (issue.toLowerCase().includes('tada') || issue.toLowerCase().includes('uapa')) {
            queries.push(`"terrorist act" ANDD bail`);
            queries.push(`"UAPA" ANDD "Section 43D"`);
            queries.push(`"Watali" ANDD UAPA ANDD bail`); // Leading UAPA bail case
          }
          
          // Add landmark case searches
          const landmarkCases = [
            '"Arnesh Kumar" ANDD arrest ANDD guidelines',
            '"Gian Singh" ANDD compromise ANDD quashing',
            '"Bhajan Lal" ANDD 482 ANDD guidelines',
            '"Nikesh Shah" ANDD PMLA ANDD bail',
            '"Satender Kumar Antil" ANDD bail ANDD undertrial'
          ];
          
          // Filter relevant landmark cases based on issue
          if (issue.toLowerCase().includes('arrest') || issue.toLowerCase().includes('bail')) {
            queries.push(landmarkCases[0]);
            queries.push(landmarkCases[4]); // Satender Kumar Antil for bail
          }
          if (issue.toLowerCase().includes('compromise')) {
            queries.push(landmarkCases[1]);
          }
          if (issue.toLowerCase().includes('quashing')) {
            queries.push(landmarkCases[2]);
          }
          if (issue.toLowerCase().includes('pmla')) {
            queries.push(landmarkCases[3]); // Nikesh Shah for PMLA
          }
          
          // Add the original issue as a fallback
          queries.push(issue);
          
          return queries;
        };

        const searchQueries = generateSmartQueries(legalIssue, subIssues);
        
        // Execute searches with better error handling
        const searchPromises = searchQueries.map(async (query) => {
          try {
            const result = await client.search(query, 0, {});
            return result;
          } catch (err) {
            console.error(`Search failed for query: ${query}`, err);
            return { docs: [], error: err };
          }
        });

        const searchResults = await Promise.all(searchPromises);
        
        // Enhanced deduplication and relevance scoring
        const caseMap = new Map<number, any>();
        const relevanceTracking = new Map<number, number>();
        
        for (const result of searchResults) {
          if (result.docs && Array.isArray(result.docs)) {
            for (const doc of result.docs.slice(0, 10)) {
              if (!caseMap.has(doc.tid)) {
                caseMap.set(doc.tid, doc);
                relevanceTracking.set(doc.tid, 1);
              } else {
                // Increase relevance for cases appearing in multiple searches
                relevanceTracking.set(doc.tid, (relevanceTracking.get(doc.tid) || 0) + 1);
              }
            }
          }
        }
        
        // Context-aware filtering based on the legal issue
        const getIrrelevantIndicators = (issue: string, subs: string[] = []) => {
          const issueText = `${issue} ${subs.join(' ')}`.toLowerCase();
          
          // Default exclusions for general IPC cases
          let exclusions = [];
          
          // Only exclude special acts if they're NOT part of the query
          if (!issueText.includes('tada') && !issueText.includes('terrorist')) {
            exclusions.push('TADA', 'POTA', 'terrorism');
          }
          if (!issueText.includes('pmla') && !issueText.includes('money laundering') && !issueText.includes('proceeds')) {
            exclusions.push('PMLA', 'money laundering', 'proceeds of crime');
          }
          if (!issueText.includes('ndps') && !issueText.includes('narcotic') && !issueText.includes('drug')) {
            exclusions.push('NDPS', 'narcotics', 'psychotropic');
          }
          if (!issueText.includes('pocso') && !issueText.includes('child') && !issueText.includes('minor')) {
            exclusions.push('POCSO', 'minor victim');
          }
          
          // For simple hurt cases (323/324/326), exclude serious crimes unless specifically mentioned
          if ((issueText.includes('323') || issueText.includes('324') || issueText.includes('326')) && 
              !issueText.includes('murder') && !issueText.includes('302')) {
            exclusions.push('murder', 'homicide');
          }
          
          // For property/economic offenses, don't exclude PMLA
          if (issueText.includes('420') || issueText.includes('cheating') || issueText.includes('fraud')) {
            // Remove PMLA from exclusions if it was added
            exclusions = exclusions.filter(e => !['PMLA', 'money laundering'].includes(e));
          }
          
          // For sexual offense cases, don't exclude POCSO
          if (issueText.includes('376') || issueText.includes('354') || issueText.includes('sexual')) {
            exclusions = exclusions.filter(e => e !== 'POCSO');
          }
          
          return exclusions;
        };
        
        const irrelevantIndicators = getIrrelevantIndicators(legalIssue, subIssues);
        
        const filteredCases = Array.from(caseMap.values()).filter(doc => {
          // If no exclusions needed, include all
          if (irrelevantIndicators.length === 0) return true;
          
          const text = `${doc.title} ${doc.headline || ''}`.toLowerCase();
          return !irrelevantIndicators.some(indicator => text.toLowerCase().includes(indicator.toLowerCase()));
        });
        
        // Enhanced scoring with multi-query relevance
        const scoredCases = filteredCases.map(doc => {
          const baseScore = calculateRelevanceScore(doc, courtHierarchy);
          const queryHits = relevanceTracking.get(doc.tid) || 1;
          const enhancedScore = baseScore * (1 + (queryHits - 1) * 0.2); // Boost for multiple hits
          
          return {
            ...doc,
            relevanceScore: enhancedScore,
            courtType: identifyCourt(doc),
            queryHits: queryHits
          };
        });

        scoredCases.sort((a, b) => b.relevanceScore - a.relevanceScore);
        const topCases = scoredCases.slice(0, maxCases);

        // Categorize cases more intelligently
        const supremeCourtCases = topCases.filter(c => c.courtType === 'supreme');
        const highCourtCases = topCases.filter(c => c.courtType === 'high');
        const tribunalCases = topCases.filter(c => c.courtType === 'tribunal');
        const otherCases = topCases.filter(c => 
          !['supreme', 'high', 'tribunal'].includes(c.courtType)
        );

        // Sub-issue analysis if provided
        let subIssueAnalysis = '';
        if (subIssues && subIssues.length > 0 && analysisDepth !== 'quick') {
          subIssueAnalysis = '\n## Issue-Specific Analysis\n\n';
          
          for (const subIssue of subIssues) {
            const relevantCases = topCases.filter(c => {
              const text = `${c.title} ${c.headline || ''}`.toLowerCase();
              const subIssueLower = subIssue.toLowerCase();
              
              // Match sub-issue keywords
              const keywords = subIssueLower.split(/\s+/).filter(w => w.length > 3);
              const matchCount = keywords.filter(kw => text.includes(kw)).length;
              return matchCount >= Math.min(2, keywords.length);
            });
            
            if (relevantCases.length > 0) {
              subIssueAnalysis += `### ${subIssue}\n\n`;
              subIssueAnalysis += `**Leading Cases**: ${relevantCases.length} relevant precedents found\n\n`;
              
              // Get the most relevant case for this sub-issue
              const topCase = relevantCases[0];
              if (topCase.headline) {
                const cleanSummary = stripHtml(topCase.headline).substring(0, 4000);
                subIssueAnalysis += `**Key Precedent**: ${extractParties(topCase.title)} (${topCase.publishdate?.split('-')[0]})\n`;
                subIssueAnalysis += `> "${cleanSummary}..."\n\n`;
              }
            }
          }
        }

        // Strategic recommendations if requested
        let strategySection = '';
        if (includeStrategy) {
          strategySection = `
## Strategic Recommendations

### For Bail Applications
${supremeCourtCases.length > 0 ? `- Rely on Supreme Court precedents for binding authority` : ''}
${topCases.some(c => c.headline?.toLowerCase().includes('bail granted')) ? 
  `- Emphasize cases where bail was granted in similar circumstances` : 
  `- Focus on distinguishing unfavorable precedents`}
- Consider citing Arnesh Kumar guidelines if applicable to the sections involved

### For Quashing Petitions
${topCases.some(c => c.headline?.toLowerCase().includes('quashing allowed')) ?
  `- Strong precedents available for quashing in similar cases` :
  `- Limited direct precedents; focus on procedural irregularities`}
${subIssues?.some(s => s.toLowerCase().includes('compromise')) ?
  `- Compromise route available under Gian Singh principles` : ''}

### Key Arguments to Advance
1. **Strongest Ground**: Based on precedent analysis, focus on ${
  subIssues && subIssues.length > 0 ? subIssues[0] : 'lack of prima facie case'
}
2. **Supporting Arguments**: Develop arguments around procedural lapses and evidentiary gaps
3. **Defensive Position**: Be prepared to distinguish unfavorable precedents

### Risk Assessment
- **Success Probability**: ${supremeCourtCases.length > 3 ? 'High' : highCourtCases.length > 5 ? 'Moderate' : 'Low-Moderate'}
- **Critical Factor**: ${topCases[0] ? `Follow the ratio in ${extractParties(topCases[0].title)}` : 'Establish clear factual distinctions'}
`;
        }

        // Enhanced case entry formatting
        const formatDetailedCaseEntry = (c: any, index: number) => {
          const title = extractParties(c.title);
          const court = typeof c.doctype === 'string' ? c.doctype : c.docsource || 'Unknown Court';
          const year = c.publishdate?.split('-')[0] || '';
          const citation = c.citation || `${year} ${court}`;
          const summary = c.headline ? stripHtml(c.headline).substring(0, 4000) : 'No summary available';
          
          let entry = `**${index + 1}. ${title}**\n`;
          entry += `   *Citation*: ${citation}\n`;
          entry += `   *Court*: ${court}\n`;
          entry += `   *Date*: ${c.publishdate || 'Unknown'}\n`;
          if (c.queryHits > 1) {
            entry += `   *Relevance*: High (matched ${c.queryHits} search criteria)\n`;
          }
          entry += `   *Key Point*: ${summary}...\n`;
          
          return entry;
        };

        // Generate comprehensive memo
        const memo = `# Legal Research Memo: ${legalIssue}

## Executive Summary
- **Primary Legal Question**: ${legalIssue}
${subIssues && subIssues.length > 0 ? `- **Sub-Issues**: ${subIssues.length} specific issues analyzed` : ''}
- **Jurisdiction**: ${jurisdiction === 'all' ? 'Pan-India' : jurisdiction}
- **Cases Analyzed**: ${topCases.length} (from ${caseMap.size} unique cases found)
- **Search Queries Used**: ${searchQueries.length} targeted searches
- **Analysis Depth**: ${analysisDepth}

## Quick Reference Statistics
| Court Level | Cases Found | Most Recent |
|------------|-------------|-------------|
| Supreme Court | ${supremeCourtCases.length} | ${supremeCourtCases[0]?.publishdate?.split('-')[0] || 'N/A'} |
| High Courts | ${highCourtCases.length} | ${highCourtCases[0]?.publishdate?.split('-')[0] || 'N/A'} |
| Other Courts | ${otherCases.length + tribunalCases.length} | ${(otherCases[0] || tribunalCases[0])?.publishdate?.split('-')[0] || 'N/A'} |

## Table of Authorities

### Supreme Court of India (${supremeCourtCases.length})
${supremeCourtCases.map((c, i) => 
  `${i + 1}. **${extractParties(c.title)}** - ${c.publishdate?.split('-')[0] || ''} ${c.citation ? `[${c.citation}]` : ''}`
).join('\n') || 'No Supreme Court cases found for this query'}

### High Courts (${highCourtCases.length})
${highCourtCases.map((c, i) => 
  `${i + 1}. **${extractParties(c.title)}** - ${c.publishdate?.split('-')[0] || ''} (${c.docsource || c.doctype})`
).join('\n') || 'No High Court cases found for this query'}

${tribunalCases.length > 0 ? `### Tribunals (${tribunalCases.length})
${tribunalCases.map((c, i) => 
  `${i + 1}. ${extractParties(c.title)} - ${c.publishdate?.split('-')[0] || ''}`
).join('\n')}` : ''}

${subIssueAnalysis}

## Detailed Case Analysis

### Binding Precedents (Supreme Court)
${supremeCourtCases.length > 0 ? 
  supremeCourtCases.slice(0, analysisDepth === 'quick' ? 2 : analysisDepth === 'comprehensive' ? 5 : 3)
    .map((c, i) => formatDetailedCaseEntry(c, i)).join('\n') :
  '*No Supreme Court precedents found. Consider High Court decisions as persuasive authority.*\n'}

### Persuasive Authorities (High Courts)
${highCourtCases.length > 0 ?
  highCourtCases.slice(0, analysisDepth === 'quick' ? 2 : analysisDepth === 'comprehensive' ? 5 : 3)
    .map((c, i) => formatDetailedCaseEntry(c, i)).join('\n') :
  '*No High Court precedents found. Review may need broader search parameters.*\n'}

### Recent Developments (Last 2 Years)
${(() => {
  const recentCases = topCases.filter(c => {
    const year = parseInt(c.publishdate?.split('-')[0] || '0');
    return new Date().getFullYear() - year <= 2;
  });
  
  if (recentCases.length > 0) {
    return recentCases.slice(0, 2).map((c, i) => formatDetailedCaseEntry(c, i)).join('\n');
  }
  return '*No recent cases in the last 2 years. The legal position appears settled.*\n';
})()}

${strategySection}

## Conclusion

Based on the analysis of ${topCases.length} cases across ${searchQueries.length} targeted searches:

1. **Legal Position**: The jurisprudence on "${legalIssue}" ${supremeCourtCases.length > 0 ? 'is well-established by Supreme Court precedents' : highCourtCases.length > 3 ? 'has consistent High Court interpretation' : 'requires careful case-by-case analysis'}.

2. **Key Takeaway**: ${topCases.length > 0 && topCases[0].headline ? 
  `The principle emerging from ${extractParties(topCases[0].title)} provides the clearest guidance.` :
  'Further research with modified search parameters may be needed.'}

3. **Practical Application**: ${includeStrategy ? 'See strategic recommendations above for litigation strategy.' : 'Consider the precedents in order of hierarchical authority.'}

## Research Methodology Note
- **Searches Performed**: ${searchQueries.length} different query combinations
- **Cases Reviewed**: ${caseMap.size} unique cases identified
- **Relevance Filtering**: Applied to exclude ${caseMap.size - filteredCases.length} irrelevant results
- **Ranking Method**: Multi-factor scoring including court hierarchy, recency, citations, and query matches

---
*Research compiled on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}*
*Generated by IndianLegalMCP v1.0.0*`;

        return {
          content: [{ type: "text", text: memo }]
        };
      } catch (error) {
        return {
          content: [{ 
            type: "text", 
            text: `Error in case compilation: ${error instanceof Error ? error.message : 'Unknown error'}\n\nTroubleshooting suggestions:\n1. Verify your IndianKanoon API key is valid\n2. Try with simpler search terms\n3. Check your internet connection\n4. Reduce the number of sub-issues` 
          }]
        };
      }
    }
  );

  server.tool(
    "format_citations",
    "Generate properly formatted legal citations in various Indian citation styles",
    {
      documentId: z.string().describe("Document ID to format citation for"),
      citationStyle: z.enum(["AIR", "SCC", "Neutral", "SCC OnLine"]).optional().describe("Citation style to use"),
      includePinpoint: z.boolean().optional().default(false).describe("Include paragraph reference"),
      paragraph: z.string().optional().describe("Paragraph number for pinpoint citation")
    },
    async ({ documentId, citationStyle, includePinpoint, paragraph }) => {
      try {
        const metadata = await client.getDocumentMetadata(documentId);
        const style = citationStyle || config.citationStyle;

        const elements: CitationElements = {
          parties: extractParties(metadata.title),
          court: metadata.doctype || 'Unknown Court',
          year: metadata.publishdate?.split('-')[0] || '',
          caseNumber: extractCaseNumber(metadata),
          paragraph: includePinpoint ? paragraph : undefined
        };

        const formatted = formatCitation(elements, style);

        // Enhanced parallel citation discovery
        const parallelCitations = await findParallelCitations(client, metadata, documentId);

        const response = {
          primary: {
            style: style,
            citation: formatted.full,
            confidence: 0.95
          },
          parallel: parallelCitations.map(c => ({
            citation: c,
            confidence: 0.80
          })),
          formatted: formatted,
          metadata: {
            documentId: documentId,
            title: metadata.title,
            court: metadata.doctype,
            date: metadata.publishdate
          }
        };

        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : 'Citation formatting failed' }]
        };
      }
    }
  );

  server.tool(
    "verify_citations",
    "Validate citation accuracy and find missing information",
    {
      citations: z.array(z.string()).describe("List of citations to verify"),
      suggestCorrections: z.boolean().optional().default(true).describe("Provide correction suggestions")
    },
    async ({ citations, suggestCorrections }) => {
      try {
        const verificationPromises = citations.map(async (citation) => {
          // First validate the format
          const validation = validateCitation(citation);
          
          // Use cite: parameter for citation search
          const searchResult = await client.search(`cite:"${citation}"`, 0, {})
            .catch(() => ({ docs: [], found: "0" }));

          const isValid = searchResult.docs && searchResult.docs.length > 0;
          let suggestions: any[] = [];

          if (!isValid && suggestCorrections) {
            // Add format validation suggestion
            if (validation.suggestion) {
              suggestions.push({
                corrected: validation.suggestion,
                confidence: 0.9,
                reason: "Format correction"
              });
            }

            const cleanedCitation = citation.replace(/[^\w\s\d]/g, ' ');
            const altSearch = await client.search(cleanedCitation, 0, {})
              .catch(() => ({ docs: [] }));

            if (altSearch.docs && altSearch.docs.length > 0) {
              suggestions.push(...altSearch.docs.slice(0, 3).map(doc => ({
                corrected: doc.citation || `${doc.publishdate?.split('-')[0]} ${doc.doctype}`,
                confidence: 0.7,
                reason: "Similar case found",
                documentId: doc.tid.toString()
              })));
            }

            // Expanded typo patterns
            const typoPatterns = [
              { pattern: /Dell/g, replacement: 'Del', reason: 'Common typo in court abbreviation' },
              { pattern: /Bomaby/g, replacement: 'Bombay', reason: 'Spelling correction' },
              { pattern: /Supeme/g, replacement: 'Supreme', reason: 'Spelling correction' },
              { pattern: /Calcuta/g, replacement: 'Calcutta', reason: 'Spelling correction' },
              { pattern: /Madrs/g, replacement: 'Madras', reason: 'Spelling correction' }
            ];

            for (const { pattern, replacement, reason } of typoPatterns) {
              if (pattern.test(citation)) {
                suggestions.push({
                  corrected: citation.replace(pattern, replacement),
                  confidence: 0.9,
                  reason: reason
                });
              }
            }
          }

          return {
            citation: citation,
            status: isValid ? "VALID" : "INVALID",
            confidence: isValid ? 1.0 : 0.0,
            formatValid: validation.isValid,
            formatType: validation.format,
            documentFound: isValid && searchResult.docs ? {
              id: searchResult.docs[0].tid.toString(),
              title: searchResult.docs[0].title,
              exactMatch: true
            } : null,
            errors: !isValid ? [
              "Citation not found in database",
              !validation.isValid ? "Invalid citation format" : null
            ].filter(Boolean) : [],
            suggestions: suggestions
          };
        });

        const results = await Promise.all(verificationPromises);
        const validCount = results.filter(r => r.status === "VALID").length;
        const invalidCount = results.filter(r => r.status === "INVALID").length;
        const correctableCount = results.filter(r => r.suggestions.length > 0).length;

        const response = {
          validationResults: results,
          summary: {
            totalChecked: citations.length,
            valid: validCount,
            invalid: invalidCount,
            correctable: correctableCount,
            formatIssues: results.filter(r => !r.formatValid).length
          }
        };

        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : 'Verification failed' }]
        };
      }
    }
  );

  return server.server;
}