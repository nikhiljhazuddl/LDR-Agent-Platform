const companiesEl = document.getElementById('companies');
const runButton = document.getElementById('runButton');
const stopButton = document.getElementById('stopButton');
const sampleButton = document.getElementById('sampleButton');
const clearButton = document.getElementById('clearButton');
const statusEl = document.getElementById('status');
const timelineEl = document.getElementById('timeline');
const eventCountEl = document.getElementById('eventCount');
const resultCountEl = document.getElementById('resultCount');
const outputPathEl = document.getElementById('outputPath');
const resultsBody = document.getElementById('resultsBody');
const currentCompanyEl = document.getElementById('currentCompany');
const currentStageEl = document.getElementById('currentStage');
const progressFillEl = document.getElementById('progressFill');
const browserImageEl = document.getElementById('browserImage');
const browserEmptyEl = document.getElementById('browserEmpty');
const browserMetaEl = document.getElementById('browserMeta');
const browserUrlEl = document.getElementById('browserUrl');
const exportCsvButton = document.getElementById('exportCsvButton');
const llmApiKeyEl = document.getElementById('llmApiKey');
const CONNECTED_GMAIL_EMAIL = 'admin-tools@zuddl.com';
const webinarProfileEls = {
  fullName: document.getElementById('webinarFullName'),
  email: document.getElementById('webinarEmail'),
  company: document.getElementById('webinarCompany'),
  title: document.getElementById('webinarTitle'),
  phone: document.getElementById('webinarPhone'),
  country: document.getElementById('webinarCountry'),
};

let eventCount = 0;
let activeJobId = null;
let lastJobId = null;
let activeSource = null;
const liveResults = new Map();
const resultColumns = [
  ['Company Name', 'companyName'],
  ['Company Domain', 'companyDomain'],
  ['Event Name', 'eventName'],
  ['Event URL', 'eventUrl'],
  ['Registration URL', 'registrationUrl'],
  ['Event Date', 'eventDate'],
  ['Event Type', 'eventType'],
  ['Technology Detected', 'eventTechnology'],
  ['Technology Source', 'eventTechnologySource'],
  ['Technology Evidence', 'eventTechEvidence'],
  ['Tech Confidence', 'eventTechConfidence'],
  ['Event Selection Source', 'eventSelectionSource'],
  ['Registration Found', 'registrationFound'],
  ['Agenda Found', 'agendaFound'],
  ['Speaker Page Found', 'speakerPageFound'],
  ['Sponsor Page Found', 'sponsorPageFound'],
  ['Webinar Name', 'webinarName'],
  ['Webinar URL', 'webinarUrl'],
  ['Webinar Registration Status', 'webinarRegistrationStatus'],
  ['Webinar Post-Registration URL', 'webinarPostRegistrationUrl'],
  ['Webinar Final URL', 'webinarFinalUrl'],
  ['Webinar Email Link Used', 'webinarEmailLinkUsed'],
  ['Webinar Email Subject', 'webinarEmailSubject'],
  ['Webinar Technology', 'webinarTechnology'],
  ['Webinar Technology Source', 'webinarTechnologySource'],
  ['Webinar Tech Evidence', 'webinarTechEvidence'],
  ['Field Events Hosted Status', 'fieldEventsHostedStatus'],
  ['Field Events Hosted Type', 'fieldEventsHostedType'],
  ['Field Event Link', 'fieldEventLink'],
  ['Field Event Registration URL', 'fieldEventRegistrationUrl'],
  ['Field Events Reasoning', 'fieldEventsReasoning'],
  ['Platform Used For Field Event', 'platformUsedForFieldEvent'],
  ['Field Event Platform Source', 'fieldEventPlatformSource'],
  ['Number Of Field Events In Year Count', 'numberOfFieldEventsInYearCount'],
  ['Field Event Ranked Links', 'fieldEventRankedLinks'],
  ['Confidence Score', 'confidenceScore'],
  ['Confidence Class', 'confidenceClass'],
  ['Last Updated', 'lastUpdated'],
  ['Research Status', 'researchStatus'],
  ['Processing Time (ms)', 'processingTimeMs'],
  ['AI Used', 'aiUsed'],
  ['Error Notes', 'errorNotes'],
];

