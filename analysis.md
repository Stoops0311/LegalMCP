# IndianKanoon API Analysis

This document provides a comprehensive analysis of the IndianKanoon API endpoints, their response formats, and implementation considerations for building an MCP server.

## API Overview

**Base URL**: `https://api.indiankanoon.org`  
**Authentication**: Token-based via Authorization header: `Authorization: Token <api_key>`  
**HTTP Method**: All endpoints require `POST` requests  
**Response Format**: JSON (specify via `Accept: application/json` header)

## Endpoint Analysis

### 1. Search API (`/search/`)

**Endpoint**: `GET/POST /search/?formInput=<query>&pagenum=<pagenum>`

#### Request Parameters
- `formInput` (required): Search query with operators support
- `pagenum` (required): Page number starting from 0
- `doctypes` (optional): Filter by court/document type
- `fromdate`/`todate` (optional): Date range filters (DD-MM-YYYY)
- `title` (optional): Search within document titles
- `cite` (optional): Search by citation
- `author` (optional): Filter by judge name
- `bench` (optional): Filter by bench composition
- `maxcites` (optional): Include citations in results (max 50)

#### Search Operators
- `ANDD`, `ORR`, `NOTT` (case-sensitive, space-separated)
- Phrase search: `"freedom of speech"`
- Implicit AND: `murder kidnapping` = `murder ANDD kidnapping`

#### Response Structure
```json
{
  "categories": [
    ["Filter by AI Tags", [{"value": "tag-name", "formInput": "encoded-query"}]],
    ["Related Queries", [{"value": "query", "formInput": "encoded-query"}]],
    ["Document Types", [{"value": "All", "formInput": "query", "selected": true}]],
    ["Courts and Laws", [{"value": "Delhi High Court", "formInput": "query"}]],
    ["Authors", [{"value": "Judge Name", "formInput": "query"}]],
    ["Bench", [{"value": "Judge Name", "formInput": "query"}]],
    ["Years", [{"value": "2024", "formInput": "query"}]]
  ],
  "docs": [
    {
      "tid": 178980348,
      "catids": [2502, 2495, 564],
      "doctype": 1002,
      "publishdate": "2015-07-06",
      "authorid": 684,
      "bench": [684, 687],
      "title": "Case Title vs Respondent on Date",
      "numcites": 12,
      "numcitedby": 24,
      "headline": "Highlighted text with <b>search terms</b>",
      "docsize": 97480,
      "fragment": true,
      "docsource": "Delhi High Court",
      "author": "Judge Name",
      "authorEncoded": "judge-slug",
      "citation": "2016 SCC OnLine Cal 4885" // Sometimes present
    }
  ],
  "found": "1 - 10 of 3371",
  "encodedformInput": "trademark%20infringement"
}
```

#### Key Fields
- `tid`: Document ID for other API calls
- `doctype`: Court/document type identifier
- `headline`: Snippet with highlighted search terms
- `docsize`: Document size in characters
- `numcites`/`numcitedby`: Citation metrics
- `categories`: Rich filter suggestions with AI tags

#### Implementation Notes
- **Pagination**: Use `pagenum` starting from 0
- **Rich Filtering**: Categories provide intelligent suggestions
- **Court Types**: Use `doctypes` parameter for court-specific searches
- **Citation Search**: Use `cite` parameter for finding specific citations

---

### 2. Document API (`/doc/<docid>/`)

**Endpoint**: `POST /doc/<docid>/`

#### Request Parameters
- `docid` (required): Document ID from search results
- `maxcites` (optional): Number of cited cases to include (max 50)
- `maxcitedby` (optional): Number of citing cases to include (max 50)

#### Response Structure
```json
{
  "tid": 178980348,
  "publishdate": "2015-07-06",
  "title": "Full Case Title",
  "doc": "<h2>HTML formatted full document content</h2>...",
  "citeList": [
    {"tid": 123456, "title": "Cited Case Title", "citation": "2010 SCC 1"}
  ],
  "citedbyList": [
    {"tid": 789012, "title": "Citing Case Title", "citation": "2020 SCC 5"}
  ]
}
```

