import { Octokit } from '@octokit/core';
import { patchVectorStore } from './openai';
export async function uploadToVector(
  repoName: string,
  prFiles: {
    status:
      | 'added'
      | 'removed'
      | 'modified'
      | 'renamed'
      | 'copied'
      | 'changed'
      | 'unchanged';
    previous_filename?: string;
    contents_url: string;
    filename: string;
  }[],
) {
  const [owner, repo] = repoName.split('/');
  const vectorStoreId = 'vs_MesKThnNuAD2iYGZm3Nc79Mv';

  const vFiles = [];

  for (const file of prFiles) {
    if (file.status === 'removed' || file.status === 'renamed') {
      vFiles.push({
        action: 'delete',
        filename: file.previous_filename || file.filename,
        path: file.contents_url,
      } as const);
      continue;
    }

    const res = await octokit.request(
      'GET /repos/{owner}/{repo}/contents/{path}',
      {
        owner: owner,
        repo: repo,
        path: file.filename,
      },
    );

    if ('type' in res.data && res.data.type === 'file') {
      const { content, path } = res.data;
      if (!content.trim()) {
        vFiles.push({
          action: 'delete',
          filename: file.filename,
          path: path,
        } as const);
      } else {
        const rawContent = Buffer.from(content, 'base64').toString();
        if (file.status === 'added') {
          vFiles.push({
            action: 'add',
            content: rawContent,
            filename: file.filename,
            path: path,
          } as const);
        }
        vFiles.push({
          action: 'upsert',
          content: rawContent,
          filename: file.filename,
          path: path,
        } as const);
      }
    }
  }

  console.log({ vFiles });

  await patchVectorStore(vectorStoreId, vFiles);
}

export const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});