runButton.addEventListener('click', runResearch);
stopButton.addEventListener('click', stopResearch);
sampleButton.addEventListener('click', loadSample);
exportCsvButton.addEventListener('click', exportCsv);
clearButton.addEventListener('click', () => {
  timelineEl.innerHTML = '';
  resultsBody.innerHTML = '';
  liveResults.clear();
  outputPathEl.textContent = '';
  eventCount = 0;
  eventCountEl.textContent = '0 events';
  resultCountEl.textContent = '0 rows';
  statusEl.textContent = 'Idle';
  setCurrentState('Idle', 'Waiting', 0);
  clearBrowserView();
  clearCredentialFields();
  clearWebinarProfileFields();
  activeJobId = null;
  lastJobId = null;
  setRunningState(false);
  updateExportState();
});

if (new URLSearchParams(window.location.search).get('sample') === '1') {
  loadSample();
}

async function loadSample() {
  sampleButton.disabled = true;
  try {
    const response = await fetch('/api/sample-data');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Unable to load sample');
    companiesEl.value = payload.csv;
    statusEl.textContent = `Loaded ${payload.count} companies`;
  } catch (error) {
    statusEl.textContent = 'Sample failed';
    appendEvent({
      timestamp: new Date().toISOString(),
      stage: 'error',
      message: error.message,
    });
  } finally {
    sampleButton.disabled = false;
  }
}

async function runResearch() {
  const companies = companiesEl.value.trim();
  if (!companies) {
    statusEl.textContent = 'Add companies';
    return;
  }

  setRunningState(true);
  statusEl.textContent = 'Starting';
  timelineEl.innerHTML = '';
  resultsBody.innerHTML = '';
  liveResults.clear();
  outputPathEl.textContent = '';
  eventCount = 0;
  eventCountEl.textContent = '0 events';
  resultCountEl.textContent = '0 rows';
  updateExportState(0);
  setCurrentState('Starting', 'Queued', 0);
  clearBrowserView();

  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companies,
        llmApiKey: llmApiKeyEl.value.trim(),
        webinarRegistrationProfile: readWebinarProfile(),
      }),
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Unable to start run');

    outputPathEl.textContent = `Excel output: ${payload.outputPath}`;
    activeJobId = payload.jobId;
    lastJobId = payload.jobId;
    connectEvents(payload.jobId);
  } catch (error) {
    statusEl.textContent = 'Failed';
    appendEvent({
      timestamp: new Date().toISOString(),
      stage: 'error',
      message: error.message,
    });
    setRunningState(false);
  }
}

async function stopResearch() {
  if (!activeJobId) return;
  stopButton.disabled = true;
  statusEl.textContent = 'Stopping';
  appendEvent({
    timestamp: new Date().toISOString(),
    stage: 'stopped',
    message: 'Stop requested by user.',
  });
  try {
    await fetch(`/api/jobs/${activeJobId}/stop`, { method: 'POST' });
  } catch (error) {
    appendEvent({
      timestamp: new Date().toISOString(),
      stage: 'error',
      message: error.message || 'Unable to stop run.',
    });
  }
}

function connectEvents(jobId) {
  if (activeSource) activeSource.close();
  const source = new EventSource(`/api/events/${jobId}`);
  activeSource = source;
  statusEl.textContent = 'Running';

  source.onmessage = event => {
    const payload = JSON.parse(event.data);
    appendEvent(payload);
    if (payload.company) {
      touchCompany(payload.company, payload.stage, payload.message);
    }
    updateCurrentState(payload);
    updateBrowserView(payload);
    if (payload.detail && payload.detail.result) {
      upsertResult(payload.detail.result);
    }

    if (payload.stage === 'complete' && !payload.company) {
      statusEl.textContent = 'Complete';
      loadResults(jobId);
      source.close();
      activeSource = null;
      activeJobId = null;
      setRunningState(false);
    }

    if (payload.stage === 'error' && !payload.company) {
      statusEl.textContent = 'Failed';
      source.close();
      activeSource = null;
      activeJobId = null;
      setRunningState(false);
    }

    if (payload.stage === 'stopped' && !payload.company) {
      statusEl.textContent = 'Stopped';
      source.close();
      activeSource = null;
      activeJobId = null;
      setRunningState(false);
    }
  };

  source.onerror = () => {
    source.close();
    loadResults(jobId).finally(() => {
      activeSource = null;
      activeJobId = null;
      setRunningState(false);
    });
  };
}