#### Key Features
- **Full HTML Content**: Complete judgment with structured markup
- **Citation Lists**: Up to 50 cited/citing cases with details
- **Rich Formatting**: Includes headings, paragraphs, case structure
- **Large Size**: Documents can be 50KB-200KB+ in size

#### Implementation Notes
- **Content Processing**: HTML needs parsing for clean text extraction
- **Citation Network**: Useful for building case relationship maps
- **Performance**: Large documents may need chunking for LLM processing

---

### 3. Document Fragments API (`/docfragment/<docid>/`)

**Endpoint**: `POST /docfragment/<docid>/?formInput=<query>`

#### Request Parameters
- `docid` (required): Document ID
- `formInput` (required): Search terms to find within document

#### Response Structure
```json
{
  "headline": [
    "<p>Fragment 1 with <b><b>highlighted</b></b> terms</p>",
    "<p>Fragment 2 with <b><b>search</b></b> terms</p>",
    "<p>Fragment 3 with relevant content</p>"
  ],
  "title": "Document Title",
  "formInput": "search terms",
  "tid": "178980348"
}
```

#### Key Features
- **Targeted Extraction**: Only relevant fragments containing search terms
- **Double Highlighting**: Terms are wrapped in `<b><b>term</b></b>`
- **Context Preservation**: Maintains paragraph structure
- **Efficient**: Much smaller than full document

#### Implementation Notes
- **Perfect for Citations**: Extract specific legal principles with context
- **No Pagination**: All matching fragments returned in single response
- **HTML Processing**: Need to strip HTML tags for clean text

---

### 4. Document Metadata API (`/docmeta/<docid>/`)

**Endpoint**: `POST /docmeta/<docid>/`

#### Response Structure
```json
{
  "tid": 178980348,
  "publishdate": "2015-07-06",
  "doctype": "Delhi High Court",
  "relurl": "delhi/2015-07-06/FAO(OS)--493-2014",
  "caseno": "FAO(OS)--493/2014",
  "numcites": 12,
  "numcitedby": 24,
  "title": "Full Case Title"
}
```

#### Key Features
- **Lightweight**: Essential metadata only
- **Court Information**: Doctype shows court name
- **Case Number**: Original court case number
- **URL Structure**: Relative URL for IndianKanoon
- **Citation Metrics**: Number of references

#### Implementation Notes
- **Fast Lookup**: Quick metadata without full content
- **Citation Formatting**: Combine with title for proper citations
- **Court Identification**: Use doctype for jurisdiction info

---

### 5. Court Copy API (`/origdoc/<docid>/`)

**Endpoint**: `POST /origdoc/<docid>/`

#### Response Structure
```json
{
  "Content-Type": "application/pdf",
  "doc": "JVBERi0xLjUNCiW1tbW1DQoxIDAgb2JqDQo..." // Base64 encoded PDF
}
```

#### Key Features
- **Original PDF**: Exact court copy as filed
- **Base64 Encoding**: PDF content encoded for transmission
- **Authentication Required**: Likely premium feature
- **Large Size**: Multi-page PDF documents

#### Implementation Notes
- **Binary Handling**: Decode base64 to get actual PDF
- **Storage Considerations**: PDFs can be several MB
- **Premium Feature**: May have usage limits/costs

---

## API Limitations and Constraints

### 1. No AI-Powered Features
- **No Semantic Search**: Basic keyword matching only
- **No Legal Principle Extraction**: Manual fragment parsing required
- **No Citation Relationship Analysis**: Basic citation lists only
- **No Document Classification**: Limited to court type filtering

### 2. Limited Citation Support
- **No Parallel Citations**: API doesn't provide alternative citations
- **No Citation Validation**: Can't verify citation accuracy
- **No Legal Status**: No information on overruled/distinguished cases
- **Basic Formatting**: Citation format varies by document

### 3. Performance Considerations
- **Large Documents**: Full documents can be 50KB-500KB+
- **No Streaming**: Complete response required before processing
- **Rate Limiting**: Likely API rate limits (not documented)
- **Authentication Required**: All endpoints need valid token

