export interface IndianKanoonConfig {
  indianKanoonApiKey: string;
  defaultCourt?: string;
  maxSearchResults?: number;
  citationStyle?: 'AIR' | 'SCC' | 'Neutral' | 'SCC OnLine';
  enableCaching?: boolean;
  cacheTimeout?: number;
}

export interface SearchResult {
  tid: number;
  catids?: number[];
  doctype: number;
  publishdate: string;
  authorid?: number;
  bench?: number[];
  title: string;
  numcites: number;
  numcitedby: number;
  headline: string;
  docsize?: number;
  fragment: boolean;
  docsource: string;
  author?: string;
  authorEncoded?: string;
  citation?: string;
}

export interface SearchResponse {
  categories: Array<[string, Array<{
    value: string;
    formInput: string;
    selected?: boolean;
  }>]>;
  docs: SearchResult[];
  found: string;
  encodedformInput: string;
}

export interface DocumentResponse {
  tid: number;
  publishdate: string;
  title: string;
  doc: string;
  citeList?: Array<{
    tid: number;
    title: string;
    citation?: string;
  }>;
  citedbyList?: Array<{
    tid: number;
    title: string;
    citation?: string;
  }>;
}

export interface DocumentFragmentResponse {
  headline: string[];
  title: string;
  formInput: string;
  tid: string;
}

export interface DocumentMetadataResponse {
  tid: number;
  publishdate: string;
  doctype: string;
  relurl: string;
  caseno: string;
  numcites: number;
  numcitedby: number;
  title: string;
}

export interface ProcessedCase {
  id: string;
  title: string;
  court: string;
  year: string;
  relevanceScore: number;
  summary: string;
  citations: string[];
  citedByCount: number;
  keyPrinciples?: string[];
  caseNumber?: string;
  judges?: string[];
  url?: string;
}

export interface LegalPrinciple {
  text: string;
  context: {
    before?: string;
    after?: string;
  };
  citation: {
    full: string;
    short: string;
    pinpoint?: string;
  };
  legalWeight?: 'Ratio Decidendi' | 'Obiter Dictum' | 'Per Incuriam';
  judges?: string[];
  confidence: number;
}

export interface FormattedCitation {
  primary: {
    style: string;
    citation: string;
    confidence: number;
  };
  parallel?: Array<{
    style: string;
    citation: string;
    confidence: number;
  }>;
  formatted: {
    full: string;
    short: string;
    inText: string;
    footnote: string;
    bibliography: string;
    pinpoint?: string;
  };
}

export interface ValidationResult {
  citation: string;
  status: 'VALID' | 'INVALID' | 'UNCERTAIN';
  confidence: number;
  documentFound?: {
    id: string;
    title: string;
    exactMatch: boolean;
  };
  errors?: string[];
  suggestions?: Array<{
    corrected: string;
    confidence: number;
    reason: string;
  }>;
}

export interface ResearchMemo {
  executiveSummary: string;
  tableOfAuthorities: {
    supremeCourt: ProcessedCase[];
    highCourt: ProcessedCase[];
    districtCourt: ProcessedCase[];
  };
  legalAnalysis: {
    bindingPrecedents: Array<{
      case: ProcessedCase;
      principle: string;
      application: string;
    }>;
    persuasiveAuthorities: Array<{
      case: ProcessedCase;
      principle: string;
      weight: string;
    }>;
    distinguishableCases?: Array<{
      case: ProcessedCase;
      distinction: string;
    }>;
  };
  conclusion: string;
  citations: string[];
}