import {
  SearchResponse,
  DocumentResponse,
  DocumentFragmentResponse,
  DocumentMetadataResponse,
  IndianKanoonConfig
} from './types.js';

export class IndianKanoonAPIClient {
  private baseUrl = 'https://api.indiankanoon.org';
  private cache: Map<string, { data: any; timestamp: number }> = new Map();

  constructor(private config: IndianKanoonConfig) {}

  private getCacheKey(endpoint: string, params?: any): string {
    return `${endpoint}:${JSON.stringify(params || {})}`;
  }

  private getCachedData<T>(key: string): T | null {
    if (!this.config.enableCaching) return null;
    
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    const cacheTimeout = (this.config.cacheTimeout || 60) * 60 * 1000;
    if (Date.now() - cached.timestamp > cacheTimeout) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.data as T;
  }

  private setCachedData(key: string, data: any): void {
    if (!this.config.enableCaching) return;
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  private async makeRequest<T>(
    endpoint: string,
    params?: Record<string, string>
  ): Promise<T> {
    const cacheKey = this.getCacheKey(endpoint, params);
    const cached = this.getCachedData<T>(cacheKey);
    if (cached) return cached;

    const url = `${this.baseUrl}${endpoint}`;
    const body = params ? new URLSearchParams(params).toString() : '';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.config.indianKanoonApiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid API key');
        } else if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        }
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      this.setCachedData(cacheKey, data);
      return data as T;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`IndianKanoon API error: ${error.message}`);
      }
      throw error;
    }
  }

  async search(params: {
    formInput: string;
    pagenum?: number;
    doctypes?: string;
    fromdate?: string;
    todate?: string;
    title?: string;
    cite?: string;
    author?: string;
    bench?: string;
    maxcites?: number;
  }): Promise<SearchResponse> {
    const queryParams: Record<string, string> = {
      formInput: params.formInput,
      pagenum: String(params.pagenum || 0)
    };

    if (params.doctypes) queryParams.doctypes = params.doctypes;
    if (params.fromdate) queryParams.fromdate = params.fromdate;
    if (params.todate) queryParams.todate = params.todate;
    if (params.title) queryParams.title = params.title;
    if (params.cite) queryParams.cite = params.cite;
    if (params.author) queryParams.author = params.author;
    if (params.bench) queryParams.bench = params.bench;
    if (params.maxcites) queryParams.maxcites = String(params.maxcites);

    return this.makeRequest<SearchResponse>('/search/', queryParams);
  }

  async getDocument(
    docId: string,
    options?: {
      maxcites?: number;
      maxcitedby?: number;
    }
  ): Promise<DocumentResponse> {
    const params: Record<string, string> = {};
    if (options?.maxcites) params.maxcites = String(options.maxcites);
    if (options?.maxcitedby) params.maxcitedby = String(options.maxcitedby);

    return this.makeRequest<DocumentResponse>(`/doc/${docId}/`, params);
  }

  async getDocumentFragments(
    docId: string,
    searchTerms: string
  ): Promise<DocumentFragmentResponse> {
    return this.makeRequest<DocumentFragmentResponse>(
      `/docfragment/${docId}/`,
      { formInput: searchTerms }
    );
  }

  async getDocumentMetadata(docId: string): Promise<DocumentMetadataResponse> {
    return this.makeRequest<DocumentMetadataResponse>(`/docmeta/${docId}/`);
  }

  async searchMultipleVariants(
    query: string,
    options?: {
      doctypes?: string;
      fromdate?: string;
      todate?: string;
    }
  ): Promise<SearchResult[]> {
    const variants = [
      query,
      `"${query}"`,
      query.replace(/\s+/g, ' ANDD '),
      query.split(' ').join(' ORR ')
    ];

    const uniqueVariants = [...new Set(variants)];
    
    const searchPromises = uniqueVariants.map(variant =>
      this.search({
        formInput: variant,
        pagenum: 0,
        ...options
      }).catch(() => null)
    );

    const results = await Promise.all(searchPromises);
    
    const allDocs = results
      .filter(r => r !== null)
      .flatMap(r => r!.docs);

    const uniqueDocs = new Map<number, SearchResult>();
    for (const doc of allDocs) {
      if (!uniqueDocs.has(doc.tid)) {
        uniqueDocs.set(doc.tid, doc);
      }
    }

    return Array.from(uniqueDocs.values());
  }

  clearCache(): void {
    this.cache.clear();
  }
}

interface SearchResult {
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