import { google } from 'googleapis';
import { getConfig } from '../config.js';
import type { CompanyResult } from '../types.js';
import { withRetry } from '../utils/retry.js';

export class SheetsClient {
  private sheets: ReturnType<typeof google.sheets> | null = null;
  private spreadsheetId: string | null = null;

  async initialize(): Promise<void> {
    const config = getConfig({ requireSheets: true });
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: config.googleServiceAccountEmail,
        private_key: config.googleServiceAccountKey?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.sheets = google.sheets({ version: 'v4', auth });
    this.spreadsheetId = config.googleSheetsId ?? null;
  }

  async ensureHeaders(): Promise<void> {
    if (!this.sheets || !this.spreadsheetId) throw new Error('SheetsClient not initialized');

    const headers = [
      'Company Name',
      'Company Domain',
      'Event Name',
      'Event URL',
      'Registration URL',
      'Event Date',
      'Event Type',
      'Technology Detected',
      'Technology Evidence',
      'Tech Confidence',
      'Registration Found',
      'Agenda Found',
      'Speaker Page Found',
      'Sponsor Page Found',
      'Webinar Name',
      'Webinar URL',
      'Webinar Technology',
      'Webinar Tech Evidence',
      'Confidence Score',
      'Confidence Class',
      'Last Updated',
      'Research Status',
      'Processing Time (ms)',
      'AI Used',
      'Error Notes',
    ];

    const existing = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Sheet1!A1:Y1',
    });

    if (!existing.data.values || existing.data.values.length === 0) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'Sheet1!A1:Y1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers] },
      });
    }
  }

  async appendResult(result: CompanyResult): Promise<void> {
    if (!this.sheets || !this.spreadsheetId) throw new Error('SheetsClient not initialized');

    const row = [
      result.companyName,
      result.companyDomain,
      result.eventName,
      result.eventUrl,
      result.registrationUrl,
      result.eventDate,
      result.eventType,
      result.eventTechnology,
      result.eventTechEvidence,
      result.eventTechConfidence,
      result.registrationFound,
      result.agendaFound,
      result.speakerPageFound,
      result.sponsorPageFound,
      result.webinarName,
      result.webinarUrl,
      result.webinarTechnology,
      result.webinarTechEvidence,
      result.confidenceScore,
      result.confidenceClass,
      result.lastUpdated,
      result.researchStatus,
      result.processingTimeMs,
      result.aiUsed,
      result.errorNotes,
    ];

    await withRetry(
      async () => {
        await this.sheets!.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId!,
          range: 'Sheet1!A:Y',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [row] },
        });
      },
      { maxRetries: 3, baseDelay: 800, maxDelay: 8000 }
    );
  }
}

