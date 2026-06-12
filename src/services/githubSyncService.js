/**
 * Manual Salesforce sync trigger via GitHub Actions.
 *
 * The "Sync Salesforce Data" workflow (every 30 min) writes SF data to
 * Firestore. This service lets a user with a GitHub token trigger that
 * workflow on demand and watch it to completion — the app then receives
 * the fresh data through its Firestore subscription, no redeploy needed.
 *
 * The token is stored per-device in localStorage — NEVER ship a token in
 * the bundle: GitHub Pages is publicly reachable.
 */

const OWNER = 'kay0530';
const REPO = 'OM_schedule';
const SYNC_WORKFLOW = 'sync-sf.yml';
const TOKEN_KEY = 'construction-schedule-github-token';

export function getGithubToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function saveGithubToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token.trim());
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function listRuns(token, workflow, createdAfterIso) {
  const params = new URLSearchParams({ per_page: '5' });
  if (createdAfterIso) params.set('created', `>=${createdAfterIso}`);
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${workflow}/runs?${params}`,
    { headers: ghHeaders(token) }
  );
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  return data.workflow_runs || [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Trigger the SF sync workflow and wait for it to complete.
 * Fresh data arrives via the Firestore subscription as soon as the
 * workflow's batched write commits.
 * @param {string} token - GitHub token (actions:write on the repo)
 * @param {(message: string) => void} onStatus - progress callback
 */
export async function triggerSfSync(token, onStatus = () => {}) {
  const startedAt = new Date(Date.now() - 5000).toISOString();

  onStatus('同期ワークフローを起動中...');
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${SYNC_WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    }
  );
  if (res.status === 401 || res.status === 403) {
    throw new Error('GitHubトークンが無効か権限不足です（設定画面で確認してください）');
  }
  if (res.status !== 204) {
    throw new Error(`ワークフロー起動に失敗しました (HTTP ${res.status})`);
  }

  // Wait for the new sync run to appear, then for it to complete
  onStatus('Salesforceからデータ取得中...');
  let syncRun = null;
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(8000);
    const runs = await listRuns(token, SYNC_WORKFLOW, startedAt);
    syncRun = runs[0] || null;
    if (syncRun && syncRun.status === 'completed') break;
  }
  if (!syncRun) throw new Error('同期ワークフローの開始を確認できませんでした');
  if (syncRun.conclusion !== 'success') {
    throw new Error(`同期ワークフローが失敗しました (${syncRun.conclusion})`);
  }
}
