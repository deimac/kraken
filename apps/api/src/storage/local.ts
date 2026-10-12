import { randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

// Disk-backed media storage. Callers only use keys, so it can be swapped for S3 later.
export class LocalStorage {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async init(): Promise<void> {
    await mkdir(join(this.root, 'tmp'), { recursive: true });
  }

  tmpPath(): string {
    return join(this.root, 'tmp', randomUUID());
  }

  async saveFrom(tmpPath: string, key: string): Promise<void> {
    const dest = this.resolve(key);
    await mkdir(dirname(dest), { recursive: true });
    await rename(tmpPath, dest);
  }

  createReadStream(key: string, range?: { start: number; end: number }): ReadStream {
    return createReadStream(this.resolve(key), range);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  private resolve(key: string): string {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('invalid storage key');
    return p;
  }
}
