import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn()
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

  return {
    ...actual,
    writeFile: mocks.writeFile,
    rename: mocks.rename,
    mkdir: mocks.mkdir
  };
});

import { writeJson } from '../../server/src/lib/fs';

describe('文件写入', () => {
  beforeEach(() => {
    mocks.writeFile.mockReset();
    mocks.rename.mockReset();
    mocks.mkdir.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('写入 JSON 时先写临时文件再替换目标文件', async () => {
    await writeJson('data/project.json', { name: 'CRM' });

    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile.mock.calls[0]?.[0]).toContain('project.json.tmp');
    expect(mocks.rename).toHaveBeenCalledTimes(1);
    expect(mocks.rename.mock.calls[0]?.[0]).toContain('project.json.tmp');
    expect(mocks.rename.mock.calls[0]?.[1]).toBe('data/project.json');
  });
});
