// Release assets keep stable, version-free names (design/05-landing-page.md),
// so these links always point at the newest published release.
export const REPO = 'Brobit/KnYC';
export const DOWNLOAD_BASE = `https://github.com/${REPO}/releases/latest/download`;

export type Platform = 'macos' | 'windows' | 'linux';

export const ASSETS: Record<Platform, { label: string; files: { name: string; file: string }[] }> = {
  macos: {
    label: 'macOS',
    files: [{ name: 'Apple Silicon and Intel (.dmg)', file: 'KnYC-macos-universal.dmg' }],
  },
  windows: {
    label: 'Windows',
    files: [
      { name: 'Installer (.exe)', file: 'KnYC-windows-x64-setup.exe' },
      { name: 'MSI package (.msi)', file: 'KnYC-windows-x64.msi' },
    ],
  },
  linux: {
    label: 'Linux',
    files: [
      { name: 'AppImage', file: 'KnYC-linux-x86_64.AppImage' },
      { name: 'Debian / Ubuntu (.deb)', file: 'KnYC-linux-amd64.deb' },
      { name: 'Fedora / openSUSE (.rpm)', file: 'KnYC-linux-x86_64.rpm' },
    ],
  },
};

export interface LatestRelease {
  version: string;
  date: string;
  /** Asset file names: a pre-release has no .rpm (see .github/workflows/release.yml). */
  assets: string[];
}

/** The download list, without the files the latest release doesn't have (all of them when unknown). */
export function availableAssets(release: LatestRelease | null): typeof ASSETS {
  if (!release) return ASSETS;
  const has = new Set(release.assets);
  return Object.fromEntries(
    Object.entries(ASSETS).map(([platform, group]) => [platform, { ...group, files: group.files.filter((f) => has.has(f.file)) }]),
  ) as typeof ASSETS;
}

// Fetched at build time; the site is rebuilt on every release. Returns null when there is
// no release yet or GitHub is unreachable, and the page simply hides the version line.
export async function getLatestRelease(): Promise<LatestRelease | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name: string; published_at: string; assets?: { name: string }[] };
    return { version: data.tag_name, date: data.published_at.slice(0, 10), assets: (data.assets ?? []).map((a) => a.name) };
  } catch {
    return null;
  }
}
