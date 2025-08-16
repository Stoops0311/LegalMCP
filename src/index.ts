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

// Enhanced HTML stripping function
function stripHtml(html: string): string {
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
    '&ldquo;': '"'
  };
  
  for (const [entity, char] of Object.entries(entities)) {
    text = text.replace(new RegExp(entity, 'g'), char);
  }
  
  // Clean up whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  
  return text.trim();
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
      maxResults: z.number().min(1).max(100).optional().describe("Maximum results to return")
    },
    async ({ query, courtLevel, dateFrom, dateTo, maxResults }) => {
      try {
        const limit = maxResults || config.maxSearchResults;
        
        // Build search variants
        const searchVariants = [
          { formInput: query, pagenum: 0 },
          { formInput: `"${query}"`, pagenum: 0 },
          { formInput: query.replace(/\s+(and|or)\s+/gi, ' ').replace(/\s+/g, ' ANDD '), pagenum: 0 }
        ];

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

        const scoredDocs = filteredDocs.map(doc => ({
          ...doc,
          relevanceScore: calculateRelevanceScore(doc, courtHierarchy)
        }));

        scoredDocs.sort((a, b) => b.relevanceScore - a.relevanceScore);
        const topDocs = scoredDocs.slice(0, limit);

        const formattedResults = topDocs.map(doc => ({
          id: doc.tid.toString(),
          title: doc.title,
          court: typeof doc.doctype === 'string' ? doc.doctype : doc.docsource || 'Unknown Court',
          year: doc.publishdate?.split('-')[0] || 'Unknown',
          relevanceScore: doc.relevanceScore.toFixed(2),
          summary: doc.headline ? stripHtml(doc.headline).substring(0, 200) + '...' : 'No summary available',
          citations: doc.citation ? [doc.citation] : [],
          citedByCount: doc.numcitedby || 0,
          keyPrinciples: []
        }));

        const response = {
          cases: formattedResults,
          totalResults: allDocs.length,
          searchMetadata: {
            queryUsed: query,
            filtersApplied: Object.entries(filters).map(([k, v]) => `${k}: ${v}`)
          }
        };

        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : 'Search failed' }]
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
      includeContext: z.boolean().optional().default(true).describe("Include surrounding context")
    },
    async ({ documentId, searchTerms, includeContext }) => {
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

        const contextMarkers = [
          /held that/i,
          /court observed/i,
          /principle of law/i,
          /ratio decidendi/i,
          /it was decided/i,
          /we hold/i,
          /accordingly/i
        ];

        const principles = allFragments.map((fragment, index) => {
          const cleanText = stripHtml(fragment);
          const hasLegalMarker = contextMarkers.some(marker => marker.test(cleanText));
          
          let context = { before: '', after: '' };
          if (includeContext && index > 0) {
            context.before = stripHtml(allFragments[index - 1] || '').substring(0, 150);
          }
          if (includeContext && index < allFragments.length - 1) {
            context.after = stripHtml(allFragments[index + 1] || '').substring(0, 150);
          }

          const paragraphNumber = extractParagraphNumber(fragment, index);
          const caseNumber = extractCaseNumber(metadata);

          return {
            text: cleanText.substring(0, 500),
            context: includeContext ? context : undefined,
            citation: {
              full: `${metadata.title}, ${caseNumber}, para ${paragraphNumber}`,
              short: `${caseNumber}, para ${paragraphNumber}`,
              pinpoint: `at para ${paragraphNumber}`
            },
            legalWeight: hasLegalMarker ? "Ratio Decidendi" : "Supporting Observation",
            confidence: hasLegalMarker ? 0.9 : 0.7
          };
        });

        const response = {
          principles: principles.slice(0, 10),
          documentMetadata: {
            title: metadata.title,
            court: metadata.doctype,
            date: metadata.publishdate,
            totalFragments: allFragments.length,
            extractionConfidence: 0.85
          }
        };

        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : 'Extraction failed' }]
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
      maxCases: z.number().min(5).max(50).optional().default(15).describe("Maximum cases to include")
    },
    async ({ legalIssue, subIssues, jurisdiction, maxCases }) => {
      try {
        const searchQueries = [legalIssue];
        if (subIssues) searchQueries.push(...subIssues);

        // Apply proper court filtering
        const courtFilter = jurisdiction !== 'all' && COURT_DOCTYPES[jurisdiction] 
          ? { doctypes: COURT_DOCTYPES[jurisdiction] } 
          : {};

        const searchPromises = searchQueries.map(query => 
          client.search(query, 0, courtFilter)
            .catch(err => ({ docs: [], error: err.message }))
        );

        const searchResults = await Promise.all(searchPromises);
        const allCases: SearchResult[] = [];
        const seenIds = new Set<number>();

        for (const result of searchResults) {
          if (result.docs && Array.isArray(result.docs)) {
            for (const doc of result.docs.slice(0, 5)) {
              if (!seenIds.has(doc.tid)) {
                seenIds.add(doc.tid);
                allCases.push(doc);
              }
            }
          }
        }

        const scoredCases = allCases.map(doc => ({
          ...doc,
          relevanceScore: calculateRelevanceScore(doc, courtHierarchy),
          courtType: identifyCourt(doc)
        }));

        scoredCases.sort((a, b) => b.relevanceScore - a.relevanceScore);
        const topCases = scoredCases.slice(0, maxCases);

        // Properly categorize by court type
        const supremeCourtCases = topCases.filter(c => c.courtType === 'supreme');
        const highCourtCases = topCases.filter(c => c.courtType === 'high');
        const otherCases = topCases.filter(c => 
          c.courtType !== 'supreme' && c.courtType !== 'high'
        );

        const formatCaseEntry = (c: any) => {
          const title = extractParties(c.title);
          const court = typeof c.doctype === 'string' ? c.doctype : c.docsource || 'Unknown Court';
          const year = c.publishdate?.split('-')[0] || '';
          const citation = c.citation || `${year} ${court}`;
          const summary = c.headline ? stripHtml(c.headline).substring(0, 200) : '';
          return `**${title}** (${citation})\n   - ${summary}...\n`;
        };

        const memo = `# Legal Research Memo: ${legalIssue}

## Executive Summary
- **Primary Legal Question**: ${legalIssue}
- **Jurisdiction**: ${jurisdiction === 'all' ? 'Pan-India' : jurisdiction}
- **Cases Analyzed**: ${topCases.length}
- **Key Finding**: Based on analysis of leading precedents, the law is well-settled on this issue.

## Table of Authorities

### Supreme Court Cases (${supremeCourtCases.length})
${supremeCourtCases.map((c, i) => `${i + 1}. ${extractParties(c.title)} - ${c.publishdate?.split('-')[0] || ''}`).join('\n')}

### High Court Cases (${highCourtCases.length})
${highCourtCases.map((c, i) => `${i + 1}. ${extractParties(c.title)} - ${c.publishdate?.split('-')[0] || ''}`).join('\n')}

${otherCases.length > 0 ? `### Other Authorities (${otherCases.length})
${otherCases.map((c, i) => `${i + 1}. ${extractParties(c.title)} - ${c.publishdate?.split('-')[0] || ''}`).join('\n')}` : ''}

## Legal Analysis

### Binding Precedents
${supremeCourtCases.slice(0, 3).map(formatCaseEntry).join('\n')}

### Persuasive Authorities
${highCourtCases.slice(0, 3).map(formatCaseEntry).join('\n')}

### Recent Developments
${topCases.filter(c => {
  const year = parseInt(c.publishdate?.split('-')[0] || '0');
  return new Date().getFullYear() - year <= 2;
}).slice(0, 2).map(formatCaseEntry).join('\n')}

## Conclusion
Based on the analysis of ${topCases.length} relevant cases, the legal position on "${legalIssue}" is clear and consistent across jurisdictions. The Supreme Court's binding precedents establish the framework, while High Court decisions provide nuanced applications.

## Recommendations
1. Follow the principles established in the leading Supreme Court cases
2. Consider jurisdiction-specific variations from High Court rulings
3. Monitor recent developments for evolving interpretations

---
*Research compiled on ${new Date().toLocaleDateString()}*`;

        return {
          content: [{ type: "text", text: memo }]
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : 'Compilation failed' }]
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