function setRunningState(isRunning) {
  runButton.disabled = isRunning;
  stopButton.disabled = !isRunning;
  sampleButton.disabled = isRunning;
  clearButton.disabled = isRunning;
  llmApiKeyEl.disabled = isRunning;
  for (const element of Object.values(webinarProfileEls)) element.disabled = isRunning;
}

function clearCredentialFields() {
  llmApiKeyEl.value = '';
}

function clearWebinarProfileFields() {
  for (const [key, element] of Object.entries(webinarProfileEls)) {
    element.value = key === 'email' ? CONNECTED_GMAIL_EMAIL : '';
  }
}

function appendEvent(event) {
  eventCount += 1;
  eventCountEl.textContent = `${eventCount} ${eventCount === 1 ? 'event' : 'events'}`;

  const row = document.createElement('div');
  row.className = 'event';

  const time = new Date(event.timestamp).toLocaleTimeString();
  const stageClass = event.stage === 'error' ? 'error' : event.stage === 'ai' ? 'ai' : '';
  row.innerHTML = `
    <div class="event-time">${escapeHtml(time)}</div>
    <div>
      <div class="event-stage ${stageClass}">${escapeHtml(event.stage)}</div>
      <div class="event-company">${escapeHtml(event.company || 'Batch')}</div>
    </div>
    <div>${escapeHtml(event.message)}</div>
  `;
  timelineEl.appendChild(row);
  timelineEl.scrollTop = timelineEl.scrollHeight;
}

async function loadResults(jobId) {
  const response = await fetch(`/api/jobs/${jobId}`);
  if (!response.ok) return;
  const job = await response.json();
  resultsBody.innerHTML = '';
  liveResults.clear();

  for (const result of job.results) {
    upsertResult(result);
  }
}

function upsertResult(result) {
  liveResults.set(result.companyName, {
    ...(liveResults.get(result.companyName) || {}),
    ...result,
    liveStage: result.researchStatus || 'complete',
  });
  renderResults();
}

function touchCompany(companyName, stage, message) {
  const existing = liveResults.get(companyName) || { companyName };
  const progressPercent = stage === 'complete' || stage === 'output' ? 100 : existing.progressPercent;
  liveResults.set(companyName, {
    ...existing,
    companyName,
    liveStage: stage,
    liveMessage: message,
    progressPercent,
    researchStatus: existing.researchStatus || 'running',
  });
  renderResults();
}

