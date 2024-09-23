import { OpenAI } from 'openai';
import { allSettledWithThrow } from 'openai/lib/Util.mjs';
import { VectorStoreFileBatch } from 'openai/resources/beta/vector-stores/file-batches.mjs';
import { Uploadable } from 'openai/uploads.mjs';
export const openai = new OpenAI();

interface Action {
  id: string;
  filename: string;
  path: string;
}
export interface UpsertFile extends Action {
  action: 'upsert';
  content: string;
}
export interface AddFile extends Action {
  action: 'add';
  content: string;
}

export interface DeleteFile extends Action {
  action: 'delete';
}

export async function patchVectorStore(
  vectorStoreId: string,
  files: (AddFile | UpsertFile | DeleteFile)[],
) {
  await deleteVectoreStoreFiles(
    vectorStoreId,
    files.map((file) => file.id),
  );
  await uploadAndPoll.call(
    openai.beta.vectorStores.fileBatches,
    vectorStoreId,
    {
      files: files
        .filter((file) => file.action !== 'delete')
        .map((file) => new File([file.content], file.filename)),
    },
  );
}

export async function deleteVectoreStoreFiles(
  vectorStoreId: string,
  files: string[],
) {
  let vectorStoreFiles = await openai.beta.vectorStores.files.list(
    vectorStoreId,
    { limit: 100 },
  );
  const deleteFiles = files.slice(0);
  while (deleteFiles.length) {
    for (let i = 0; i < deleteFiles.length; i++) {
      const file = deleteFiles[i];
      // FIXME: this won't work. we need to save the file id in some database
      // and then retrieve the id from it.
      const foundfiles = vectorStoreFiles.data.filter((f) => f.id === file);
      if (foundfiles.length) {
        deleteFiles.splice(i, 1);
        i--;
        for (const file of foundfiles) {
          await openai.beta.vectorStores.files.del(vectorStoreId, file.id);
        }
      }
    }
    if (!vectorStoreFiles.nextPageInfo()) {
      // no more pages. Some files might not have been deleted, there might be new files.
      break;
    }
    vectorStoreFiles = await vectorStoreFiles.getNextPage();
  }
}

export const vectorStore = {
  delete: async (
    vectorStoreId: string,
    files: { id: string; permanent?: boolean }[],
  ) => {
    for (const file of files) {
      await openai.beta.vectorStores.files.del(vectorStoreId, file.id);
      if (file.permanent !== false) {
        await openai.files.del(file.id);
      }
    }
  },
  patch: async (
    vectorStoreId: string,
    files: { content: string; filename: string }[],
  ) => {
    return uploadAndPoll.call(
      openai.beta.vectorStores.fileBatches,
      vectorStoreId,
      {
        files: files.map((file) => new File([file.content], file.filename)),
      },
    );
  },
};

async function uploadAndPoll(
  this: OpenAI.Beta.VectorStores.FileBatches,
  vectorStoreId: string,
  { files, fileIds = [] }: { files: Uploadable[]; fileIds?: string[] },
) {
  if (files == null || files.length == 0) {
    throw new Error(
      `No \`files\` provided to process. If you've already uploaded files you should use \`.createAndPoll()\` instead`,
    );
  }

  // We cap the number of workers at the number of files (so we don't start any unnecessary workers)
  const concurrencyLimit = Math.min(5, files.length);

  const client = this._client;
  const fileIterator = files.values();
  const allFileIds: string[] = [...fileIds];

  // This code is based on this design. The libraries don't accommodate our environment limits.
  // https://stackoverflow.com/questions/40639432/what-is-the-best-way-to-limit-concurrency-when-using-es6s-promise-all
  async function processFiles(iterator: IterableIterator<Uploadable>) {
    for (let item of iterator) {
      const fileObj = await client.files.create({
        file: item,
        purpose: 'assistants',
      });
      allFileIds.push(fileObj.id);
    }
  }

  // Start workers to process results
  const workers = Array(concurrencyLimit).fill(fileIterator).map(processFiles);

  // Wait for all processing to complete.
  await allSettledWithThrow(workers);

  await this.createAndPoll(vectorStoreId, {
    file_ids: allFileIds,
  });
  return allFileIds;
}

async function askAi(threadId: string, assistantId: string) {
  const run = openai.beta.threads.runs.stream(threadId, {
    assistant_id: assistantId,
  });
  run.toReadableStream();
}
