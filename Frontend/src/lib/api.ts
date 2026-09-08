/**
 * Browser-side client for the PongAI API.
 *
 * The site is a static export, so there is no server to proxy through: every
 * call here runs in the visitor's browser and goes straight to the API
 * container. That is also why the blob upload is a direct PUT — a 100 MB body
 * never touches the API.
 */
import type {
  Analysis,
  ApiErrorBody,
  CreateUploadResponse,
  Job,
  Limits,
  Rejection,
  SourceVideo,
  SubmitJobResponse,
  VideoProbe,
} from "./api-types";

/**
 * Inlined at build time, so a deployed bundle points at whatever API URL was
 * set when it was built. Defaults to a local backend for `next dev`.
 */
export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

/** An API failure carrying the server's envelope, so callers can read `code`. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly rejections: Rejection[];

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error?.message ?? fallback);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.error?.code ?? `http_${status}`;
    this.rejections = body?.error?.rejections ?? [];
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    // fetch only rejects on network failure, so this is genuinely "no API".
    throw new ApiError(0, null, `Cannot reach the API at ${API_BASE}.`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body, `Request failed (${res.status}).`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const getLimits = () => request<Limits>("/api/limits");

/**
 * The finished analysis: meta, every shot, and signed URLs for the rendered
 * video and crop track. 409 until the job is done.
 */
export const getAnalysis = (jobId: string) =>
  request<Analysis>(`/api/analyses/${jobId}`);

export const listJobs = (limit = 50) =>
  request<Job[]>(`/api/jobs?limit=${limit}`);

export const getJob = (jobId: string) => request<Job>(`/api/jobs/${jobId}`);

/**
 * A signed link to the uploaded video.
 *
 * Fetched when the player opens rather than with the list: these URLs expire,
 * and issuing one per row would sign fifty links to watch one video.
 */
export const getSource = (jobId: string) =>
  request<SourceVideo>(`/api/jobs/${jobId}/source`);

/**
 * Hand the job to the worker.
 *
 * Separate from the upload on purpose: a SAS can be issued and the PUT then
 * fail at 70%. This is where the API verifies the blob actually landed at its
 * stated size, so a truncated upload is caught here rather than deep in the
 * pipeline half an hour later.
 */
export const submitJob = (jobId: string) =>
  request<SubmitJobResponse>(`/api/jobs/${jobId}/submit`, { method: "POST" });

/** Irreversible — the account has blob soft-delete disabled. Confirm first. */
export const deleteJob = (jobId: string) =>
  request<void>(`/api/jobs/${jobId}`, { method: "DELETE" });

export const createUpload = (body: {
  filename: string;
  size_bytes: number;
  content_type: string;
  probe: VideoProbe | null;
}) =>
  request<CreateUploadResponse>("/api/uploads", {
    method: "POST",
    body: JSON.stringify(body),
  });

/**
 * PUT the file to blob storage using the scoped SAS.
 *
 * XMLHttpRequest rather than fetch: fetch reports no upload progress, and a
 * 100 MB upload with no progress bar reads as a hung page.
 *
 * `x-ms-blob-type` is required by the Blob REST API. If this fails with a
 * status of 0, it is almost always CORS on the storage account rather than
 * anything wrong with the token.
 */
export function uploadToBlob(
  url: string,
  file: File,
  contentType: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("x-ms-blob-type", "BlockBlob");
    xhr.setRequestHeader("Content-Type", contentType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new Error(
              `Storage rejected the upload (${xhr.status}). ${xhr.responseText.slice(0, 200)}`,
            ),
          );
    xhr.onerror = () =>
      reject(
        new Error(
          "The upload could not reach storage. If the API issued the link " +
            "successfully, this is usually a missing CORS rule on the " +
            "storage account.",
        ),
      );
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });

    xhr.send(file);
  });
}