function renderResults() {
  resultsBody.innerHTML = '';
  const results = Array.from(liveResults.values()).sort((a, b) => a.companyName.localeCompare(b.companyName));
  resultCountEl.textContent = `${results.length} ${results.length === 1 ? 'row' : 'rows'}`;
  updateExportState(results.length);

  for (const result of results) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(result.companyName)}</td>
      <td>${escapeHtml(result.eventName || '')}</td>
      <td>${linkCell(result.eventUrl)}</td>
      <td>${escapeHtml(result.eventTechnology || '')}</td>
      <td>${escapeHtml(shorten(result.eventTechnologySource || ''))}</td>
      <td>${escapeHtml(shorten(result.eventSelectionSource || result.liveMessage || ''))}</td>
      <td>${escapeHtml(result.registrationFound ? 'Yes' : 'No')}</td>
      <td>${linkCell(result.webinarUrl)}</td>
      <td>${escapeHtml(result.webinarRegistrationStatus || '')}</td>
      <td>${linkCell(result.webinarFinalUrl || result.webinarPostRegistrationUrl)}</td>
      <td>${escapeHtml(shorten(result.webinarEmailSubject || ''))}</td>
      <td>${escapeHtml(result.webinarTechnology || '')}</td>
      <td>${escapeHtml(shorten(result.webinarTechnologySource || ''))}</td>
      <td>${escapeHtml(result.fieldEventsHostedStatus || '')}</td>
      <td>${escapeHtml(result.fieldEventsHostedType || '')}</td>
      <td>${linkCell(result.fieldEventLink)}</td>
      <td>${escapeHtml(result.platformUsedForFieldEvent || '')}</td>
      <td>${escapeHtml(shorten(result.fieldEventsReasoning || ''))}</td>
      <td>${escapeHtml(result.confidenceScore === undefined ? '' : String(result.confidenceScore))}</td>
      <td>${statusCell(result)}</td>
    `;
    resultsBody.appendChild(tr);
  }
}

function readWebinarProfile() {
  return Object.fromEntries(
    Object.entries(webinarProfileEls)
      .map(([key, element]) => [key, element.value.trim()])
      .filter(([, value]) => value)
  );
}

async function exportCsv() {
  const visibleResults = sortedResults();
  if (visibleResults.length === 0) return;

  exportCsvButton.disabled = true;
  try {
    if (!activeJobId && lastJobId) {
      const response = await fetch(`/api/jobs/${lastJobId}/results.csv`);
      if (response.ok) {
        const blob = await response.blob();
        downloadBlob(blob, csvFileName());
        return;
      }
    }

    const csv = buildCsv(visibleResults);
    downloadBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), csvFileName());
  } catch (error) {
    appendEvent({
      timestamp: new Date().toISOString(),
      stage: 'error',
      message: error.message || 'CSV export failed.',
    });
  } finally {
    updateExportState();
  }
}

function sortedResults() {
  return Array.from(liveResults.values()).sort((a, b) => a.companyName.localeCompare(b.companyName));
}

function buildCsv(results) {
  const rows = [resultColumns.map(([label]) => label)];
  for (const result of results) {
    rows.push(resultColumns.map(([, key]) => result[key] ?? ''));
  }
  return rows.map(row => row.map(escapeCsvCell).join(',')).join('\n');
}

function escapeCsvCell(value) {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvFileName() {
  const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19);
  return `event-intelligence-results-${stamp}.csv`;
}

function updateExportState(count = liveResults.size) {
  exportCsvButton.disabled = count === 0;
}

function updateCurrentState(event) {
  if (!event.company) return;
  const progress = Number(event.detail && event.detail.progressPercent);
  setCurrentState(event.company, event.stage, Number.isFinite(progress) ? progress : undefined);
  const existing = liveResults.get(event.company);
  if (existing && Number.isFinite(progress)) {
    liveResults.set(event.company, { ...existing, progressPercent: progress });
    renderResults();
  }
}

function setCurrentState(company, stage, progress) {
  currentCompanyEl.textContent = company;
  currentStageEl.textContent = stage;
  if (typeof progress === 'number') {
    progressFillEl.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  }
}

function updateBrowserView(event) {
  const detail = event.detail || {};
  if (!detail.screenshotUrl) return;
  browserImageEl.src = `${detail.screenshotUrl}?t=${Date.now()}`;
  browserImageEl.style.display = 'block';
  browserEmptyEl.style.display = 'none';
  browserMetaEl.textContent = `${event.company || ''} · ${detail.candidateType || 'page'} ${detail.candidateRank || ''}`;
  browserUrlEl.textContent = detail.url || '';
}

function clearBrowserView() {
  browserImageEl.removeAttribute('src');
  browserImageEl.style.display = 'none';
  browserEmptyEl.style.display = 'flex';
  browserMetaEl.textContent = 'Waiting for crawler';
  browserUrlEl.textContent = '';
}

function statusCell(result) {
  const stage = result.liveStage || result.researchStatus || '';
  const progress = typeof result.progressPercent === 'number' ? result.progressPercent : undefined;
  const progressText = progress === undefined ? '' : ` (${Math.round(progress)}%)`;
  return escapeHtml(`${stage}${progressText}`);
}

function linkCell(url) {
  if (!url) return '';
  return `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`;
}

function shorten(value) {
  const text = String(value);
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}
