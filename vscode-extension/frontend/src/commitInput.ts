export function isCommitHash(value: string): boolean {
  return /^[a-fA-F0-9]{7,40}$/.test(value.trim());
}

export function getGitHubCommitUrl(value: string): string | undefined {
  const match = value.trim().match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/commit\/([a-fA-F0-9]+)\/?(?:[?#].*)?$/i);
  return match ? `https://github.com/${match[1]}/${match[2]}/commit/${match[3].toLowerCase()}` : undefined;
}

export function parseGitHubRemote(remote: string): { owner: string; repo: string } | undefined {
  const match = remote.trim().match(/^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return match ? { owner: match[1], repo: match[2] } : undefined;
}
