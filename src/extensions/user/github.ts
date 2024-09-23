import { Octokit } from '@octokit/core';
import { components } from '@octokit/openapi-types';

import type { EmitterWebhookEvent } from '@octokit/webhooks';

import { AddFile, DeleteFile, UpsertFile } from './openai';

export async function toActionableFiles(
  repoName: string,
  files: components['schemas']['diff-entry'][],
) {
  const actionableFiles: Omit<AddFile | UpsertFile | DeleteFile, 'id'>[] = [];
  for (const file of files) {
    if (file.status === 'removed' || file.status === 'renamed') {
      actionableFiles.push({
        action: 'delete',
        filename: file.previous_filename || file.filename,
        path: file.contents_url,
      });
      continue;
    }
    const data = await getFile(repoName, file.filename);

    if (!data || !data.content.trim()) {
      actionableFiles.push({
        action: 'delete',
        filename: file.filename,
        path: file.filename,
      });
    } else {
      actionableFiles.push({
        action: file.status === 'added' ? 'add' : 'upsert',
        filename: file.filename,
        path: file.filename,
      });
    }
  }
  return actionableFiles;
}

async function getFile(repoName: string, path: string) {
  const [owner, repo] = repoName.split('/');
  const { data } = await octokit.request(
    'GET /repos/{owner}/{repo}/contents/{path}',
    {
      owner,
      repo,
      path,
    },
  );

  if (!('type' in data) || data.type !== 'file') {
    return null;
  }
  const { content } = data;
  return {
    content: content.trim() ? Buffer.from(content, 'base64').toString() : '',
  };
}

export function processPushEvent(
  event: EmitterWebhookEvent<'push'>['payload'],
) {
  const [owner, repo] = event.repository.full_name.split('/');
  return {
    owner,
    repo,
    getFiles: async () => {
      const res = await octokit.request(
        'GET /repos/{owner}/{repo}/compare/{basehead}',
        {
          owner,
          repo,
          basehead: `${event.before}...${event.after}`,
        },
      );
      return res.data.files;
    },
  };
}

export const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});
