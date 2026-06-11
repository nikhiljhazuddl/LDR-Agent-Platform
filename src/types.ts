export interface CompanyInput {
  name: string;
  domain?: string;
}

export interface RuntimeCredentials {
  serperApiKey?: string;
  nvidiaApiKey?: string;
  nvidiaModel?: string;
  anthropicApiKey?: string;
}

export interface WebinarRegistrationProfile {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  company?: string;
  title?: string;
  phone?: string;
  country?: string;
}

export type WebinarRegistrationStatus =
  | 'not_attempted'
  | 'no_profile'
  | 'no_form'
  | 'submitted'
  | 'watch_page_opened'
  | 'email_sent'
  | 'email_found'
  | 'email_timeout'
  | 'failed';

export interface WebinarAccessResult {
  status: WebinarRegistrationStatus;
  postRegistrationUrl: string | null;
  finalWebinarUrl: string | null;
  emailLinkUsed: string | null;
  emailSubject: string | null;
  evidence: string;
  registrationPage?: PageAnalysis;
  finalPage?: PageAnalysis;
}

export interface FieldEventResult {
  status: 'Yes' | 'No';
  type: string;
  link: string | null;
  registrationUrl: string | null;
  platform: string | null;
  platformSource: string;
  count: number;
  reasoning: string;
  rankedLinks: string;
}

export type ProgressStage =
  | 'queued'
  | 'search'
  | 'scoring'
  | 'crawl'
  | 'registration'
  | 'technology'
  | 'confidence'
  | 'ai'
  | 'browser'
  | 'output'
  | 'complete'
  | 'stopped'
  | 'error';

export interface ProgressEvent {
  timestamp: string;
  stage: ProgressStage;
  company?: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface SearchQuery {
  query: string;
  type: 'event' | 'webinar' | 'field_event';
  priority: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  position: number;
  query: string;
  queryType: 'event' | 'webinar' | 'field_event';
}

export interface ScoreBreakdown {
  domainMatch: number;
  subdomainBonus: number;
  keywordSignals: number;
  dateSignals: number;
  negativeSignals: number;
  positionBonus: number;
  total: number;
  appliedRules: Array<{ name: string; points: number }>;
}

export interface ScoredCandidate {
  url: string;
  domain: string;
  title: string;
  snippet: string;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  queryType: 'event' | 'webinar' | 'field_event';
}

export interface ScriptInfo {
  src: string;
  inline: boolean;
  content?: string;
}

export interface NetworkRequest {
  url: string;
  method: string;
  resourceType: string;
  domain: string;
}

export interface CookieInfo {
  name: string;
  value: string;
  domain: string;
}

export interface RegistrationTarget {
  text: string;
  url: string;
  source: 'link' | 'form' | 'click';
}

export interface PageAnalysis {
  url: string;
  finalUrl: string;
  statusCode: number;
  title: string;
  metaDescription: string;
  htmlContent: string;
  scripts: ScriptInfo[];
  stylesheets: string[];
  networkRequests: NetworkRequest[];
  cookies: CookieInfo[];
  formActions: string[];
  iframeUrls: string[];
  registrationTargets: RegistrationTarget[];
  globalVariables: string[];
  loadTimeMs: number;
  redirectChain: string[];
  formSubmitStatus?: {
    attempted: boolean;
    submitted: boolean;
    message: string;
    fieldsFilled?: string[];
    postSubmitUrl?: string;
    emailLikelySent?: boolean;
  };
  screenshotUrl?: string;
  error?: string;
}

export interface RegistrationSignals {
  found: boolean;
  registrationButtons: string[];
  registrationForms: number;
  agendaFound: boolean;
  speakersFound: boolean;
  sponsorsFound: boolean;
  exhibitorsFound: boolean;
  venueFound: boolean;
  pricingFound: boolean;
  futureDate?: string;
}

export type DetectionMethod =
  | 'domain'
  | 'script'
  | 'network'
  | 'cookie'
  | 'global_variable'
  | 'form_action'
  | 'dns_cname'
  | 'meta_tag'
  | 'html_class';

export interface TechEvidence {
  method: DetectionMethod;
  signal: string;
  source: string;
  weight: number;
}

export interface TechDetectionResult {
  platform: string;
  confidence: number;
  evidence: TechEvidence[];
  isKnownPlatform: boolean;
  suspectedVendor?: string;
}

export interface CompanyResult {
  companyName: string;
  companyDomain: string;

  eventName: string | null;
  eventUrl: string | null;
  registrationUrl: string | null;
  eventDate: string | null;
  eventType: 'conference' | 'summit' | 'forum' | 'user_conference' | 'unknown';

  eventTechnology: string | null;
  eventTechnologySource: string;
  eventTechEvidence: string;
  eventTechConfidence: number;
  eventSelectionSource: string;

  registrationFound: boolean;
  agendaFound: boolean;
  speakerPageFound: boolean;
  sponsorPageFound: boolean;

  webinarName: string | null;
  webinarUrl: string | null;
  webinarRegistrationStatus: WebinarRegistrationStatus;
  webinarPostRegistrationUrl: string | null;
  webinarFinalUrl: string | null;
  webinarEmailLinkUsed: string | null;
  webinarEmailSubject: string | null;
  webinarTechnology: string | null;
  webinarTechnologySource: string;
  webinarTechEvidence: string;

  fieldEventsHostedStatus: 'Yes' | 'No';
  fieldEventsHostedType: string;
  fieldEventLink: string | null;
  fieldEventRegistrationUrl: string | null;
  fieldEventsReasoning: string;
  platformUsedForFieldEvent: string | null;
  fieldEventPlatformSource: string;
  numberOfFieldEventsInYearCount: number;
  fieldEventRankedLinks: string;

  confidenceScore: number;
  confidenceClass: 'high' | 'medium' | 'review';

  lastUpdated: string;
  researchStatus: 'complete' | 'partial' | 'failed' | 'needs_review';
  processingTimeMs: number;
  aiUsed: boolean;
  errorNotes: string;
}
