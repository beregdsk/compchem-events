export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria: { true: string; false: string };
}

export interface DecisionsRequest {
  model: string;
  state: Record<string, unknown>;
  questions: Record<string, NoulQuestion>;
}

export interface NoulAnswer {
  type: 'noul';
  noul: number;
}

export interface DecisionsResponse {
  model: string;
  answers: Record<string, NoulAnswer>;
  usage: { input_tokens: number; output_tokens: number; cost: number };
}

export interface JevClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** OpenRouter's Decisions API, which serves the jev decision model. */
export const DEFAULT_JEV_BASE_URL = 'https://openrouter.ai/api/alpha/decisions';

function isDecisionsResponse(data: unknown): data is DecisionsResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'answers' in data &&
    typeof (data as { answers: unknown }).answers === 'object' &&
    (data as { answers: unknown }).answers !== null
  );
}

export async function callJev(
  request: DecisionsRequest,
  options: JevClientOptions,
): Promise<DecisionsResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_JEV_BASE_URL;

  const response = await fetchImpl(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `jev request failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
    );
  }

  const data: unknown = await response.json();
  if (!isDecisionsResponse(data)) {
    throw new Error(`jev response missing "answers": ${JSON.stringify(data)}`);
  }
  return data;
}