### 4. Search Limitations
- **Basic Ranking**: No advanced relevance scoring
- **Limited Fuzzy Matching**: Exact term matching primarily
- **No Synonyms**: Must use exact legal terminology
- **Manual Filtering**: Post-processing needed for complex criteria

## Implementation Recommendations for MCP Server

### 1. Search Tool Design
```typescript
// Intelligent search with post-processing
async function searchLegalPrecedents(query: string, options: SearchOptions) {
  // 1. Multiple search variants for better coverage
  const searches = [
    query,
    query.replace(/\b(and|or)\b/g, ' ANDD '),
    `"${query}"` // Phrase search
  ];
  
  // 2. Combine results and deduplicate
  // 3. Apply court hierarchy scoring
  // 4. Return ranked results with metadata
}
```

### 2. Citation Building Tool
```typescript
// Format citations with available data
async function formatCitations(docId: string, style: CitationStyle) {
  // 1. Get metadata for basic citation info
  // 2. Get document for additional details if needed
  // 3. Apply Indian legal citation standards
  // 4. Return formatted citation with confidence level
}
```

### 3. Fragment Extraction Tool
```typescript
// Extract relevant legal principles
async function extractLegalPrinciple(docId: string, searchTerms: string[]) {
  // 1. Use docfragment API for each term
  // 2. Combine and deduplicate fragments
  // 3. Clean HTML and preserve context
  // 4. Return with approximate location info
}
```

### 4. Research Compilation Tool
```typescript
// Build comprehensive research memo
async function buildCaseCompilation(issue: string, queries: string[]) {
  // 1. Search for each query variant
  // 2. Extract key fragments from top cases
  // 3. Organize by legal principle/relevance
  // 4. Format with proper citations
  // 5. Return structured research memo
}
```

## Error Handling Considerations

### 1. API Error Responses
- **401 Unauthorized**: Invalid or expired API token
- **Rate Limiting**: Potential 429 responses (not documented)
- **Document Not Found**: Empty responses or error for invalid docIds
- **Malformed Queries**: May return empty results vs errors

### 2. Data Quality Issues
- **Inconsistent Citations**: Varying formats across documents
- **Missing Metadata**: Some documents lack complete information
- **HTML Parsing**: Malformed HTML in document content
- **Encoding Issues**: Special characters in legal text

### 3. Recommended Error Handling
```typescript
// Robust API wrapper with fallbacks
async function safeApiCall(endpoint: string, params: any) {
  try {
    const response = await fetch(endpoint, params);
    if (!response.ok) {
      throw new ApiError(response.status, response.statusText);
    }
    return await response.json();
  } catch (error) {
    // Log error and return graceful fallback
    return handleApiError(error);
  }
}
```

## Performance Optimization Strategies

### 1. Caching
- **Search Results**: Cache common searches for 1 hour
- **Document Metadata**: Cache metadata for 24 hours
- **Fragments**: Cache fragment responses for specific queries
- **Full Documents**: Cache only if frequently accessed

### 2. Batching
- **Multiple Searches**: Parallel search requests for different terms
- **Metadata Lookup**: Batch metadata requests for search results
- **Fragment Extraction**: Parallel fragment requests

### 3. Response Size Management
- **Fragment Over Full**: Use fragments API when possible
- **Metadata First**: Get metadata before deciding on full document
- **Pagination**: Implement proper pagination for search results

## Conclusion

The IndianKanoon API provides solid foundation for legal research automation, despite lacking AI-powered features. The key to successful MCP implementation lies in:

1. **Smart Post-Processing**: Adding intelligence through careful result ranking and filtering
2. **Efficient Data Use**: Using fragments and metadata to minimize large document processing
3. **Robust Error Handling**: Graceful degradation when API limitations are hit
4. **User-Friendly Abstractions**: Hiding API complexity behind intuitive MCP tools

The API's strength is in comprehensive legal database coverage and structured responses. By building intelligent wrappers around these basic capabilities, we can create powerful legal research tools that significantly reduce manual citation work for lawyers.