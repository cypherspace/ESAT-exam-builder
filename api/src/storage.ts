import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream, type ReadStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Storage } from '@google-cloud/storage';

type Backend = 'local' | 'gcs';

const backend: Backend = (process.env.STORAGE_BACKEND as Backend) ?? 'local';
const localRoot = resolve(process.env.STORAGE_DIR ?? './storage');
const gcsBucket = process.env.STORAGE_BUCKET;

const gcs = backend === 'gcs' ? new Storage() : null;

function localPath(key: string): string {
  const safe = key.replace(/^\/+/, '').replace(/\.\.+/g, '');
  return join(localRoot, safe);
}

export async function writeBytes(key: string, data: Buffer): Promise<string> {
  if (backend === 'local') {
    const path = localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return `file://${path}`;
  }
  if (!gcs || !gcsBucket) throw new Error('STORAGE_BUCKET required for gcs backend');
  await gcs.bucket(gcsBucket).file(key).save(data, { resumable: false });
  return `gs://${gcsBucket}/${key}`;
}

export async function readBytes(uri: string): Promise<Buffer> {
  if (uri.startsWith('file://')) {
    return readFile(uri.slice('file://'.length));
  }
  if (uri.startsWith('gs://')) {
    if (!gcs) throw new Error('gcs backend not configured');
    const { bucket, key } = parseGs(uri);
    const [buf] = await gcs.bucket(bucket).file(key).download();
    return buf;
  }
  throw new Error(`unsupported uri: ${uri}`);
}

export async function statSize(uri: string): Promise<number> {
  if (uri.startsWith('file://')) {
    const s = await stat(uri.slice('file://'.length));
    return s.size;
  }
  if (uri.startsWith('gs://')) {
    if (!gcs) throw new Error('gcs backend not configured');
    const { bucket, key } = parseGs(uri);
    const [meta] = await gcs.bucket(bucket).file(key).getMetadata();
    return Number(meta.size ?? 0);
  }
  throw new Error(`unsupported uri: ${uri}`);
}

export function streamLocal(uri: string): ReadStream {
  if (!uri.startsWith('file://')) throw new Error('streamLocal: not a file uri');
  return createReadStream(uri.slice('file://'.length));
}

/** Stream a file:// or gs:// URI to a Node Writable. Routes use this to
 *  serve clip PNGs / source PDFs back to the frontend regardless of which
 *  backend stored them. */
export function streamUri(uri: string): NodeJS.ReadableStream {
  if (uri.startsWith('file://')) {
    return createReadStream(uri.slice('file://'.length));
  }
  if (uri.startsWith('gs://')) {
    if (!gcs) throw new Error('gcs backend not configured');
    const { bucket, key } = parseGs(uri);
    return gcs.bucket(bucket).file(key).createReadStream();
  }
  throw new Error(`unsupported uri: ${uri}`);
}

function parseGs(uri: string): { bucket: string; key: string } {
  const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!m) throw new Error(`bad gs uri: ${uri}`);
  return { bucket: m[1]!, key: m[2]! };
}

export const storageBackend = backend;
