import {
  normalizeDaemonError,
  type NormalizedDaemonError,
} from './errors';

export class DaemonRequestError extends Error {
  readonly error: NormalizedDaemonError;

  constructor(error: NormalizedDaemonError) {
    super(error.message);
    this.name = 'DaemonRequestError';
    this.error = error;
  }
}

export async function daemonFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(path, init);
}

export async function daemonOk(path: string, init?: RequestInit): Promise<boolean> {
  const response = await daemonFetch(path, init);
  if (response.ok) return true;
  throw new DaemonRequestError(await readDaemonError(response));
}

export async function daemonJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await daemonFetch(path, init);
  if (!response.ok) {
    throw new DaemonRequestError(await readDaemonError(response));
  }
  return (await response.json()) as T;
}

export async function daemonText(
  path: string,
  init?: RequestInit,
): Promise<string> {
  const response = await daemonFetch(path, init);
  if (!response.ok) {
    throw new DaemonRequestError(await readDaemonError(response));
  }
  return await response.text();
}

export async function daemonSse(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await daemonFetch(path, init);
  if (!response.ok) {
    throw new DaemonRequestError(await readDaemonError(response));
  }
  return response;
}

async function readDaemonError(response: Response): Promise<NormalizedDaemonError> {
  const text = await response.text().catch(() => '');
  if (!text) {
    return normalizeDaemonError(null, {
      status: response.status,
      fallbackMessage: `daemon ${response.status}: no body`,
    });
  }

  try {
    return normalizeDaemonError(JSON.parse(text), {
      status: response.status,
      fallbackMessage: text,
    });
  } catch {
    return normalizeDaemonError(text, {
      status: response.status,
      fallbackMessage: text,
    });
  }
}
